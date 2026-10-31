// Spotify search lookups: when a member's Search Spotify can't reach Spotify's Web API (the shared
// quota is paused or today's searches are used up), Community asks a catalog filler desktop (the
// `catalog_fill_desktops` allowlist, Alex's) to run the same search in Spotify's desktop app. GET
// /api/v2/sync/spotify-search-lookups?deviceId=… hands that desktop the open searches (the text and
// kind only, never who searched) and says whether it is a filler; POST sends one page of what the
// search found, in the shape Community stores Web API answers in (`SpotifySearchItem`, 0257), or an
// empty list when Spotify found nothing. Every other desktop is told it isn't a filler and handed nothing.
export const SPOTIFY_SEARCH_LOOKUPS_PROTOCOL_VERSION = 1 as const;
export const MAX_SPOTIFY_SEARCH_LOOKUPS = 10;
export const MAX_SPOTIFY_SEARCH_LOOKUP_ANSWERS = 10;
/** One page, as many as Community asks the Web API for. */
export const MAX_SPOTIFY_SEARCH_LOOKUP_ITEMS = 10;
export const MAX_SPOTIFY_SEARCH_LOOKUP_ITEM_ARTISTS = 20;
export const MAX_SPOTIFY_SEARCH_LOOKUP_QUERY_LENGTH = 160;
export const MAX_SPOTIFY_SEARCH_LOOKUP_NAME_LENGTH = 240;
const MAX_REQUEST_ID_LENGTH = 100;
const MAX_IMAGE_URL_LENGTH = 500;

export type SpotifySearchLookupKind = "track" | "album" | "artist";
export const SPOTIFY_SEARCH_LOOKUP_KINDS: readonly SpotifySearchLookupKind[] = ["track", "album", "artist"];

export interface SpotifySearchLookupV1 {
  /** Community's id for this request; answers name it. */
  requestId: string;
  /** What the member typed, one line, at most 160 characters. */
  query: string;
  kind: SpotifySearchLookupKind;
}
export interface SpotifySearchLookupsV1 { filler: boolean; searches: SpotifySearchLookupV1[] }

/** A song, album or artist as the search listed it; `artists` is empty for an artist. */
export interface SpotifySearchLookupItemV1 {
  providerId: string;
  name: string;
  imageUrl: string | null;
  artists: Array<{ providerId: string; name: string }>;
}
/** `items` empty: Spotify was searched and found nothing. */
export interface SpotifySearchLookupAnswerV1 { requestId: string; items: SpotifySearchLookupItemV1[] }
export interface SpotifySearchLookupAnswersV1 {
  protocolVersion: typeof SPOTIFY_SEARCH_LOOKUPS_PROTOCOL_VERSION;
  deviceId: string;
  answers: SpotifySearchLookupAnswerV1[];
}
export interface SpotifySearchLookupAnswersResultV1 { accepted: number }

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_:.-]+$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const oneLine = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

export function isSpotifySearchLookupRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID.test(value);
}

function searchOf(value: unknown): SpotifySearchLookupV1 | null {
  if (!record(value) || !isSpotifySearchLookupRequestId(value.requestId) || typeof value.query !== "string") return null;
  const query = oneLine(value.query);
  const kind = SPOTIFY_SEARCH_LOOKUP_KINDS.find((candidate) => candidate === value.kind);
  if (!query || query.length > MAX_SPOTIFY_SEARCH_LOOKUP_QUERY_LENGTH || !kind) return null;
  return { requestId: value.requestId, query, kind };
}

/**
 * Community's searches answer. A search this desktop can't read (no text, an unknown kind) is
 * dropped, never guessed at; a desktop that isn't a filler is handed nothing.
 */
export function parseSpotifySearchLookups(value: unknown): SpotifySearchLookupsV1 {
  if (!record(value) || typeof value.filler !== "boolean" || !Array.isArray(value.searches)
    || value.searches.length > MAX_SPOTIFY_SEARCH_LOOKUPS) throw new Error("Invalid Spotify search lookups");
  const searches = value.searches.map(searchOf).filter((search): search is SpotifySearchLookupV1 => !!search)
    .filter((search, index, all) => all.findIndex((other) => other.requestId === search.requestId) === index);
  return { filler: value.filler, searches: value.filler ? searches : [] };
}

const isName = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= MAX_SPOTIFY_SEARCH_LOOKUP_NAME_LENGTH;

function isItem(value: unknown): boolean {
  return record(value) && typeof value.providerId === "string" && SPOTIFY_ID.test(value.providerId) && isName(value.name)
    && (value.imageUrl === null || (typeof value.imageUrl === "string" && value.imageUrl.startsWith("https://")
      && value.imageUrl.length <= MAX_IMAGE_URL_LENGTH))
    && Array.isArray(value.artists) && value.artists.length <= MAX_SPOTIFY_SEARCH_LOOKUP_ITEM_ARTISTS
    && value.artists.every((artist) => record(artist) && typeof artist.providerId === "string"
      && SPOTIFY_ID.test(artist.providerId) && isName(artist.name));
}

export function assertSpotifySearchLookupAnswers(value: unknown): asserts value is SpotifySearchLookupAnswersV1 {
  if (!record(value) || value.protocolVersion !== SPOTIFY_SEARCH_LOOKUPS_PROTOCOL_VERSION || typeof value.deviceId !== "string"
    || !UUID.test(value.deviceId) || !Array.isArray(value.answers) || value.answers.length < 1
    || value.answers.length > MAX_SPOTIFY_SEARCH_LOOKUP_ANSWERS) throw new Error("Invalid Spotify search lookup answers");
  const seen = new Set<string>();
  for (const answer of value.answers) {
    if (!record(answer) || !isSpotifySearchLookupRequestId(answer.requestId) || seen.has(answer.requestId)
      || !Array.isArray(answer.items) || answer.items.length > MAX_SPOTIFY_SEARCH_LOOKUP_ITEMS || !answer.items.every(isItem)) {
      throw new Error("Invalid Spotify search lookup answers");
    }
    seen.add(answer.requestId);
  }
}
