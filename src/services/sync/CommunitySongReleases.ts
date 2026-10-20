import {
  assertSongReleasesNeeded, isSpotifyImageUrl, MAX_SONG_RELEASE_REPORT_ITEMS, MAX_SONG_RELEASES_NEEDED,
  normalizeIsrc, normalizeReleaseKind, normalizeReleaseName, SONG_RELEASES_PROTOCOL_VERSION,
  type SongReleaseAlbumV1, type SongReleaseEntityV1, type SongReleaseReportItemV1,
} from "@tagify/sync-contracts";
import type { SendSession } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// Community names the album on each song page and gives every Spotify version of one recording
// (the same ISRC) a single page. Its Spotify Web API quota is too small to look that up for every
// song, so Tagify reads each song's ISRC and release here, through Spotify's desktop app, and sends
// them (Community migration 0261). Community asks only for songs in this member's library that it
// knows no release for. Reads are paced in the background and stop at Spotify's first refusal.

/** Background Spotify reads this feature may make in an hour (SpotifyBackgroundPolicy keeps at most 200). */
export const SONG_RELEASE_HOURLY_READS = 150;
export const SONG_RELEASE_FEATURE = "community-song-releases";
const MAX_ROUNDS = 20;
// Songs Spotify couldn't place on a release aren't read again for a week.
const UNAVAILABLE_KEY = "tagify:community-song-releases:unavailable:v1";
const UNAVAILABLE_MS = 7 * 24 * 60 * 60_000;
const MAX_UNAVAILABLE = 5_000;

/** A release as Spotify's desktop app describes it, before any checks. */
export interface SpotifyAlbumRelease { name: unknown; type: unknown; date: unknown; coverSources: unknown }

/** Where Tagify finds a song's ISRC and release, cheapest first. Only the async Spotify reads send a request. */
export interface SongReleaseSources {
  /** The ISRC and album Tagify already saved for these songs. No request. */
  knownSongs(trackUris: string[]): Promise<Map<string, { isrc?: string | null; albumUri?: string | null }>>;
  /** One desktop metadata read: the song's ISRC (null when Spotify lists none) and its album. Undefined when Spotify can't say. */
  trackRelease(trackUri: string): Promise<{ isrc: string | null; albumUri: string | null } | undefined>;
  /** One read per album, shared by every song on it. */
  albumRelease(albumUri: string): Promise<SpotifyAlbumRelease | null>;
  /** Takes one of the hour's background reads for this identity; false when none are left or Spotify asked Tagify to wait. */
  reserve(identity: string): boolean;
  /** Waits between reads so they never come in a burst. */
  pace?(): Promise<void>;
}

export interface SongReleaseRun {
  sent: number;
  /** Spotify reads made. */
  reads: number;
  stopped?: "unsupported" | "paused" | "signed_out" | "network" | "spotify" | "budget";
}

class Stop extends Error {
  constructor(readonly reason: NonNullable<SongReleaseRun["stopped"]>) { super(`Song releases stopped: ${reason}`); }
}

const stopFor = (status: number): NonNullable<SongReleaseRun["stopped"]> =>
  status === 404 ? "unsupported" : status === 503 ? "paused" : status === 401 || status === 403 ? "signed_out" : "network";

const uriOf = (entity: SongReleaseEntityV1) => `spotify:track:${entity.providerId}`;
const albumIdOf = (uri: string | null | undefined) => /^spotify:album:([A-Za-z0-9]{22})$/.exec(uri ?? "")?.[1] ?? null;

/** Spotify's release date at the precision Spotify knows it: "2024", "2024-06" or "2024-06-01". */
export function releaseDate(date: unknown): string | null {
  if (!date || typeof date !== "object") return null;
  const { isoString, precision, year } = date as { isoString?: unknown; precision?: unknown; year?: unknown };
  const iso = typeof isoString === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(isoString) ? isoString : null;
  const known = typeof precision === "string" ? precision.toUpperCase() : null;
  if (iso && known === "DAY") return iso.slice(0, 10);
  if (iso && known === "MONTH") return iso.slice(0, 7);
  if (iso && known === "YEAR") return iso.slice(0, 4);
  // Without a precision only the year is certain: Spotify fills unknown months and days with 01.
  if (typeof year === "number" && Number.isInteger(year) && year >= 1000 && year <= 9999) return String(year);
  return iso ? iso.slice(0, 4) : null;
}

/** The cover Community shows: Spotify's 300 px image when listed, otherwise the largest up to 640 px. */
export function coverImage(sources: unknown): string | null {
  const usable = (Array.isArray(sources) ? sources : []).filter((source): source is { url: string; width?: unknown } => isSpotifyImageUrl(source?.url));
  const width = (source: { width?: unknown }) => typeof source.width === "number" ? source.width : 0;
  const pick = usable.find((source) => width(source) === 300)
    ?? [...usable].filter((source) => width(source) <= 640).sort((left, right) => width(right) - width(left))[0]
    ?? usable[0];
  return pick?.url ?? null;
}

/** A release as Community takes it, or null when Spotify's answer can't name it accurately. */
export function songReleaseAlbum(albumUri: string, release: SpotifyAlbumRelease | null | undefined): SongReleaseAlbumV1 | null {
  const providerId = albumIdOf(albumUri);
  const name = normalizeReleaseName(release?.name);
  const albumType = normalizeReleaseKind(release?.type);
  if (!providerId || !release || !name || !albumType) return null;
  return { providerId, name, albumType, releaseDate: releaseDate(release.date), imageUrl: coverImage(release.coverSources) };
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const defaultStorage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

function readUnavailable(storage: Storage | null, now: number): Map<string, number> {
  try {
    const parsed = JSON.parse(storage?.getItem(UNAVAILABLE_KEY) ?? "{}") as Record<string, unknown>;
    return new Map(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > now));
  } catch {
    return new Map();
  }
}

function saveUnavailable(storage: Storage | null, entries: Map<string, number>) {
  try {
    const newest = [...entries].sort((left, right) => right[1] - left[1]).slice(0, MAX_UNAVAILABLE);
    storage?.setItem(UNAVAILABLE_KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch { /* A full disk only means some songs are read again. */ }
}

/**
 * Reads the ISRC and release of one page of songs Community asked for. What Tagify already saved
 * costs nothing; each song otherwise takes one read, and each album one read shared by its songs.
 */
export async function resolveSongReleases(
  items: SongReleaseEntityV1[], sources: SongReleaseSources, unavailable: Map<string, number>,
  albums = new Map<string, SongReleaseAlbumV1 | null>(), now = Date.now(),
): Promise<{ found: SongReleaseReportItemV1[]; reads: number; halted: "budget" | "spotify" | null }> {
  const found: SongReleaseReportItemV1[] = [];
  let reads = 0;
  let halted: "budget" | "spotify" | null = null;
  const read = async <T>(identity: string, request: () => Promise<T>): Promise<T | null> => {
    if (!sources.reserve(identity)) { halted = "budget"; return null; }
    reads += 1;
    await sources.pace?.();
    // A failure is Spotify refusing or being unreachable: stop, never retry around it.
    try { return await request(); } catch { halted = "spotify"; return null; }
  };
  const remember = (entity: SongReleaseEntityV1) => unavailable.set(uriOf(entity), now + UNAVAILABLE_MS);

  const pending = items.filter((entity) => !unavailable.has(uriOf(entity)));
  const known = pending.length ? await sources.knownSongs(pending.map(uriOf)) : new Map();
  for (const entity of pending) {
    if (halted) break;
    const saved = known.get(uriOf(entity));
    let isrc = normalizeIsrc(saved?.isrc);
    let albumUri = albumIdOf(saved?.albumUri) ? saved!.albumUri! : null;
    // Without a saved ISRC Tagify can't tell "Spotify lists none" from "never asked", so it asks.
    if (!isrc || !albumUri) {
      const answer = await read(`track:${uriOf(entity)}`, () => sources.trackRelease(uriOf(entity)));
      if (halted) break;
      if (!answer) { remember(entity); continue; }
      isrc = normalizeIsrc(answer.isrc);
      albumUri = albumIdOf(answer.albumUri) ? answer.albumUri : albumUri;
    }
    if (!albumUri) { remember(entity); continue; }
    if (!albums.has(albumUri)) {
      const release = await read(`album:${albumUri}`, () => sources.albumRelease(albumUri!));
      if (halted) break;
      albums.set(albumUri, songReleaseAlbum(albumUri, release));
    }
    const album = albums.get(albumUri);
    if (!album) { remember(entity); continue; }
    found.push({ entity, isrc, album });
  }
  return { found, reads, halted };
}

/**
 * Sends Community the releases it asked for, page by page, until nothing is left, the hour's reads
 * are used up, or Spotify or Community asks Tagify to stop. Never throws.
 */
export async function runSongReleaseReports(
  session: SendSession, sources: SongReleaseSources,
  options: { request?: typeof fetch; storage?: Storage | null; maxRounds?: number; now?: () => number } = {},
): Promise<SongReleaseRun> {
  const request = options.request ?? fetch;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? Date.now;
  const run: SongReleaseRun = { sent: 0, reads: 0 };
  const unavailable = readUnavailable(storage, now());
  const albums = new Map<string, SongReleaseAlbumV1 | null>();
  const call = async (path: string, init: RequestInit = {}) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}/api/v2/sync/song-releases${path.replace("{device}", encodeURIComponent(current.deviceId))}`, {
        ...init,
        headers: { ...syncClientHeaders(current.accessToken), ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch {
      throw new Stop("network");
    }
    if (!response.ok) throw new Stop(stopFor(response.status));
    const body = await response.json().catch(() => null) as unknown;
    // Community's song releases switch is off: leave it alone until the next run.
    if ((body as { paused?: unknown } | null)?.paused === true) throw new Stop("paused");
    return body;
  };
  // Songs this pass couldn't answer stay at the head of Community's list; skip past them.
  let offset = 0;
  try {
    for (let round = 0; round < (options.maxRounds ?? MAX_ROUNDS); round++) {
      const body = await call(`?deviceId={device}&limit=${MAX_SONG_RELEASES_NEEDED}&offset=${offset}`);
      assertSongReleasesNeeded(body);
      if (!body.items.length) break;
      // What a page found is sent even when Spotify stopped answering partway.
      const resolved = await resolveSongReleases(body.items, sources, unavailable, albums, now());
      run.reads += resolved.reads;
      for (let start = 0; start < resolved.found.length; start += MAX_SONG_RELEASE_REPORT_ITEMS) {
        const items = resolved.found.slice(start, start + MAX_SONG_RELEASE_REPORT_ITEMS);
        const current = await session();
        await call("", { method: "POST", body: JSON.stringify({ protocolVersion: SONG_RELEASES_PROTOCOL_VERSION, deviceId: current.deviceId, items }) });
        run.sent += items.length;
      }
      if (resolved.halted) { run.stopped = resolved.halted; break; }
      offset += body.items.length - resolved.found.length;
      if (!body.hasMore) break;
    }
  } catch (error) {
    run.stopped = error instanceof Stop ? error.reason : "network";
  } finally {
    saveUnavailable(storage, unavailable);
  }
  return run;
}
