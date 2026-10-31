import {
  assertSongNamesNeeded, MAX_SONG_NAME_REPORT_ITEMS, MAX_SONG_NAMES_NEEDED, normalizeArtworkUrl, normalizeSongTitle,
  SONG_NAMES_PROTOCOL_VERSION, type SongNameEntityV1, type SongNameReportItemV1,
} from "@tagify/sync-contracts";
import type { SendSession } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// Community pages name each shared song, album and artist. Asking Spotify for every one leaves new
// music unnamed for hours, so Tagify sends the names and artwork it already saved for its library
// (Community migration desktop_song_names). Community asks only for music in this member's library
// it has no name for. Nothing here sends a Spotify request: music Tagify has no saved name for is
// skipped, and Community's own background worker names it later.

const MAX_ROUNDS = 20;

/** A name and artwork as Tagify saved them. */
export interface SavedName { name?: string | null; imageUrl?: string | null }
/** A saved song, with the album Tagify saved it from. */
export interface SavedSong extends SavedName { albumUri?: string | null; albumName?: string | null }

/** Where Tagify finds names. Every source reads only what Tagify saved on this computer. */
export interface SongNameSources {
  savedSongs(trackUris: string[]): Promise<Map<string, SavedSong>>;
  /** Albums Tagify keeps beside playlists. */
  savedAlbum(albumUri: string): Promise<SavedName | null>;
  savedArtist(artistUri: string): Promise<SavedName | null>;
}

export interface SongNameRun {
  sent: number;
  stopped?: "unsupported" | "paused" | "signed_out" | "network";
}

class Stop extends Error {
  constructor(readonly reason: NonNullable<SongNameRun["stopped"]>) { super(`Song names stopped: ${reason}`); }
}

const stopFor = (status: number): NonNullable<SongNameRun["stopped"]> =>
  status === 404 ? "unsupported" : status === 503 ? "paused" : status === 401 || status === 403 ? "signed_out" : "network";

const uriOf = (entity: SongNameEntityV1) => `spotify:${entity.kind}:${entity.providerId}`;

/** A saved name as Community takes it, or null when Tagify has none worth showing. */
export function songNameItem(entity: SongNameEntityV1, ...saved: Array<SavedName | null | undefined>): SongNameReportItemV1 | null {
  const title = saved.map((source) => normalizeSongTitle(source?.name)).find(Boolean);
  if (!title) return null;
  const thumbnailUrl = saved.map((source) => normalizeArtworkUrl(source?.imageUrl)).find(Boolean) ?? null;
  return { entity, title, thumbnailUrl };
}

/**
 * Names one page Community asked for from what Tagify saved. An album without its own record takes
 * the name a song from it on the same page was saved with.
 */
export async function resolveSongNames(items: SongNameEntityV1[], sources: SongNameSources): Promise<SongNameReportItemV1[]> {
  const tracks = items.filter((entity) => entity.kind === "track");
  const songs = tracks.length ? await sources.savedSongs(tracks.map(uriOf)) : new Map<string, SavedSong>();
  const albumsFromSongs = new Map<string, SavedName>();
  for (const song of songs.values()) {
    if (song.albumUri && song.albumName && !albumsFromSongs.has(song.albumUri)) albumsFromSongs.set(song.albumUri, { name: song.albumName, imageUrl: song.imageUrl });
  }
  const named = await Promise.all(items.map(async (entity) => {
    const uri = uriOf(entity);
    if (entity.kind === "track") return songNameItem(entity, songs.get(uri));
    if (entity.kind === "album") return songNameItem(entity, await sources.savedAlbum(uri), albumsFromSongs.get(uri));
    return songNameItem(entity, await sources.savedArtist(uri));
  }));
  return named.filter((item): item is SongNameReportItemV1 => item !== null);
}

/**
 * Sends Community the names it asked for, page by page, until nothing is left or Community asks
 * Tagify to stop. Never throws.
 */
export async function runSongNameReports(
  session: SendSession, sources: SongNameSources, options: { request?: typeof fetch; maxRounds?: number } = {},
): Promise<SongNameRun> {
  const request = options.request ?? fetch;
  const run: SongNameRun = { sent: 0 };
  const call = async (path: string, init: RequestInit = {}) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}/api/v2/sync/song-names${path.replace("{device}", encodeURIComponent(current.deviceId))}`, {
        ...init,
        headers: { ...syncClientHeaders(current.accessToken), ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch {
      throw new Stop("network");
    }
    if (!response.ok) throw new Stop(stopFor(response.status));
    const body = await response.json().catch(() => null) as unknown;
    // Community's song names switch is off: leave it alone until the next run.
    if ((body as { paused?: unknown } | null)?.paused === true) throw new Stop("paused");
    return body;
  };
  // Music Tagify has no saved name for stays at the head of Community's list; skip past it.
  let offset = 0;
  try {
    for (let round = 0; round < (options.maxRounds ?? MAX_ROUNDS); round++) {
      const body = await call(`?deviceId={device}&limit=${MAX_SONG_NAMES_NEEDED}&offset=${offset}`);
      assertSongNamesNeeded(body);
      if (!body.items.length) break;
      const found = await resolveSongNames(body.items, sources);
      for (let start = 0; start < found.length; start += MAX_SONG_NAME_REPORT_ITEMS) {
        const items = found.slice(start, start + MAX_SONG_NAME_REPORT_ITEMS);
        const current = await session();
        await call("", { method: "POST", body: JSON.stringify({ protocolVersion: SONG_NAMES_PROTOCOL_VERSION, deviceId: current.deviceId, items }) });
        run.sent += items.length;
      }
      offset += body.items.length - found.length;
      if (!body.hasMore) break;
    }
  } catch (error) {
    run.stopped = error instanceof Stop ? error.reason : "network";
  }
  return run;
}
