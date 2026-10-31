// Now playing lookups: when Community's Now playing card can't find the song a member is playing,
// it asks a catalog filler desktop (Community's allowlist, Alex's; migration 0347
// `catalog_fill_desktops`) to search Spotify's desktop app for it. GET
// /api/v2/sync/now-playing-lookups?deviceId=… hands that desktop the open requests (names only,
// never who is playing them) and says whether it is a filler; POST sends what the search found:
// the same song's Spotify track id, or null when Spotify has no song with the same title, version
// and artist. Every other desktop is told it isn't a filler and handed nothing.
export const NOW_PLAYING_LOOKUPS_PROTOCOL_VERSION = 1 as const;
export const MAX_NOW_PLAYING_LOOKUPS = 10;
export const MAX_NOW_PLAYING_LOOKUP_ANSWERS = 10;
export const MAX_NOW_PLAYING_LOOKUP_ARTISTS = 20;
export const MAX_NOW_PLAYING_LOOKUP_NAME_LENGTH = 240;
const MAX_REQUEST_ID_LENGTH = 100;

export interface NowPlayingLookupV1 {
  /** Community's id for this request; answers name it. */
  requestId: string;
  /** The song's title as it was read; it may already carry its version ("Baby - Tony Romera Remix"). */
  title: string;
  /** What makes it another recording ("Tony Romera Remix"), or null for the original. */
  version: string | null;
  /** At least one. */
  artists: string[];
  album: string | null;
}
export interface NowPlayingLookupsV1 { filler: boolean; lookups: NowPlayingLookupV1[] }
/** `spotifyTrackId` null: Spotify was searched and has no song with the same title, version and artist. */
export interface NowPlayingLookupAnswerV1 { requestId: string; spotifyTrackId: string | null }
export interface NowPlayingLookupAnswersV1 {
  protocolVersion: typeof NOW_PLAYING_LOOKUPS_PROTOCOL_VERSION;
  deviceId: string;
  answers: NowPlayingLookupAnswerV1[];
}
export interface NowPlayingLookupAnswersResultV1 { accepted: number }

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_:.-]+$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A name as lookups carry it: one line, trimmed, at most 240 characters. Null when unusable. */
export function normalizeNowPlayingLookupName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_NOW_PLAYING_LOOKUP_NAME_LENGTH ? name : null;
}

export function isNowPlayingLookupRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID.test(value);
}

function lookupOf(value: unknown): NowPlayingLookupV1 | null {
  if (!record(value) || !isNowPlayingLookupRequestId(value.requestId) || !Array.isArray(value.artists)) return null;
  const title = normalizeNowPlayingLookupName(value.title);
  const version = value.version === null || value.version === undefined ? null : normalizeNowPlayingLookupName(value.version);
  const album = value.album === null || value.album === undefined ? null : normalizeNowPlayingLookupName(value.album);
  const artists = [...new Set(value.artists.map(normalizeNowPlayingLookupName).filter((name): name is string => !!name))]
    .slice(0, MAX_NOW_PLAYING_LOOKUP_ARTISTS);
  if (!title || !artists.length || (value.version != null && !version)) return null;
  return { requestId: value.requestId, title, version, artists, album };
}

/**
 * Community's lookups answer. A lookup this desktop can't read (no title or artist) is dropped,
 * never guessed at; a desktop that isn't a filler is handed nothing.
 */
export function parseNowPlayingLookups(value: unknown): NowPlayingLookupsV1 {
  if (!record(value) || !Array.isArray(value.lookups) || value.lookups.length > MAX_NOW_PLAYING_LOOKUPS
    || (value.filler !== undefined && typeof value.filler !== "boolean")) throw new Error("Invalid now playing lookups");
  const lookups = value.lookups.map(lookupOf).filter((lookup): lookup is NowPlayingLookupV1 => !!lookup)
    .filter((lookup, index, all) => all.findIndex((other) => other.requestId === lookup.requestId) === index);
  // An answer from before `filler` was sent counts as a filler's only when it hands out lookups.
  const filler = value.filler === undefined ? value.lookups.length > 0 : value.filler;
  return { filler, lookups: filler ? lookups : [] };
}

export function assertNowPlayingLookupAnswers(value: unknown): asserts value is NowPlayingLookupAnswersV1 {
  if (!record(value) || value.protocolVersion !== NOW_PLAYING_LOOKUPS_PROTOCOL_VERSION || typeof value.deviceId !== "string"
    || !UUID.test(value.deviceId) || !Array.isArray(value.answers) || value.answers.length < 1
    || value.answers.length > MAX_NOW_PLAYING_LOOKUP_ANSWERS) throw new Error("Invalid now playing lookup answers");
  const seen = new Set<string>();
  for (const answer of value.answers) {
    if (!record(answer) || !isNowPlayingLookupRequestId(answer.requestId) || seen.has(answer.requestId)
      || (answer.spotifyTrackId !== null && (typeof answer.spotifyTrackId !== "string" || !SPOTIFY_ID.test(answer.spotifyTrackId)))) {
      throw new Error("Invalid now playing lookup answers");
    }
    seen.add(answer.requestId);
  }
}
