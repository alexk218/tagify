import type { CommunityMatch, CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { syncClientHeaders } from "@/services/sync/SyncClientHeaders";
import { getDesktopSyncConfiguration, sessionNeedsRefresh, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import type { RootlistCatalogPlaylist } from "@/services/SpotifyApiService";
import { communitySong, isLocalStall, LISTS_MAX_SONGS, streamSpotifyLibrary, type LibraryReader, type SpotifyLibraryChunk } from "@/services/sync/SpotifyLibrarySender";
import { capabilitiesCacheKey } from "@/services/sync/SyncRuntime";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { TaggedByOthersAllowance } from "./taggedByOthersAllowance";

/** Community answers for at most this many songs a request. */
export const LOOKUP_MAX_SONGS = 500;
/** At most this many requests wait on Community at a time. */
export const LOOKUP_CONCURRENCY = 2;
/** Community's capability that says the lookup exists, with the most songs it takes. */
export const TAGGED_BY_OTHERS_CAPABILITY = "taggedByOthersLookup";
const LOOKUP_PATH = "/api/v2/sync/tagged-by-others";
/** A breath between reads (a Liked Songs page, a playlist), so a large library never reads Spotify in a burst. */
const READ_PAUSE_MS = 200;
/**
 * Liked Songs read per page. Measured in Alex's Spotify (1.2.92, 11,935 Liked Songs, 2026-11-14):
 * a desktop library page of 50, 500 or 1,000 songs each answered in about 100 to 350 ms, so 500 a
 * page checks his Liked Songs in about 11 seconds and 24 reads, where 50 a page took 239 reads.
 */
export const LIKED_PAGE_SONGS = 500;
/**
 * After a Spotify page reload, an earlier slow desktop read (Smart Playlists, for one) can hold
 * every desktop read back for a while ("Spotify is taking too long to respond"); seen 2026-11-14 in
 * Alex's Spotify. That is Tagify's own guard, not Spotify asking to slow down, and nothing is sent
 * while it holds, so a Liked Songs page waits it out, every 2 seconds for up to a minute.
 */
const STALL_STEP_MS = 2_000;
const STALL_WAIT_MS = 60_000;
/** A list that adds at least this many new songs is asked about as soon as it is read. */
const EARLY_BATCH_SONGS = 100;
/** Songs a playlist read takes a page at a time (SpotifyLibrarySender reads playlists in pages of 100). */
const PLAYLIST_PAGE_SONGS = 100;
/** "Also check my playlists" reads at most this many playlists a press, and about this many songs. */
export const PLAYLISTS_PER_CHECK = 100;
export const PLAYLIST_SONGS_PER_CHECK = 20_000;

/**
 * What a check has read: Liked Songs only (the automatic check and "Check again"), or Liked Songs and
 * then playlists ("Also check my playlists"). Liked Songs held about 99.7% of the songs others
 * tagged in a 1,183-playlist library, while its playlists took about 95% of the time.
 */
export type TaggedByOthersScope = "liked" | "liked+playlists";

/** Why Community couldn't answer. */
export type CommunityStop = "not-available" | "paused" | "busy" | "unreachable";
/** Why a check ended before every song was checked; null when it checked them all. */
export type TaggedByOthersStop = CommunityStop | "spotify" | "allowance" | null;

export class TaggedByOthersLookupError extends Error {
  constructor(readonly reason: CommunityStop) {
    super(`Community lookup stopped: ${reason}`);
    this.name = "TaggedByOthersLookupError";
  }
}

/** One song other members tagged, as Community answers it. */
export interface TaggedByOthersItem {
  providerId: string;
  /** How many other members tagged the song; `peopleCapped` when Community stopped counting there. */
  people: number;
  peopleCapped: boolean;
  /** Up to three of those members' handles. */
  sample: string[];
  tags: CommunityMatchTag[];
}

/** A song of the member's that other members tagged. */
export interface TaggedByOthersMatch extends CommunityMatch {
  people: number;
  peopleCapped: boolean;
  sample: string[];
  /** Where the song was first read: Liked Songs newest first, then playlists in library order. */
  position: number;
  /** Where it was first read from; checks saved before this existed don't say. Its added date is `track.addedAt`. */
  from?: "liked" | "playlist";
}

export interface TaggedByOthersProgress {
  /** What this check reads. Checks saved before scopes existed read Liked Songs and playlists. */
  scope: TaggedByOthersScope;
  /** Songs Community has answered for; a song in several lists counts once. */
  checked: number;
  /** Songs other members tagged, in the order they were first read: Liked Songs, then playlists. */
  matches: TaggedByOthersMatch[];
  /** Playlists read so far, and how many there are; null while Liked Songs is still being read. */
  playlistsRead: number;
  playlists: number | null;
  /** Every song Community answered for, so a check that continues this one never asks about it again. */
  songIds: string[];
  /** Playlists playlist checks have read or passed over. */
  playlistIds: string[];
}

export interface TaggedByOthersOutcome extends TaggedByOthersProgress {
  stopped: TaggedByOthersStop;
  /** Playlists Spotify couldn't read; the check went on without them. */
  skippedPlaylists: number;
  /** The library holds more songs than one check covers; the rest weren't checked. */
  capped: boolean;
  /** Playlists still to check after the last playlist check; null before the first. */
  playlistsLeft: number | null;
}

/** The read limit was reached; ends the Spotify reads at once (`endsLibraryStream`). */
class AllowanceSpent extends Error {
  readonly endsLibraryStream = true;
  constructor() { super("Tagify has read enough from Spotify for this list for now"); this.name = "AllowanceSpent"; }
}

/** The reader with every Spotify read counted against the allowance first; a playlist costs a read per 100 songs. */
function countedReader(library: LibraryReader, allowance: TaggedByOthersAllowance, costs: Map<string, number>, sleep: (ms: number) => Promise<void>): LibraryReader {
  const spend = (reads: number) => { if (!allowance.take(reads)) throw new AllowanceSpent(); };
  return {
    // A page waits out Tagify's own hold on desktop reads (see STALL_WAIT_MS); it is counted once.
    getTaggingQueuePage: async (playlistId, offset, signal, pageSize) => {
      spend(1);
      for (let waited = 0; ; waited += STALL_STEP_MS) {
        try {
          return await library.getTaggingQueuePage(playlistId, offset, signal, pageSize);
        } catch (error) {
          if (!isLocalStall(error) || waited >= STALL_WAIT_MS || signal?.aborted) throw error;
          await sleep(STALL_STEP_MS);
          if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        }
      }
    },
    getAllUserPlaylistReferencesStrict: (signal) => { spend(1); return library.getAllUserPlaylistReferencesStrict(signal); },
    readPlaylistTracks: (playlistId, options) => { spend(costs.get(playlistId) ?? 1); return library.readPlaylistTracks(playlistId, options); },
  };
}
const UNLIMITED: TaggedByOthersAllowance = { take: () => true };

/** Reads a playlist of this many songs costs. */
export const playlistReads = (songCount: number | null) => Math.max(1, Math.ceil((songCount ?? 0) / PLAYLIST_PAGE_SONGS));

/**
 * The playlists worth checking, in library order: only ones the member made, never someone else's
 * (followed or collaborative), one Spotify made (mixes, editorial lists), an empty one, or one already
 * checked (Alex, 2026-11-17: "Users cannot ever select playlists that weren't created by them"). With
 * `chosen`, only those the member ticked in the playlist picker. `next` is what one press reads: at most
 * PLAYLISTS_PER_CHECK playlists and about PLAYLIST_SONGS_PER_CHECK songs, at least one.
 */
export function planPlaylists(catalog: RootlistCatalogPlaylist[], checked: Iterable<string>, chosen?: Iterable<string>): { left: RootlistCatalogPlaylist[]; next: RootlistCatalogPlaylist[] } {
  const done = new Set(checked);
  const picked = chosen ? new Set(chosen) : null;
  const left = catalog.filter((playlist) => isCheckablePlaylist(playlist) && !done.has(playlist.playlistId) && (!picked || picked.has(playlist.playlistId)));
  const next: RootlistCatalogPlaylist[] = [];
  let songs = 0;
  for (const playlist of left) {
    if (next.length >= PLAYLISTS_PER_CHECK || (next.length > 0 && songs + (playlist.songCount ?? 0) > PLAYLIST_SONGS_PER_CHECK)) break;
    next.push(playlist);
    songs += playlist.songCount ?? 0;
  }
  return { left, next };
}

/** A playlist the member may check: one they made, with songs, that Spotify didn't make. */
export const isCheckablePlaylist = (playlist: RootlistCatalogPlaylist) =>
  playlist.owned && /^[0-9A-Za-z]{22}$/.test(playlist.playlistId) && !playlist.spotifyMade && playlist.songCount !== 0;

type Session = Pick<DesktopSyncConfiguration, "apiBaseUrl" | "accessToken" | "deviceId">;
type Lookup = (songs: string[], signal?: AbortSignal) => Promise<TaggedByOthersItem[]>;

/** This device's Community session, or null while sync still has to refresh it. */
export function currentLookupSession(): Session | null {
  const configuration = getDesktopSyncConfiguration();
  return configuration && !sessionNeedsRefresh(configuration) ? configuration : null;
}

/**
 * What Community last said about the lookup, from the capability list sync keeps: how many songs a
 * request takes, null when Community doesn't offer it, or undefined when no list is saved.
 */
export function savedLookupLimit(apiBaseUrl: string): number | null | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(capabilitiesCacheKey(apiBaseUrl)) || "null") as { value?: Record<string, unknown> } | null;
    if (!saved?.value || typeof saved.value !== "object") return undefined;
    const capability = saved.value[TAGGED_BY_OTHERS_CAPABILITY] as { maxSongs?: unknown } | undefined;
    if (!capability || typeof capability !== "object") return null;
    const maxSongs = Number(capability.maxSongs);
    return Number.isInteger(maxSongs) && maxSongs > 0 ? Math.min(maxSongs, LOOKUP_MAX_SONGS) : LOOKUP_MAX_SONGS;
  } catch { return undefined; }
}

const HANDLE = /^[A-Za-z0-9_.-]{1,40}$/;

function itemsOf(payload: unknown): TaggedByOthersItem[] {
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const found: TaggedByOthersItem[] = [];
  for (const item of items as { providerId?: unknown; others?: { people?: unknown; peopleCapped?: unknown; sample?: unknown; tags?: unknown } }[]) {
    if (typeof item?.providerId !== "string" || !Array.isArray(item.others?.tags)) continue;
    const tags: CommunityMatchTag[] = [];
    for (const tag of item.others.tags as { label?: unknown; people?: unknown; path?: unknown }[]) {
      const label = typeof tag?.label === "string" ? tag.label.trim() : "";
      if (!label) continue;
      const path = typeof tag.path === "string" && tag.path.trim() ? tag.path.trim() : label;
      tags.push({ label, paths: [path], people: Number.isFinite(tag.people) ? Number(tag.people) : 1 });
    }
    if (!tags.length) continue;
    const sample = Array.isArray(item.others.sample) ? item.others.sample.filter((handle): handle is string => typeof handle === "string" && HANDLE.test(handle)).slice(0, 3) : [];
    const people = Number.isFinite(item.others.people) ? Math.max(1, Math.floor(Number(item.others.people))) : 1;
    found.push({ providerId: item.providerId, people: Math.max(people, sample.length), peopleCapped: item.others.peopleCapped === true, sample, tags });
  }
  return found;
}

/** Asks Community which of these songs other members tagged. Songs nobody else tagged are left out. */
export async function lookupTaggedByOthers(songs: string[], { request = fetch, session = currentLookupSession, signal }: {
  request?: typeof fetch;
  session?: () => Session | null;
  signal?: AbortSignal;
} = {}): Promise<TaggedByOthersItem[]> {
  const current = session();
  if (!current) throw new TaggedByOthersLookupError("unreachable");
  let response: Response;
  try {
    response = await request(`${current.apiBaseUrl}${LOOKUP_PATH}`, {
      method: "POST",
      headers: { ...syncClientHeaders(current.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: current.deviceId, songs }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TaggedByOthersLookupError("unreachable");
  }
  // A Community from before this lookup answers 404 (or 405 for a route it has under another method).
  if (response.status === 404 || response.status === 405) throw new TaggedByOthersLookupError("not-available");
  if (response.status === 503) throw new TaggedByOthersLookupError("paused");
  if (response.status === 429) throw new TaggedByOthersLookupError("busy");
  if (!response.ok) throw new TaggedByOthersLookupError("unreachable");
  const payload = await response.json().catch(() => null);
  if (!payload || !Array.isArray((payload as { items?: unknown }).items)) throw new TaggedByOthersLookupError("unreachable");
  return itemsOf(payload);
}

const isAbort = (error: unknown, signal?: AbortSignal) => !!signal?.aborted || (error instanceof DOMException && error.name === "AbortError");

/**
 * Checks the member's Liked Songs for tags other members added, a page at a time through Spotify's
 * desktop library, and asks Community about each song once, in batches. With `playlists`, it reads
 * those playlists instead and carries on from `continueFrom`: songs already checked aren't asked
 * about again, and what was found stays. At most 150,000 songs.
 *
 * Every Spotify read is counted against `allowance` first; reaching it ends the check ("allowance").
 * Spotify asking Tagify to wait (a 429, or the pause one left) ends the check with what was found;
 * nothing is retried and no pause is cleared. A playlist Spotify can't read is passed over and
 * counted. A Community that can't answer ends the check with what was found.
 */
export async function scanTaggedByOthers({
  library,
  playlists: chosen,
  continueFrom,
  allowance = UNLIMITED,
  lookup = (songs, signal) => lookupTaggedByOthers(songs, { signal }),
  batchSize = LOOKUP_MAX_SONGS,
  maxSongs = LISTS_MAX_SONGS,
  signal,
  onProgress,
  pausedUntil = () => spotifyBackgroundPolicy.retryAt(),
  sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  library: LibraryReader;
  /** Read these playlists, in this order, instead of Liked Songs. */
  playlists?: Array<{ playlistId: string; songCount?: number | null }>;
  /** The check this one continues; its songs aren't asked about again. */
  continueFrom?: TaggedByOthersOutcome;
  allowance?: TaggedByOthersAllowance;
  lookup?: Lookup;
  batchSize?: number;
  maxSongs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: TaggedByOthersProgress) => void;
  /** When Spotify's requested pause for background reads ends; nothing is read before it. */
  pausedUntil?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<TaggedByOthersOutcome> {
  const size = Math.max(1, Math.min(batchSize, LOOKUP_MAX_SONGS));
  const scope: TaggedByOthersScope = chosen ? "liked+playlists" : "liked";
  // Every song read so far (and every one the earlier check answered for); a song's details are
  // kept only until Community has answered for it.
  const answered = [...(continueFrom?.songIds ?? [])];
  const seen = new Set<string>(answered);
  const asking = new Map<string, { track: SpotifyTrack; position: number; from: "liked" | "playlist" }>();
  const found: TaggedByOthersMatch[] = [...(continueFrom?.matches ?? [])];
  const playlistIds = [...(continueFrom?.playlistIds ?? [])];
  let skippedPlaylists = continueFrom?.skippedPlaylists ?? 0;
  let capped = false;
  const running = new Set<Promise<void>>();
  let waiting: string[] = [];
  let checked = continueFrom?.checked ?? 0;
  let playlistsRead = 0;
  let playlists: number | null = chosen ? chosen.length : null;
  let stopped: TaggedByOthersStop = null;
  const progress = (): TaggedByOthersProgress => ({ scope, checked, matches: [...found], playlistsRead, playlists, songIds: [...answered], playlistIds: [...playlistIds] });
  const costs = new Map((chosen ?? []).map((playlist) => [playlist.playlistId, playlistReads(playlist.songCount ?? null)]));

  const ask = async (batch: string[]) => {
    try {
      const items = await lookup(batch, signal);
      if (signal?.aborted) return;
      // Only songs this request asked about, each once.
      const asked = new Set(batch);
      for (const item of items) {
        const song = asked.delete(item.providerId) ? asking.get(item.providerId) : undefined;
        if (song) found.push({ track: song.track, tags: item.tags, people: item.people, peopleCapped: item.peopleCapped, sample: item.sample, position: song.position, from: song.from });
      }
      for (const id of batch) asking.delete(id);
      answered.push(...batch);
      found.sort((a, b) => a.position - b.position);
      checked += batch.length;
      onProgress?.(progress());
    } catch (error) {
      if (isAbort(error, signal)) return;
      // The first reason stands; a second request failing the same way adds nothing.
      stopped ??= error instanceof TaggedByOthersLookupError ? error.reason : "unreachable";
    }
  };
  // Songs already read are still asked about when Spotify or the read limit ended the reading.
  const communityStopped = () => stopped !== null && stopped !== "spotify" && stopped !== "allowance";
  const send = async (batch: string[]) => {
    while (running.size >= LOOKUP_CONCURRENCY) await Promise.race(running);
    if (communityStopped() || signal?.aborted) return;
    const request: Promise<void> = ask(batch).finally(() => running.delete(request));
    running.add(request);
  };

  const lists = streamSpotifyLibrary(countedReader(library, allowance, costs, sleep), signal, chosen ? { playlists: chosen } : { likedOnly: true, likedPageSize: LIKED_PAGE_SONGS });
  try {
    for (let first = true; !stopped && !signal?.aborted; first = false) {
      // More songs than one check covers: what was read is still checked.
      if (seen.size >= maxSongs) { capped = true; break; }
      if (pausedUntil() > Date.now()) {
        stopped = "spotify";
        console.warn("Tagify: tagged by others check waits for Spotify's background pause");
        break;
      }
      if (!first) await sleep(READ_PAUSE_MS);
      let step: IteratorResult<SpotifyLibraryChunk, void>;
      try {
        step = await lists.next();
      } catch (error) {
        if (!isAbort(error, signal)) {
          stopped ??= error instanceof AllowanceSpent ? "allowance" : "spotify";
          // Why the read stopped, for diagnosing (no music or IDs in it).
          console.warn("Tagify: tagged by others check stopped reading Spotify:", error instanceof Error ? error.message : error);
        }
        break;
      }
      if (step.done) break;
      const chunk = step.value;
      const moved = playlists !== chunk.playlists || playlistsRead !== chunk.playlistsRead;
      playlists = chunk.playlists;
      playlistsRead = chunk.playlistsRead;
      if (chunk.skipped) skippedPlaylists += 1;
      if (chunk.playlistId) playlistIds.push(chunk.playlistId);
      for (const track of chunk.tracks) {
        const id = communitySong(track)?.id;
        if (!id || seen.has(id) || seen.size >= maxSongs) continue;
        asking.set(id, { track, position: seen.size, from: chunk.kind });
        seen.add(id);
        waiting.push(id);
      }
      while (waiting.length >= size && !stopped && !signal?.aborted) {
        const batch = waiting.slice(0, size);
        waiting = waiting.slice(size);
        await send(batch);
      }
      // Each list's songs are asked about when the list has been read, unless only a few are new.
      if (chunk.kind === "playlist" && waiting.length >= EARLY_BATCH_SONGS && !stopped && !signal?.aborted) {
        const batch = waiting;
        waiting = [];
        await send(batch);
      }
      if (moved && !signal?.aborted) onProgress?.(progress());
    }
  } finally {
    // Ends the reader without another Spotify read.
    await lists.return().catch(() => {});
  }

  // Songs already read are still checked when Spotify stopped; a Community that stopped is not asked again.
  if (waiting.length) await send(waiting);
  await Promise.all(running);
  return { ...progress(), stopped, skippedPlaylists, capped, songIds: answered, playlistIds, playlistsLeft: continueFrom?.playlistsLeft ?? null };
}
