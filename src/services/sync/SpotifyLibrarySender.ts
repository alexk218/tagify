import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { DesktopSyncConfiguration } from "./SyncLocalState";
import { syncClientHeaders } from "./SyncClientHeaders";

// Sends the member's Liked Songs and playlists to Tagify Community when they ask for them on the
// website (Community migration 0233, docs/SPOTIFY_LIBRARY_IMPORT_2026-10.md). Lists are read
// through Spotify's desktop APIs only, never the Web API, and Community keeps them privately so the
// member can tag their songs there. Each list names the Spotify folders it sits in, so Community
// shows the member's lists the way Spotify does; a Community that doesn't keep folders ignores them.

/** Songs per upload request (ten of Community's 1,000-song chunks). */
export const PART_SONGS = 10_000;
export const LIST_MAX_SONGS = 50_000;
export const LISTS_MAX_SONGS = 150_000;
export const LISTS_MAX = 2_000;
/** Folder levels and distinct folders Community keeps. */
export const FOLDER_MAX_DEPTH = 8;
export const FOLDERS_MAX = 2_000;

/** [title, artist, album, imageUrl], as Community keeps them. */
export type CommunitySongName = [string | null, string | null, string | null, string | null];

/** A Spotify playlist folder: Spotify's own ID for it, and its name. */
export interface CommunitySpotifyFolder { id: string; name: string }

export interface CommunitySpotifyList {
  /** "liked", or the Spotify playlist ID. */
  id: string;
  kind: "liked" | "playlist";
  name: string;
  position: number;
  playlistId: string | null;
  songs: string[];
  names: CommunitySongName[];
  /** The folders the list sits in, outermost first; none for Liked Songs. */
  folders: CommunitySpotifyFolder[];
}

/** What the sender needs from Spotify's desktop APIs (SpotifyApiService). */
export interface LibraryReader {
  getTaggingQueuePage(playlistId: string | null, offset?: number, signal?: AbortSignal): Promise<{ tracks: SpotifyTrack[]; nextOffset: number | null }>;
  getAllUserPlaylistReferencesStrict(signal?: AbortSignal): Promise<Array<{ playlistId: string; playlistName: string; folders?: CommunitySpotifyFolder[] }>>;
  readPlaylistTracks(playlistId: string, options?: { signal?: AbortSignal }): Promise<SpotifyTrack[]>;
}

const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
const FOLDER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Text Community can keep: no control characters, at most `max` characters, never half an emoji. */
const clean = (value: string | null | undefined, max = 300) => {
  const text = (value ?? "").replace(/\p{Cc}/gu, " ").trim();
  return text ? Array.from(text).slice(0, max).join("").trim() : null;
};

/**
 * A playlist's folders as Community keeps them: the outermost 8 levels, and no folder beyond the
 * member's first 2,000 (`known` collects them across a send, in Spotify's order). A playlist past
 * either limit sits in the deepest folder that fits.
 */
export function communityFolders(path: ReadonlyArray<{ id: string; name: string }> | undefined, known: Set<string>): CommunitySpotifyFolder[] {
  const folders: CommunitySpotifyFolder[] = [];
  for (const folder of (path ?? []).slice(0, FOLDER_MAX_DEPTH)) {
    if (!FOLDER_ID.test(folder.id) || folders.some((outer) => outer.id === folder.id)) break;
    if (!known.has(folder.id)) {
      if (known.size >= FOLDERS_MAX) break;
      known.add(folder.id);
    }
    folders.push({ id: folder.id, name: clean(folder.name, 200) ?? "Untitled folder" });
  }
  return folders;
}

/** A small cover for Community's rows: Spotify's desktop image IDs become their CDN address. */
export function imageUrl(track: SpotifyTrack): string | null {
  const images = track.album.images ?? [];
  const url = images[images.length - 1]?.url ?? "";
  if (url.startsWith("spotify:image:")) return `https://i.scdn.co/image/${url.slice("spotify:image:".length)}`;
  return url.startsWith("https://") && url.length <= 500 ? url : null;
}

/** A song's Spotify ID and the names Community shows for it; local files and episodes have none. */
export function communitySong(track: SpotifyTrack): { id: string; name: CommunitySongName } | null {
  const id = track.uri.startsWith("spotify:track:") ? track.uri.slice("spotify:track:".length) : "";
  if (!SPOTIFY_ID.test(id)) return null;
  return { id, name: [clean(track.name), clean(track.artists.map((artist) => artist.name).filter(Boolean).join(", ")), clean(track.album.name), imageUrl(track)] };
}

function toList(id: string, kind: CommunitySpotifyList["kind"], name: string, position: number, tracks: SpotifyTrack[], folders: CommunitySpotifyFolder[] = []): CommunitySpotifyList {
  const seen = new Set<string>();
  const songs: string[] = [];
  const names: CommunitySongName[] = [];
  for (const track of tracks) {
    const song = communitySong(track);
    if (!song || seen.has(song.id) || songs.length >= LIST_MAX_SONGS) continue;
    seen.add(song.id);
    songs.push(song.id);
    names.push(song.name);
  }
  return { id, kind, name: clean(name, 200) ?? "Untitled playlist", position, playlistId: kind === "playlist" ? id : null, songs, names, folders };
}

/**
 * Liked Songs (oldest first, so a new like changes only Community's last chunk) and every
 * playlist in the member's library, in its folders. Reads one page at a time.
 */
export async function readSpotifyLibrary(reader: LibraryReader, signal?: AbortSignal): Promise<CommunitySpotifyList[]> {
  const liked: SpotifyTrack[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const page = await reader.getTaggingQueuePage(null, offset, signal);
    liked.push(...page.tracks);
    offset = page.nextOffset;
  }
  const lists = [toList("liked", "liked", "Liked Songs", 0, liked.reverse())];
  const playlists = await reader.getAllUserPlaylistReferencesStrict(signal);
  const folderIds = new Set<string>();
  let total = lists[0].songs.length;
  for (const [index, playlist] of playlists.entries()) {
    if (lists.length >= LISTS_MAX || total >= LISTS_MAX_SONGS) break;
    if (!SPOTIFY_ID.test(playlist.playlistId)) continue;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const list = toList(playlist.playlistId, "playlist", playlist.playlistName, index + 1, await reader.readPlaylistTracks(playlist.playlistId, { signal }),
      communityFolders(playlist.folders, folderIds));
    const room = LISTS_MAX_SONGS - total;
    if (list.songs.length > room) { list.songs = list.songs.slice(0, room); list.names = list.names.slice(0, room); }
    total += list.songs.length;
    lists.push(list);
  }
  return lists;
}

/**
 * The request bodies for one list: parts of `size` songs (a multiple of Community's 1,000-song
 * chunks, at most 10,000) from a chunk boundary, the last marked.
 */
export function listParts(list: CommunitySpotifyList, size = PART_SONGS) {
  const parts = Math.max(1, Math.ceil(list.songs.length / size));
  return Array.from({ length: parts }, (_, part) => {
    const start = part * size;
    return {
      id: list.id, kind: list.kind, name: list.name, position: list.position, playlistId: list.playlistId, folders: list.folders,
      songCount: list.songs.length, fromChunk: start / 1_000,
      songs: list.songs.slice(start, start + size), names: list.names.slice(start, start + size),
      last: part === parts - 1,
    };
  });
}

export class SpotifyLibrarySendError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = "SpotifyLibrarySendError";
  }
}

/** Sends every list, then finishes, which removes lists the member no longer has in Spotify. */
export async function sendSpotifyLibrary(
  configuration: DesktopSyncConfiguration,
  lists: CommunitySpotifyList[],
  request: typeof fetch = fetch,
): Promise<{ lists: number; songs: number }> {
  const revision = crypto.randomUUID();
  const send = async (method: "PUT" | "POST", body: Record<string, unknown>) => {
    const response = await request(`${configuration.apiBaseUrl}/api/v2/sync/spotify-library`, {
      method,
      headers: { ...syncClientHeaders(configuration.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: configuration.deviceId, revision, ...body }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string }; lists?: number; songs?: number };
    if (!response.ok) throw new SpotifyLibrarySendError(payload.error?.message || "Your Spotify lists couldn't be sent to Community", response.status, payload.error?.code ?? null);
    return payload;
  };
  for (const list of lists) for (const part of listParts(list)) await send("PUT", { list: part });
  const finished = await send("POST", {});
  return { lists: Number(finished.lists ?? lists.length), songs: Number(finished.songs ?? lists.reduce((sum, list) => sum + list.songs.length, 0)) };
}

const handledKey = (configuration: Pick<DesktopSyncConfiguration, "libraryId" | "accountId">) => `tagify:spotify-library-request:${configuration.accountId}:${configuration.libraryId}`;

/** Whether the website's request is newer than the last one this computer answered. */
export function isNewSpotifyLibraryRequest(configuration: Pick<DesktopSyncConfiguration, "libraryId" | "accountId">, requestedAt: string | null | undefined): boolean {
  const requested = requestedAt ? Date.parse(requestedAt) : NaN;
  if (!Number.isFinite(requested)) return false;
  let handled = 0;
  try { handled = Number(localStorage.getItem(handledKey(configuration)) || 0); } catch { /* storage unavailable: answer once more */ }
  return requested > handled;
}

export function markSpotifyLibraryRequestHandled(configuration: Pick<DesktopSyncConfiguration, "libraryId" | "accountId">, requestedAt: string): void {
  try { localStorage.setItem(handledKey(configuration), String(Date.parse(requestedAt))); } catch { /* the next request is answered again */ }
}

// --- Sends the member watches on Community (Community migration 0240) ----------------------------
//
// The member asks on Community; Tagify picks the send up, reads Liked Songs and every playlist one
// at a time and sends them as it goes, several small lists per request, and checks in at least every
// 15 seconds with how far it got, so the website shows progress and can tell when a send stopped.
// Lists Community already has unchanged (same fingerprint) are kept rather than sent again, so a
// retry picks up where a failed send left off. A failure is reported with a reason. A Community
// without sends (no /send route) gets the one-shot send above.

/** What this Tagify tells Community it can do when it starts. */
export const SPOTIFY_LISTS_FEATURE = "spotifyLists";

export type SpotifySendFailure = "spotify_busy" | "spotify_unavailable" | "too_large" | "daily_limit" | "paused" | "signed_out" | "network" | "unknown";

export interface SpotifySendProgress {
  listsTotal: number | null;
  listsDone: number;
  listsUnchanged: number;
  songsSent: number;
  /** Songs read so far in the list being read. */
  currentSongs: number;
}

export type SpotifySendOutcome =
  | { status: "done"; lists: number; songs: number; unchanged: number }
  /** Sent the one-shot way, to a Community without sends. */
  | { status: "sent"; lists: number; songs: number }
  /** Nothing was waiting, another computer is sending, the member cancelled, or another send replaced this one. */
  | { status: "none" | "taken" | "cancelled" | "gone" }
  | { status: "failed"; failure: SpotifySendFailure };

/** The device session for each request, refreshed when needed (a long send can outlive a token). */
export type SendSession = () => Promise<Pick<DesktopSyncConfiguration, "apiBaseUrl" | "accessToken" | "deviceId">>;

/** Spotify's desktop APIs the sender reads, when this Spotify has them. */
export function canReadSpotifyLibrary(platform: unknown = typeof Spicetify === "undefined" ? undefined : Spicetify.Platform): boolean {
  const api = platform as { RootlistAPI?: { getContents?: unknown }; LibraryAPI?: { getTracks?: unknown }; PlaylistAPI?: { getContents?: unknown } } | undefined;
  return typeof api?.RootlistAPI?.getContents === "function" && typeof api?.LibraryAPI?.getTracks === "function" && typeof api?.PlaylistAPI?.getContents === "function";
}

/** Tells Community what this Tagify can do. Never throws; a Community without the route answers 404. */
export async function reportDesktopFeatures(session: SendSession, request: typeof fetch = fetch, features = canReadSpotifyLibrary() ? [SPOTIFY_LISTS_FEATURE] : []): Promise<boolean> {
  try {
    const current = await session();
    const response = await request(`${current.apiBaseUrl}/api/v2/sync/device-features`, {
      method: "PUT",
      headers: { ...syncClientHeaders(current.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: current.deviceId, features }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Reading from Spotify failed; `busy` when Spotify asked Tagify to wait. */
export class SpotifyReadFailure extends Error {
  constructor(readonly busy: boolean, message = busy ? "Spotify asked Tagify to wait" : "Spotify couldn't read the library") {
    super(message);
    this.name = "SpotifyReadFailure";
  }
}

class SendStopped extends Error {
  constructor(readonly reason: "cancelled" | "gone") {
    super(`Send ${reason}`);
    this.name = "SendStopped";
  }
}

/** Why a send failed, as Community explains it to the member. */
export function sendFailure(error: unknown): SpotifySendFailure {
  if (error instanceof SpotifyReadFailure) return error.busy ? "spotify_busy" : "spotify_unavailable";
  if (error instanceof SpotifyLibrarySendError) {
    if (error.code === "spotify_lists_too_large" || error.status === 413) return "too_large";
    if (error.code === "spotify_lists_daily_limit") return "daily_limit";
    if (error.code === "spotify_lists_paused") return "paused";
    if (error.status === 401 || error.status === 403 || error.code === "authentication_required") return "signed_out";
    return error.status >= 500 || error.status === 0 ? "network" : "unknown";
  }
  if (error instanceof TypeError) return "network";
  return "unknown";
}

/** Whether Spotify asked Tagify to wait (rate limited, or Tagify's own request guard stopped it). */
export const isSpotifyBusy = (error: unknown) => {
  const value = error as { status?: number; spotifyRequestStopped?: boolean; message?: string } | null;
  return value?.status === 429 || Boolean(value?.spotifyRequestStopped) || /short break|slow down|wait/i.test(value?.message ?? "");
};

/** Reads from Spotify, turning its failures (and a read that never ends) into SpotifyReadFailure. */
async function readFromSpotify<T>(read: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SpotifyReadFailure(false, "Spotify took too long to read a list")), timeoutMs); }),
    ]);
  } catch (error) {
    if (error instanceof SpotifyReadFailure) throw error;
    if ((error as { name?: string } | null)?.name === "AbortError") throw error;
    throw new SpotifyReadFailure(isSpotifyBusy(error));
  } finally {
    clearTimeout(timer);
  }
}

/** A short fingerprint of a list's songs and their names; equal lists have equal fingerprints. */
export async function listFingerprint(list: Pick<CommunitySpotifyList, "kind" | "songs" | "names">): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([list.kind, list.songs, list.names]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Songs per part so a part stays well under Community's 3 MB request limit, in whole chunks. */
export function partSongs(list: Pick<CommunitySpotifyList, "songs" | "names">, budgetBytes = REQUEST_BUDGET_BYTES): number {
  if (!list.songs.length) return PART_SONGS;
  const perSong = JSON.stringify(list.names).length / list.songs.length + 26;
  return Math.max(1_000, Math.min(PART_SONGS, Math.floor(budgetBytes / perSong / 1_000) * 1_000));
}

/** Lists per request and their size, kept well under Community's limits (500 lists, 10,000 songs, 3 MB). */
const REQUEST_LISTS = 200;
const REQUEST_BUDGET_BYTES = 1_500_000;
const PROGRESS_EVERY_MS = 1_500;
const HEARTBEAT_MS = 15_000;
const LIST_TIMEOUT_MS = 3 * 60_000;

type Part = ReturnType<typeof listParts>[number] & { fingerprint: string };
/** A list Community already has: kept without its songs, with its current name, place and folders. */
type Kept = { id: string; keep: true; fingerprint: string; name: string; position: number; folders: CommunitySpotifyFolder[] };

/** The send this Tagify is running, for Tagify's own Cloud Sync window. */
export type SpotifySendSnapshot = { phase: "sending"; progress: SpotifySendProgress } | null;
let currentSend: SpotifySendSnapshot = null;
export const SPOTIFY_LIBRARY_SEND_EVENT = "tagify:spotifyLibrarySend";
export const currentSpotifyLibrarySend = () => currentSend;
function publish(snapshot: SpotifySendSnapshot) {
  currentSend = snapshot;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SPOTIFY_LIBRARY_SEND_EVENT, { detail: snapshot }));
}

/**
 * Picks up the member's ask on Community and sends their lists, reporting progress as it goes.
 * Returns how it ended; never throws for a failure Community can show (it reports it there).
 */
export async function runSpotifyLibrarySend(session: SendSession, reader: LibraryReader, options: {
  request?: typeof fetch; heartbeatMs?: number; listTimeoutMs?: number; onStarted?: () => void;
} = {}): Promise<SpotifySendOutcome> {
  const request = options.request ?? fetch;
  const call = async (method: "POST" | "PATCH" | "PUT", path: string, body: Record<string, unknown>) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}/api/v2/sync/spotify-library${path}`, {
        method,
        headers: { ...syncClientHeaders(current.accessToken), "content-type": "application/json" },
        body: JSON.stringify({ deviceId: current.deviceId, ...body }),
      });
    } catch (error) {
      throw error instanceof TypeError ? error : new TypeError("Community couldn't be reached");
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: { code?: string; message?: string } };
    if (!response.ok) throw new SpotifyLibrarySendError(payload.error?.message || "Your Spotify lists couldn't be sent to Community", response.status, payload.error?.code ?? null);
    return payload;
  };

  let started: Record<string, unknown>;
  try {
    started = await call("POST", "/send", {});
  } catch (error) {
    // A Community without sends: the one-shot send.
    if (error instanceof SpotifyLibrarySendError && error.status === 404) {
      options.onStarted?.();
      try {
        const lists = await readFromSpotify(() => readSpotifyLibrary(reader), options.listTimeoutMs ?? LIST_TIMEOUT_MS * 10);
        const sent = await sendSpotifyLibrary(await session() as DesktopSyncConfiguration, lists, request);
        return { status: "sent", ...sent };
      } catch (failure) {
        return { status: "failed", failure: sendFailure(failure) };
      }
    }
    return { status: "failed", failure: sendFailure(error) };
  }
  if (started.status !== "started" || typeof started.sendId !== "string") return { status: started.status === "taken" ? "taken" : "none" };
  const sendId = started.sendId;
  const known = new Map((Array.isArray(started.lists) ? started.lists : []).map((list: { id?: unknown; fingerprint?: unknown }) => [String(list.id), String(list.fingerprint)]));
  options.onStarted?.();

  const progress: SpotifySendProgress = { listsTotal: null, listsDone: 0, listsUnchanged: 0, songsSent: 0, currentSongs: 0 };
  let stopped: SendStopped | null = null;
  let lastReport = 0;
  let missedReports = 0;
  const report = async (force = false) => {
    if (!force && Date.now() - lastReport < PROGRESS_EVERY_MS) return;
    lastReport = Date.now();
    publish({ phase: "sending", progress: { ...progress } });
    try {
      const reply = await call("PATCH", "/send", { sendId, ...progress });
      missedReports = 0;
      if (reply.status !== "active") stopped = new SendStopped(reply.status === "cancelled" ? "cancelled" : "gone");
    } catch (error) {
      // A check-in that doesn't arrive is tried again; several in a row mean the connection is gone.
      if (++missedReports >= 3) throw error;
    }
  };
  const checkpoint = () => { if (stopped) throw stopped; };
  const heartbeat = setInterval(() => { void report(true).catch(() => { /* the next one tries again */ }); }, options.heartbeatMs ?? HEARTBEAT_MS);

  const revision = crypto.randomUUID();
  let batch: Array<Part | Kept> = [];
  let batchSongs = 0;
  let batchBytes = 0;
  const keptLists = new Map<string, CommunitySpotifyList & { fingerprint: string }>();
  const queueParts = async (list: CommunitySpotifyList, fingerprint: string) => {
    for (const part of listParts(list, partSongs(list))) {
      const bytes = JSON.stringify(part).length;
      if (batch.length && (batchSongs + part.songs.length > PART_SONGS || batchBytes + bytes > REQUEST_BUDGET_BYTES || batch.length >= REQUEST_LISTS)) await flush();
      batch.push({ ...part, fingerprint });
      batchSongs += part.songs.length;
      batchBytes += bytes;
    }
  };
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    const sending = batch;
    batch = []; batchSongs = 0; batchBytes = 0;
    let reply!: Record<string, unknown>;
    for (let attempt = 1; ; attempt++) {
      try { reply = await call("PUT", "", { sendId, revision, lists: sending }); break; } catch (error) {
        // Community or the connection hiccuped: the same parts are safe to send again.
        if (attempt >= 3 || !(sendFailure(error) === "network")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
      }
    }
    if (reply.status !== "active") { stopped = new SendStopped(reply.status === "cancelled" ? "cancelled" : "gone"); checkpoint(); }
    progress.songsSent += sending.reduce((sum, item) => sum + ("songs" in item ? item.songs.length : 0), 0);
    // A list Community no longer has as it was is sent in full after all.
    for (const id of Array.isArray(reply.missing) ? reply.missing : []) {
      const list = keptLists.get(String(id));
      if (list) { progress.listsUnchanged = Math.max(0, progress.listsUnchanged - 1); await queueParts(list, list.fingerprint); }
    }
    for (const item of sending) if ("keep" in item) keptLists.delete(item.id);
    await report();
  };
  const add = async (list: CommunitySpotifyList) => {
    checkpoint();
    const fingerprint = await listFingerprint(list);
    if (known.get(list.id) === fingerprint) {
      const kept: Kept = { id: list.id, keep: true, fingerprint, name: list.name, position: list.position, folders: list.folders };
      const bytes = JSON.stringify(kept).length;
      if (batch.length && (batch.length >= REQUEST_LISTS || batchBytes + bytes > REQUEST_BUDGET_BYTES)) await flush();
      batch.push(kept);
      batchBytes += bytes;
      keptLists.set(list.id, { ...list, fingerprint });
      progress.listsUnchanged += 1;
    } else {
      await queueParts(list, fingerprint);
    }
    progress.listsDone += 1;
    progress.currentSongs = 0;
    await report();
  };

  try {
    const timeout = options.listTimeoutMs ?? LIST_TIMEOUT_MS;
    const playlists = (await readFromSpotify(() => reader.getAllUserPlaylistReferencesStrict(), timeout)).filter((playlist) => SPOTIFY_ID.test(playlist.playlistId));
    progress.listsTotal = Math.min(LISTS_MAX, 1 + playlists.length);
    await report(true);
    checkpoint();

    const liked: SpotifyTrack[] = [];
    for (let offset: number | null = 0; offset !== null;) {
      checkpoint();
      const page = await readFromSpotify(() => reader.getTaggingQueuePage(null, offset ?? 0), timeout);
      liked.push(...page.tracks);
      offset = page.nextOffset;
      progress.currentSongs = liked.length;
      await report();
    }
    const likedList = toList("liked", "liked", "Liked Songs", 0, liked.reverse());
    const folderIds = new Set<string>();
    let total = likedList.songs.length;
    await add(likedList);

    for (const [index, playlist] of playlists.entries()) {
      if (1 + index >= LISTS_MAX || total >= LISTS_MAX_SONGS) break;
      checkpoint();
      const list = toList(playlist.playlistId, "playlist", playlist.playlistName, index + 1, await readFromSpotify(() => reader.readPlaylistTracks(playlist.playlistId), timeout),
        communityFolders(playlist.folders, folderIds));
      const room = LISTS_MAX_SONGS - total;
      if (list.songs.length > room) { list.songs = list.songs.slice(0, room); list.names = list.names.slice(0, room); }
      total += list.songs.length;
      await add(list);
    }
    // The second flush sends lists Community turned out not to have after all.
    await flush();
    await flush();
    await report(true);
    checkpoint();
    const finished = await call("POST", "", { sendId, revision });
    if (finished.status !== "done") return { status: finished.status === "cancelled" ? "cancelled" : "gone" };
    return { status: "done", lists: Number(finished.lists ?? progress.listsDone), songs: Number(finished.songs ?? total), unchanged: progress.listsUnchanged };
  } catch (error) {
    if (error instanceof SendStopped) return { status: error.reason };
    const failure = sendFailure(error);
    await call("PATCH", "/send", { sendId, failure }).catch(() => { /* Community shows that the send stopped */ });
    console.warn("Tagify sync: Spotify lists were not sent to Community", failure, error instanceof Error ? error.message : error);
    return { status: "failed", failure };
  } finally {
    clearInterval(heartbeat);
    publish(null);
  }
}
