import {
  ARTIST_CREDITS_PROTOCOL_VERSION, assertArtistCreditsNeeded, MAX_ARTIST_CREDIT_REPORT_ITEMS, MAX_ARTIST_CREDITS_NEEDED,
  MAX_ARTIST_CREDITS_PER_ITEM, normalizeArtistName,
  type ArtistCreditEntityV1, type ArtistCreditReportItemV1, type ArtistCreditV1,
} from "@tagify/sync-contracts";
import type { SendSession } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// Community shows each shared song's and album's artists. Its Spotify Web API quota is too small to
// look up every one (Community docs/SPOTIFY_COMPLIANCE.md), so Tagify reads them here, through
// Spotify's desktop app, and sends them (Community migration 0252). Community asks only for music in
// this member's library that nobody has sent yet, so each song is read once for everyone. Requests
// are paced in the background and stop at Spotify's first refusal.

/** Background Spotify reads this feature may make in an hour (SpotifyBackgroundPolicy keeps at most 200). */
export const ARTIST_CREDIT_HOURLY_READS = 150;
export const ARTIST_CREDIT_FEATURE = "community-artist-credits";
const MAX_ROUNDS = 20;
// Music Spotify answered for without any artist isn't read again for a week.
const UNAVAILABLE_KEY = "tagify:community-artist-credits:unavailable:v1";
const UNAVAILABLE_MS = 7 * 24 * 60 * 60_000;
const MAX_UNAVAILABLE = 5_000;

export interface SpotifyArtist { uri: string; name: string }

/** Where Tagify finds artists, cheapest first. Only the async reads send a Spotify request. */
export interface ArtistCreditSources {
  /** Artists Tagify already saw for this song (any earlier song, album or playlist read). No request. */
  knownTrackArtists(trackUri: string): SpotifyArtist[] | null;
  /** The albums of songs in this library, as Tagify saved them. No request. */
  trackAlbums(trackUris: string[]): Promise<Map<string, string>>;
  /** Every song on an album with its artists: one read covers up to 50 songs. */
  albumTrackArtists(albumUri: string): Promise<Map<string, SpotifyArtist[]> | null>;
  trackArtists(trackUri: string): Promise<SpotifyArtist[]>;
  albumArtists(albumUri: string): Promise<SpotifyArtist[]>;
  /** Takes one of the hour's background reads for this identity; false when none are left or Spotify asked Tagify to wait. */
  reserve(identity: string): boolean;
  /** Waits between reads so they never come in a burst. */
  pace?(): Promise<void>;
}

export interface ArtistCreditRun {
  sent: number;
  /** Spotify reads made. */
  reads: number;
  stopped?: "unsupported" | "paused" | "signed_out" | "network" | "spotify" | "budget";
}

class Stop extends Error {
  constructor(readonly reason: NonNullable<ArtistCreditRun["stopped"]>) { super(`Artist credits stopped: ${reason}`); }
}

const stopFor = (status: number): NonNullable<ArtistCreditRun["stopped"]> =>
  status === 404 ? "unsupported" : status === 503 ? "paused" : status === 401 || status === 403 ? "signed_out" : "network";

const uriOf = (entity: ArtistCreditEntityV1) => `spotify:${entity.kind}:${entity.providerId}`;

/** Spotify's artists as Community takes them: real artist IDs, one-line names, no repeats, at most 20. */
export function artistCredits(artists: SpotifyArtist[] | null | undefined): ArtistCreditV1[] {
  const credits: ArtistCreditV1[] = [];
  const seen = new Set<string>();
  for (const artist of artists ?? []) {
    const providerId = /^spotify:artist:([A-Za-z0-9]{22})$/.exec(artist?.uri ?? "")?.[1];
    const name = normalizeArtistName(artist?.name);
    if (!providerId || !name || seen.has(providerId)) continue;
    seen.add(providerId);
    credits.push({ providerId, name });
    if (credits.length === MAX_ARTIST_CREDITS_PER_ITEM) break;
  }
  return credits;
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
 * Reads the artists of one page Community asked for. Songs Tagify already knows cost nothing; songs
 * sharing an album are read together; everything else is one read each, while the hour allows.
 */
export async function resolveArtistCredits(
  items: ArtistCreditEntityV1[], sources: ArtistCreditSources, unavailable: Map<string, number>, now = Date.now(),
): Promise<{ found: ArtistCreditReportItemV1[]; reads: number; halted: "budget" | "spotify" | null }> {
  const found = new Map<string, ArtistCreditReportItemV1>();
  let reads = 0;
  let halted: "budget" | "spotify" | null = null;
  const take = (entity: ArtistCreditEntityV1, artists: SpotifyArtist[] | null | undefined) => {
    const credits = artistCredits(artists);
    if (credits.length) found.set(uriOf(entity), { entity, artists: credits });
    return credits.length > 0;
  };
  const read = async <T>(identity: string, request: () => Promise<T>): Promise<T | null> => {
    if (halted) return null;
    if (!sources.reserve(identity)) { halted = "budget"; return null; }
    reads += 1;
    await sources.pace?.();
    // A failure is Spotify refusing or being unreachable: stop, never retry around it.
    try { return await request(); } catch { halted = "spotify"; return null; }
  };

  const pending = items.filter((entity) => !unavailable.has(uriOf(entity)));
  const tracks = pending.filter((entity) => entity.kind === "track" && !take(entity, sources.knownTrackArtists(uriOf(entity))));
  const albums = pending.filter((entity) => entity.kind === "album");

  // Songs from the same album: one album read answers all of them.
  const albumOf = tracks.length ? await sources.trackAlbums(tracks.map(uriOf)) : new Map<string, string>();
  const byAlbum = new Map<string, ArtistCreditEntityV1[]>();
  for (const track of tracks) {
    const album = albumOf.get(uriOf(track));
    if (album?.startsWith("spotify:album:")) byAlbum.set(album, [...(byAlbum.get(album) ?? []), track]);
  }
  for (const [album, songs] of byAlbum) {
    if (songs.length < 2) continue;
    const listing = await read(album, () => sources.albumTrackArtists(album));
    if (halted) break;
    for (const song of songs) take(song, listing?.get(uriOf(song)));
  }

  const remember = (entity: ArtistCreditEntityV1) => unavailable.set(uriOf(entity), now + UNAVAILABLE_MS);
  for (const track of tracks) {
    if (halted) break;
    if (found.has(uriOf(track))) continue;
    const artists = await read(uriOf(track), () => sources.trackArtists(uriOf(track)));
    if (!halted && !take(track, artists)) remember(track);
  }
  for (const album of albums) {
    if (halted) break;
    const artists = await read(uriOf(album), () => sources.albumArtists(uriOf(album)));
    if (!halted && !take(album, artists)) remember(album);
  }
  return { found: [...found.values()], reads, halted };
}

/**
 * Sends Community the artists it asked for, page by page, until nothing is left, the hour's reads
 * are used up, or Spotify or Community asks Tagify to stop. Never throws.
 */
export async function runArtistCreditReports(
  session: SendSession, sources: ArtistCreditSources,
  options: { request?: typeof fetch; storage?: Storage | null; maxRounds?: number; now?: () => number } = {},
): Promise<ArtistCreditRun> {
  const request = options.request ?? fetch;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? Date.now;
  const run: ArtistCreditRun = { sent: 0, reads: 0 };
  const unavailable = readUnavailable(storage, now());
  const call = async (path: string, init: RequestInit = {}) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}/api/v2/sync/artist-credits${path.replace("{device}", encodeURIComponent(current.deviceId))}`, {
        ...init,
        headers: { ...syncClientHeaders(current.accessToken), ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch {
      throw new Stop("network");
    }
    if (!response.ok) throw new Stop(stopFor(response.status));
    const body = await response.json().catch(() => null) as unknown;
    // Community's artist credits switch is off: leave it alone until the next run.
    if ((body as { paused?: unknown } | null)?.paused === true) throw new Stop("paused");
    return { body, deviceId: current.deviceId };
  };
  // Music this pass couldn't answer stays at the head of Community's list; skip past it.
  let offset = 0;
  try {
    for (let round = 0; round < (options.maxRounds ?? MAX_ROUNDS); round++) {
      const { body } = await call(`?deviceId={device}&limit=${MAX_ARTIST_CREDITS_NEEDED}&offset=${offset}`);
      assertArtistCreditsNeeded(body);
      if (!body.items.length) break;
      // What a page found is sent even when Spotify stopped answering partway.
      const resolved = await resolveArtistCredits(body.items, sources, unavailable, now());
      run.reads += resolved.reads;
      for (let start = 0; start < resolved.found.length; start += MAX_ARTIST_CREDIT_REPORT_ITEMS) {
        const items = resolved.found.slice(start, start + MAX_ARTIST_CREDIT_REPORT_ITEMS);
        const current = await session();
        await call("", { method: "POST", body: JSON.stringify({ protocolVersion: ARTIST_CREDITS_PROTOCOL_VERSION, deviceId: current.deviceId, items }) });
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
