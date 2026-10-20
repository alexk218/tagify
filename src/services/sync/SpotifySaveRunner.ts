import type { SendSession } from "./SpotifyLibrarySender";
import { isSpotifyBusy } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// Saves songs to the member's Spotify Liked Songs when they ask on Tagify Community (Community
// docs/SPOTIFY_LIKED_SONGS_2026-10.md). Community holds no Spotify sign-in, so the save happens
// here, through Spotify's desktop app (LibraryAPI), never the Web API. Tagify takes waiting songs
// (each held for 60 seconds), saves the ones not already saved, checks they arrived, and reports
// each song back so the member's card shows it saved.

/** What this Tagify tells Community it can do when it starts. */
export const SPOTIFY_SAVES_FEATURE = "spotifySaves";

/** What the runner needs from Spotify's desktop app (SpotifyApiService). */
export interface LikedSongsWriter {
  likedSongsContain(uris: string[]): Promise<boolean[]>;
  saveToLikedSongs(uris: string[]): Promise<void>;
}

/** Whether this Spotify can save songs to Liked Songs from Tagify. */
export function canSaveToLikedSongs(platform: unknown = typeof Spicetify === "undefined" ? undefined : Spicetify.Platform): boolean {
  const api = (platform as { LibraryAPI?: { add?: unknown; contains?: unknown } } | undefined)?.LibraryAPI;
  return typeof api?.add === "function" && typeof api?.contains === "function";
}

export type SpotifySaveFailure = "spotify_unavailable" | "spotify_busy" | "unknown";
export type SpotifySaveResult =
  | { id: string; result: "saved" | "already_saved" }
  | { id: string; result: "failed"; failure: SpotifySaveFailure };

export interface SpotifySaveRun {
  saved: number;
  alreadySaved: number;
  failed: number;
  /** Why Tagify stopped asking Community, when it did. */
  stopped?: "unsupported" | "paused" | "signed_out" | "network";
}

/** Songs Community hands out per claim, and claims per run. */
const CLAIM_SIZE = 50;
const MAX_ROUNDS = 10;
const ENTITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACK_ID = /^[0-9A-Za-z]{22}$/;

class CommunityStop extends Error {
  constructor(readonly reason: NonNullable<SpotifySaveRun["stopped"]>) {
    super(`Community stopped Spotify saves: ${reason}`);
    this.name = "CommunityStop";
  }
}

function stopFor(status: number): NonNullable<SpotifySaveRun["stopped"]> {
  if (status === 404) return "unsupported";
  if (status === 503) return "paused";
  if (status === 401 || status === 403) return "signed_out";
  return "network";
}

const saveFailure = (error: unknown): SpotifySaveFailure => (isSpotifyBusy(error) ? "spotify_busy" : "spotify_unavailable");

/** Saves one claimed batch: songs already in Liked Songs are left alone, the rest are added and checked. */
export async function saveClaimedSongs(writer: LikedSongsWriter, songs: Array<{ id: string; trackId: string }>): Promise<SpotifySaveResult[]> {
  const uris = songs.map((song) => `spotify:track:${song.trackId}`);
  let before: boolean[];
  try {
    before = await writer.likedSongsContain(uris);
  } catch (error) {
    const failure = saveFailure(error);
    return songs.map((song) => ({ id: song.id, result: "failed", failure }));
  }
  const missing = uris.filter((_, index) => !before[index]);
  let addFailure: SpotifySaveFailure | null = null;
  if (missing.length) {
    try { await writer.saveToLikedSongs(missing); } catch (error) { addFailure = saveFailure(error); }
  }
  // Check the songs arrived; when Spotify can't say, a save it accepted counts as saved.
  let after: boolean[] | null = before;
  if (missing.length) {
    try { after = await writer.likedSongsContain(uris); } catch { after = null; }
  }
  return songs.map((song, index): SpotifySaveResult => {
    if (before[index]) return { id: song.id, result: "already_saved" };
    if (after ? after[index] : !addFailure) return { id: song.id, result: "saved" };
    return { id: song.id, result: "failed", failure: addFailure ?? "unknown" };
  });
}

/**
 * Takes the songs waiting on Community and saves them, until none are left. Never throws; a
 * Community without saves (404), a paused feature or a lost connection ends the run quietly, and
 * songs it took but couldn't report are handed out again after their claim runs out.
 */
export async function runSpotifySaves(session: SendSession, writer: LikedSongsWriter, request: typeof fetch = fetch, maxRounds = MAX_ROUNDS): Promise<SpotifySaveRun> {
  const run: SpotifySaveRun = { saved: 0, alreadySaved: 0, failed: 0 };
  const call = async (method: "POST" | "PUT", body: Record<string, unknown>) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}/api/v2/sync/spotify-saves`, {
        method,
        headers: { ...syncClientHeaders(current.accessToken), "content-type": "application/json" },
        body: JSON.stringify({ deviceId: current.deviceId, ...body }),
      });
    } catch {
      throw new CommunityStop("network");
    }
    if (!response.ok) throw new CommunityStop(stopFor(response.status));
    return await response.json().catch(() => ({})) as Record<string, unknown>;
  };
  try {
    for (let round = 0; round < maxRounds; round++) {
      const claimed = await call("POST", {});
      const songs = (Array.isArray(claimed.saves) ? claimed.saves : [])
        .filter((song): song is { id: string; trackId: string } => ENTITY_ID.test(String((song as { id?: unknown })?.id)) && TRACK_ID.test(String((song as { trackId?: unknown })?.trackId)))
        .slice(0, CLAIM_SIZE);
      if (!songs.length) break;
      const results = await saveClaimedSongs(writer, songs);
      await call("PUT", { results });
      for (const result of results) {
        if (result.result === "saved") run.saved++;
        else if (result.result === "already_saved") run.alreadySaved++;
        else run.failed++;
      }
      if (songs.length < CLAIM_SIZE) break;
    }
  } catch (error) {
    if (error instanceof CommunityStop) run.stopped = error.reason;
    else run.stopped = "network";
  }
  return run;
}

/** The Spotify notification after a run; nothing when there's nothing new to tell. */
export function spotifySaveNotice(run: Pick<SpotifySaveRun, "saved" | "alreadySaved" | "failed">): { text: string; error: boolean } | null {
  if (run.failed) {
    return { text: `Tagify couldn't save ${run.failed === 1 ? "a song" : `${run.failed.toLocaleString()} songs`} to your Liked Songs. Try again on Tagify Community.`, error: true };
  }
  if (run.saved) {
    return { text: `Saved ${run.saved === 1 ? "a song" : `${run.saved.toLocaleString()} songs`} from Tagify Community to your Liked Songs.`, error: false };
  }
  if (run.alreadySaved) return { text: run.alreadySaved === 1 ? "That song is already in your Liked Songs." : "Those songs are already in your Liked Songs.", error: false };
  return null;
}
