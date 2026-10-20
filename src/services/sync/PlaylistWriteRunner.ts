import {
  assertPlaylistWriteClaim,
  PLAYLIST_WRITES_PROTOCOL_VERSION,
  type PlaylistWriteFailureV1,
  type PlaylistWriteResultV1,
  type PlaylistWriteV1,
} from "@tagify/sync-contracts";
import type { SendSession } from "./SpotifyLibrarySender";
import { isSpotifyBusy } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";
import { backoffDelayMs, isBusyStatus, retryAfterSeconds } from "./SyncRetryAfter";

// Keeps playlists the member made on Tagify Community in their Spotify (Community migration 0261,
// contract @tagify/sync-contracts playlistWrites). Community holds no Spotify sign-in, so Tagify
// writes them here through Spotify's desktop app (RootlistAPI, PlaylistAPI), never the Web API.
// Tagify takes waiting playlists (each held for 2 minutes), creates a private Spotify playlist for
// a new one or renames and refills the one it wrote before, and reports each one back.
//
// It stays quiet when idle: it asks only when Community advertises `playlistWrites`, once when
// Tagify starts, when the member asks on Community (a `playlist_write_request` broadcast), and
// every `pollMinutes` (15) while Spotify is open. A paused feature waits for the next poll; a busy
// or unreachable Community is asked again only after its Retry-After or a growing back-off.

/** What this Tagify tells Community it can do when it starts. */
export const PLAYLIST_WRITES_FEATURE = "playlistWrites";

/** What Community advertises in its capabilities when it takes playlist writes. */
export interface PlaylistWritesCapability {
  path: string;
  maxClaim: number;
  pollMinutes: number;
}

/** Community's `playlistWrites` capability when it speaks this protocol; null otherwise. */
export function playlistWritesCapability(capabilities: unknown): PlaylistWritesCapability | null {
  const value = (capabilities as { playlistWrites?: Record<string, unknown> } | null)?.playlistWrites;
  if (!value || value.protocolVersion !== PLAYLIST_WRITES_PROTOCOL_VERSION) return null;
  if (typeof value.path !== "string" || !/^\/api\/v2\/sync\/[a-z-]+$/.test(value.path)) return null;
  const maxClaim = Number.isSafeInteger(value.maxClaim) && Number(value.maxClaim) > 0 ? Math.min(Number(value.maxClaim), 50) : 5;
  // Never more often than every 15 minutes, whatever Community says.
  const pollMinutes = Number.isFinite(value.pollMinutes) ? Math.min(Math.max(Number(value.pollMinutes), 15), 24 * 60) : 15;
  return { path: value.path, maxClaim, pollMinutes };
}

/** Whether this Spotify can create private playlists and change their songs from Tagify. */
export function canWritePlaylists(platform: unknown = typeof Spicetify === "undefined" ? undefined : Spicetify.Platform): boolean {
  const api = platform as {
    RootlistAPI?: { createPlaylist?: unknown; remove?: unknown };
    PlaylistAPI?: { add?: unknown; remove?: unknown; getContents?: unknown; getMetadata?: unknown; updateDetails?: unknown };
    PlaylistPermissionsAPI?: { setBasePermission?: unknown; getBasePermission?: unknown };
  } | undefined;
  return [
    api?.RootlistAPI?.createPlaylist, api?.RootlistAPI?.remove,
    api?.PlaylistAPI?.add, api?.PlaylistAPI?.remove, api?.PlaylistAPI?.getContents, api?.PlaylistAPI?.getMetadata, api?.PlaylistAPI?.updateDetails,
    api?.PlaylistPermissionsAPI?.setBasePermission, api?.PlaylistPermissionsAPI?.getBasePermission,
  ].every((method) => typeof method === "function");
}

/** What the runner needs from Spotify's desktop app (SpotifyApiService). */
export interface PlaylistWriter {
  /** A new private playlist; its Spotify id. */
  createPrivatePlaylist(name: string, description: string): Promise<string>;
  /** `mine` while the playlist is in the member's library and theirs to change; `gone` once they deleted it or it isn't theirs. */
  ownPlaylistState(playlistId: string): Promise<"mine" | "gone">;
  updatePlaylistDetails(playlistId: string, details: { name: string; description: string }): Promise<void>;
  /** Leaves the playlist holding exactly `uris`, in order. */
  replacePlaylistTracks(playlistId: string, uris: string[]): Promise<void>;
}

/** Remembers playlists Tagify created but Community hasn't heard about, so a retry fills the same one. */
export interface CreatedPlaylists {
  get(communityId: string): string | null;
  set(communityId: string, spotifyPlaylistId: string): void;
  delete(communityId: string): void;
}

const CREATED_KEY = "tagify:playlist-writes:created:v1:";
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/** Kept in localStorage per Spotify account, until Community records the playlist. */
export function localCreatedPlaylists(account: () => string): CreatedPlaylists {
  const key = (communityId: string) => `${CREATED_KEY}${encodeURIComponent(account())}:${communityId}`;
  return {
    get: (communityId) => {
      try {
        const value = localStorage.getItem(key(communityId));
        return value && SPOTIFY_ID.test(value) ? value : null;
      } catch { return null; }
    },
    set: (communityId, spotifyPlaylistId) => { try { localStorage.setItem(key(communityId), spotifyPlaylistId); } catch { /* best effort */ } },
    delete: (communityId) => { try { localStorage.removeItem(key(communityId)); } catch { /* best effort */ } },
  };
}

const writeFailure = (error: unknown): PlaylistWriteFailureV1 => (isSpotifyBusy(error) ? "spotify_busy" : "spotify_unavailable");

/** Writes one claimed playlist to Spotify; never throws. `created` is set when a new Spotify playlist was made. */
export async function writeClaimedPlaylist(writer: PlaylistWriter, playlist: PlaylistWriteV1, created: CreatedPlaylists): Promise<PlaylistWriteResultV1 & { created?: boolean }> {
  const uris = playlist.trackIds.map((trackId) => `spotify:track:${trackId}`);
  try {
    let spotifyPlaylistId = playlist.spotifyPlaylistId;
    let isNew = false;
    if (spotifyPlaylistId) {
      if (await writer.ownPlaylistState(spotifyPlaylistId) === "gone") return { id: playlist.id, result: "failed", failure: "playlist_gone" };
      await writer.updatePlaylistDetails(spotifyPlaylistId, { name: playlist.name, description: playlist.description });
    } else {
      // A playlist this Tagify made on an earlier try that Community never heard about is filled
      // again rather than doubled, unless the member deleted it meanwhile.
      const earlier = created.get(playlist.id);
      if (earlier && await writer.ownPlaylistState(earlier) === "mine") {
        spotifyPlaylistId = earlier;
        await writer.updatePlaylistDetails(earlier, { name: playlist.name, description: playlist.description });
      } else {
        spotifyPlaylistId = await writer.createPrivatePlaylist(playlist.name, playlist.description);
        created.set(playlist.id, spotifyPlaylistId);
        isNew = true;
      }
    }
    await writer.replacePlaylistTracks(spotifyPlaylistId, uris);
    return { id: playlist.id, result: "written", spotifyPlaylistId, fingerprint: playlist.fingerprint, ...(isNew ? { created: true } : {}) };
  } catch (error) {
    return { id: playlist.id, result: "failed", failure: writeFailure(error) };
  }
}

export interface PlaylistWriteRun {
  written: number;
  failed: number;
  /** Names of playlists Tagify newly created in Spotify. */
  created: string[];
  /**
   * Why Tagify stopped asking Community, when it did: `unsupported` (no playlist writes there),
   * `paused` (Community paused them), `signed_out`, `busy` (429 or 5xx) or `network`.
   */
  stopped?: "unsupported" | "paused" | "signed_out" | "busy" | "network";
  /** Seconds Community asked Tagify to wait, when it did. */
  retryAfterSeconds?: number | null;
}

class CommunityStop extends Error {
  constructor(readonly reason: NonNullable<PlaylistWriteRun["stopped"]>, readonly retryAfter: number | null = null) {
    super(`Community stopped playlist writes: ${reason}`);
    this.name = "CommunityStop";
  }
}

async function stopFor(response: Response): Promise<CommunityStop> {
  const retryAfter = retryAfterSeconds(response.headers.get("retry-after"));
  if (response.status === 404) return new CommunityStop("unsupported");
  if (response.status === 401 || response.status === 403) return new CommunityStop("signed_out");
  if (response.status === 503) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
    if (body?.error?.code === "playlists_paused") return new CommunityStop("paused", retryAfter);
  }
  return new CommunityStop(isBusyStatus(response.status) ? "busy" : "network", retryAfter);
}

const ENTITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROUNDS = 10;

/** The playlists in a claim Tagify can write, and the ids of ones it can't read (reported failed). */
export function readPlaylistClaim(value: unknown, maxClaim: number): { playlists: PlaylistWriteV1[]; unreadable: string[] } {
  const items = Array.isArray((value as { playlists?: unknown } | null)?.playlists) ? (value as { playlists: unknown[] }).playlists.slice(0, maxClaim) : [];
  const playlists: PlaylistWriteV1[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !ENTITY_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    try {
      const one = { playlists: [item] };
      assertPlaylistWriteClaim(one);
      playlists.push(one.playlists[0]);
    } catch {
      unreadable.push(id);
    }
  }
  return { playlists, unreadable };
}

/**
 * Takes the playlists waiting on Community and writes them, until none are left. Never throws; a
 * Community without playlist writes (404), a paused feature or a lost connection ends the run, and
 * playlists it took but couldn't report are handed out again after their claim runs out.
 */
export async function runPlaylistWrites(
  session: SendSession,
  writer: PlaylistWriter,
  capability: PlaylistWritesCapability,
  created: CreatedPlaylists,
  request: typeof fetch = fetch,
  maxRounds = MAX_ROUNDS,
): Promise<PlaylistWriteRun> {
  const run: PlaylistWriteRun = { written: 0, failed: 0, created: [] };
  const call = async (method: "POST" | "PUT", body: Record<string, unknown>) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}${capability.path}`, {
        method,
        headers: { ...syncClientHeaders(current.accessToken), "content-type": "application/json" },
        body: JSON.stringify({ deviceId: current.deviceId, ...body }),
      });
    } catch {
      throw new CommunityStop("network");
    }
    if (!response.ok) throw await stopFor(response);
    return await response.json().catch(() => ({})) as unknown;
  };
  try {
    for (let round = 0; round < maxRounds; round++) {
      const claimed = readPlaylistClaim(await call("POST", {}), capability.maxClaim);
      const taken = claimed.playlists.length + claimed.unreadable.length;
      if (!taken) break;
      const results: Array<PlaylistWriteResultV1 & { created?: boolean }> = [];
      // One playlist at a time, so Spotify sees a steady few writes rather than a burst.
      for (const playlist of claimed.playlists) results.push(await writeClaimedPlaylist(writer, playlist, created));
      for (const id of claimed.unreadable) results.push({ id, result: "failed", failure: "unknown" });
      await call("PUT", { results: results.map(({ created: _created, ...result }) => result) });
      for (const result of results) {
        if (result.result === "written") {
          run.written++;
          created.delete(result.id);
          if (result.created) run.created.push(claimed.playlists.find((playlist) => playlist.id === result.id)!.name);
        } else run.failed++;
      }
      if (taken < capability.maxClaim) break;
    }
  } catch (error) {
    if (error instanceof CommunityStop) {
      run.stopped = error.reason;
      run.retryAfterSeconds = error.retryAfter;
    } else run.stopped = "network";
  }
  return run;
}

/** The Spotify notification after a run: only when a new playlist arrived. Updates stay quiet. */
export function playlistWriteNotice(run: Pick<PlaylistWriteRun, "created">): string | null {
  if (!run.created.length) return null;
  if (run.created.length === 1) return `Added “${run.created[0]}” from Tagify Community to your Spotify playlists.`;
  return `Added ${run.created.length.toLocaleString()} playlists from Tagify Community to your Spotify playlists.`;
}

/** Back-off after Community was busy or unreachable; Retry-After is honored up to 6 hours. */
const BACKOFF = { baseMs: 60_000, maxMs: 2 * 60 * 60_000, maxRetryAfterMs: 6 * 60 * 60_000 };

export interface PlaylistWriteSchedulerOptions {
  run: (capability: PlaylistWritesCapability) => Promise<PlaylistWriteRun>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  random?: () => number;
}

/**
 * When Tagify asks Community for playlists to write: on `poll` (each pull; the first one after
 * Tagify starts runs at once, later ones only once `pollMinutes` passed), on `request` (the
 * member's broadcast) and on its own timer every `pollMinutes` while Spotify is open. Never when
 * Community doesn't advertise playlist writes; never sooner than a pause, Retry-After or back-off allows.
 */
export class PlaylistWriteScheduler {
  private capability: PlaylistWritesCapability | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private lastRunAt = 0;
  private notBefore = 0;
  private failures = 0;
  private unsupported = false;
  private timer: unknown = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: PlaylistWriteSchedulerOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  /** After a pull, with Community's capabilities (null when this Spotify can't write playlists). */
  poll(capabilities: unknown): void {
    this.stopped = false;
    this.capability = playlistWritesCapability(capabilities);
    if (!this.capability || this.unsupported) { this.cancelTimer(); return; }
    if (this.now() - this.lastRunAt >= this.intervalMs()) this.trigger();
    else this.arm();
  }

  /** The member asked on Community; only when Community already advertised playlist writes. */
  request(): void {
    if (this.stopped || !this.capability || this.unsupported) return;
    this.trigger();
  }

  /** Sync stopped: no more asking until the next start. A run in progress finishes. */
  stop(): void {
    this.stopped = true;
    this.cancelTimer();
    this.capability = null;
    this.again = false;
    this.lastRunAt = 0;
    this.notBefore = 0;
    this.failures = 0;
    this.unsupported = false;
  }

  /** The current run, for tests. */
  get pending(): Promise<void> | null { return this.running; }

  private intervalMs(): number { return (this.capability?.pollMinutes ?? 15) * 60_000; }

  private trigger(): void {
    if (this.now() < this.notBefore) { this.arm(); return; }
    if (this.running) { this.again = true; return; }
    const capability = this.capability!;
    this.cancelTimer();
    this.running = (async () => {
      try {
        do {
          this.again = false;
          this.lastRunAt = this.now();
          const run = await this.options.run(capability).catch((): PlaylistWriteRun => ({ written: 0, failed: 0, created: [], stopped: "network" }));
          this.settle(run);
        } while (this.again && !this.stopped && this.capability && this.now() >= this.notBefore);
      } finally {
        this.running = null;
        this.again = false;
        if (!this.stopped) this.arm();
      }
    })();
  }

  private settle(run: PlaylistWriteRun): void {
    const now = this.now();
    switch (run.stopped) {
      case undefined:
        this.failures = 0;
        this.notBefore = 0;
        return;
      case "unsupported":
        this.unsupported = true;
        return;
      case "paused":
      case "signed_out":
        // Wait for the next poll (longer when Community asked for longer).
        this.failures = 0;
        this.notBefore = now + Math.max(this.intervalMs(), Math.min((run.retryAfterSeconds ?? 0) * 1_000, BACKOFF.maxRetryAfterMs));
        return;
      default:
        this.failures++;
        this.notBefore = now + backoffDelayMs(this.failures, run.retryAfterSeconds ?? null, BACKOFF, this.options.random);
    }
  }

  /** The next poll: `pollMinutes` after the last run, or when a wait ends if that's later. */
  private arm(): void {
    this.cancelTimer();
    if (this.stopped || !this.capability || this.unsupported) return;
    const at = Math.max(this.lastRunAt + this.intervalMs(), this.notBefore);
    // setTimeout fires at once beyond about 24.8 days; waits here are hours at most.
    this.timer = this.setTimer(() => { this.timer = null; if (!this.stopped && this.capability) this.trigger(); }, Math.max(1_000, at - this.now()));
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}
