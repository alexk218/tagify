import { requestSpicetifyGraphQL } from "./spicetifyGraphQL";
import type { RequestOptions } from "@/utils/RateLimiter";

// Spotify's in-app song search (the desktop GraphQL `searchTracks` operation), used by the catalog
// filler's Now playing lookups (sync/CommunityNowPlayingLookups.ts) and Spotify search lookups
// (sync/CommunitySpotifySearchLookups.ts). Never the Web API.
//
// Spotify registers its search definitions only when its Search page first runs in a session
// (docs/SPOTIFY_ENDPOINT_POLICY.md, RYM import notes). Opening Search in the background would take
// the person away from what they are looking at, so when the definition isn't registered yet,
// Tagify reads Spotify's own registration for it from the search page's script bundled in the app
// (xpui-routes-search.js, served from the app itself, no request to Spotify's servers) and builds
// the same definition Spotify would. No operation name or hash is made up: without either, there
// is no search.

export interface SpotifyTrackSearchResult {
  /** The 22-character Spotify track id. */
  id: string;
  name: string;
  artists: string[];
  album: string | null;
  playable: boolean;
}

type Definition = Record<string, unknown>;
const SEARCH_SCRIPT = "/xpui-routes-search.js";
const REGISTRATION = /Definitions\["searchTracks"\]\s*=\s*new [\w$.]+\(\s*"searchTracks"\s*,\s*"query"\s*,\s*"([0-9a-f]{64})"/;
/** After a failed read of the bundled script, it is read again no sooner than this. */
const SCRIPT_RETRY_MS = 10 * 60_000;
export const SPOTIFY_TRACK_SEARCH_LIMIT = 20;

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** The search operation's hash as Spotify registers it in its search page's script, or null. */
export function searchTracksHashFromScript(script: string): string | null {
  return REGISTRATION.exec(script)?.[1] ?? null;
}

let bundled: { hash: string | null; readAt: number } | null = null;

/** Only for tests: forget what was read from the bundled script. */
export function resetSpotifyTrackSearchForTests(): void { bundled = null; }

/**
 * The `searchTracks` definition: Spotify's own when its Search page has run this session,
 * otherwise one built from the registration in its bundled search script. Null when neither exists.
 */
export async function searchTracksDefinition(
  options: { definitions?: Record<string, unknown>; readScript?: () => Promise<string>; now?: () => number } = {},
): Promise<Definition | null> {
  const definitions = options.definitions ?? (Spicetify.GraphQL?.Definitions as Record<string, unknown> | undefined) ?? {};
  const registered = object(definitions.searchTracks);
  if (registered) return registered;
  const now = (options.now ?? Date.now)();
  if (!bundled || (!bundled.hash && now - bundled.readAt >= SCRIPT_RETRY_MS)) {
    let hash: string | null = null;
    try {
      const read = options.readScript ?? (async () => {
        const response = await fetch(SEARCH_SCRIPT, { cache: "force-cache" });
        return response.ok ? response.text() : "";
      });
      hash = searchTracksHashFromScript(await read());
    } catch { /* No search until the script can be read or Search has been opened. */ }
    bundled = { hash, readAt: now };
  }
  if (!bundled.hash) return null;
  // The same class Spotify builds every definition with, taken from one registered at startup.
  const sibling = object(definitions.getTrack) ?? object(definitions.getAlbum);
  const Construct = sibling ? (Object.getPrototypeOf(sibling) as { constructor?: unknown } | null)?.constructor : null;
  if (typeof Construct === "function" && Construct !== Object) {
    return new (Construct as new (...args: unknown[]) => Definition)("searchTracks", "query", bundled.hash, null);
  }
  return { name: "searchTracks", operation: "query", sha256Hash: bundled.hash, value: null };
}

/**
 * Songs from a `searchTracks` answer, in Spotify's order. Null when the answer isn't one (an error,
 * or a shape this Tagify doesn't know); results that aren't songs with a name and artists are left out.
 * Shape checked live on 2026-10-28: `data.searchV2.tracksV2.items[].item` is a `TrackResponseWrapper`
 * whose `data` (`Track`) carries `uri`, `name`, `artists.items[].profile.name`, `albumOfTrack.name`
 * and `playability.playable`.
 */
export function parseSpotifyTrackSearch(value: unknown): SpotifyTrackSearchResult[] | null {
  const response = object(value);
  if (!response || (Array.isArray(response.errors) && response.errors.length)) return null;
  const tracks = object(object(object(response.data)?.searchV2)?.tracksV2);
  if (!tracks || !Array.isArray(tracks.items)) return null;
  return tracks.items.flatMap((entry): SpotifyTrackSearchResult[] => {
    const wrapper = object(object(entry)?.item);
    const track = object(wrapper?.data);
    const id = typeof track?.uri === "string" ? /^spotify:track:([A-Za-z0-9]{22})$/.exec(track.uri)?.[1] : undefined;
    if (wrapper?.__typename !== "TrackResponseWrapper" || track?.__typename !== "Track" || !id
      || typeof track.name !== "string" || !track.name.trim()) return [];
    const items = object(track.artists)?.items;
    const artists = (Array.isArray(items) ? items : []).map((artist) => object(object(artist)?.profile)?.name)
      .filter((name): name is string => typeof name === "string" && !!name.trim());
    if (!artists.length) return [];
    const album = object(track.albumOfTrack)?.name;
    return [{ id, name: track.name, artists, album: typeof album === "string" && album.trim() ? album : null,
      playable: object(track.playability)?.playable !== false }];
  });
}

/** A song as a member's Search Spotify on Community lists it (`@tagify/sync-contracts` `SpotifySearchLookupItemV1`). */
export interface SpotifySearchTrackItem {
  providerId: string;
  name: string;
  imageUrl: string | null;
  artists: Array<{ providerId: string; name: string }>;
}

const MAX_ITEM_NAME_LENGTH = 240;
const MAX_ITEM_ARTISTS = 20;
const MAX_IMAGE_URL_LENGTH = 500;
const TRACK_URI = /^spotify:track:([A-Za-z0-9]{22})$/;
const ARTIST_URI = /^spotify:artist:([A-Za-z0-9]{22})$/;
const idOf = (uri: unknown, pattern: RegExp) => typeof uri === "string" ? pattern.exec(uri)?.[1] ?? null : null;

/** The largest https cover from a `coverArt.sources` list (the Web API lists its largest first), or null. */
function largestCover(coverArt: unknown): string | null {
  const sources = object(coverArt)?.sources;
  let best: { url: string; width: number } | null = null;
  for (const source of Array.isArray(sources) ? sources : []) {
    const url = object(source)?.url;
    const width = Number(object(source)?.width) || 0;
    if (typeof url !== "string" || !url.startsWith("https://") || url.length > MAX_IMAGE_URL_LENGTH) continue;
    if (!best || width > best.width) best = { url, width };
  }
  return best?.url ?? null;
}

/**
 * Songs from a `searchTracks` answer as Community stores a Web API search page: id, name, the
 * album's largest cover and the artists with their ids, in Spotify's order. Artists without an id
 * are left out (as Community's Web API mapping does); a song with none left is left out. Null when
 * the answer isn't one. Shape checked live on 2026-10-28: `artists.items[]` is
 * `{ profile: { name }, uri }` and `albumOfTrack.coverArt.sources[]` is `{ url, width, height }`
 * (300, 64 and 640 wide).
 */
export function parseSpotifyTrackSearchItems(value: unknown): SpotifySearchTrackItem[] | null {
  const response = object(value);
  if (!response || (Array.isArray(response.errors) && response.errors.length)) return null;
  const tracks = object(object(object(response.data)?.searchV2)?.tracksV2);
  if (!tracks || !Array.isArray(tracks.items)) return null;
  return tracks.items.flatMap((entry): SpotifySearchTrackItem[] => {
    const wrapper = object(object(entry)?.item);
    const track = object(wrapper?.data);
    const providerId = idOf(track?.uri, TRACK_URI);
    if (wrapper?.__typename !== "TrackResponseWrapper" || track?.__typename !== "Track" || !providerId
      || typeof track.name !== "string" || !track.name.trim()) return [];
    const items = object(track.artists)?.items;
    const artists = (Array.isArray(items) ? items : []).flatMap((raw) => {
      const artist = object(raw);
      const id = idOf(artist?.uri, ARTIST_URI);
      const name = object(artist?.profile)?.name;
      return id && typeof name === "string" && name.trim() ? [{ providerId: id, name: name.slice(0, MAX_ITEM_NAME_LENGTH) }] : [];
    }).slice(0, MAX_ITEM_ARTISTS);
    if (!artists.length) return [];
    return [{ providerId, name: track.name.slice(0, MAX_ITEM_NAME_LENGTH), imageUrl: largestCover(object(track.albumOfTrack)?.coverArt), artists }];
  });
}

/** One `searchTracks` request through the shared wrapper; null when this Spotify has no song search. */
async function requestSearchTracks(term: string, limit: number, options?: RequestOptions): Promise<unknown> {
  const definition = await searchTracksDefinition();
  if (!definition) return null;
  // The variables Spotify's own Search page sends for its Songs list.
  return requestSpicetifyGraphQL(definition, {
    searchTerm: term, offset: 0, limit, numberOfTopResults: 20, includeAudiobooks: true,
    includePreReleases: false, includeAlbumPreReleases: false, includeAuthors: false, includeEpisodeContentRatingsV2: false,
  }, undefined, { ...options, feature: options?.feature ?? "other" });
}

const UNRECOGNIZED = "Spotify's song search answered in a way Tagify doesn't recognize";

/**
 * Searches Spotify's songs through the shared GraphQL wrapper (its limiter, cooldowns and account
 * guards). Null when this Spotify has no song search. A 429 or local pause throws, as every
 * shared-wrapper read does.
 */
export async function searchSpotifyTracks(searchTerm: string, options?: RequestOptions): Promise<SpotifyTrackSearchResult[] | null> {
  const term = searchTerm.trim();
  if (!term || term.length > 500) return [];
  const response = await requestSearchTracks(term, SPOTIFY_TRACK_SEARCH_LIMIT, options);
  if (response === null) return null;
  const results = parseSpotifyTrackSearch(response);
  if (!results) throw new Error(UNRECOGNIZED);
  return results;
}

/** One page of a member's search, as many as Community asks Spotify's Web API for. */
export const SPOTIFY_SEARCH_PAGE_SIZE = 10;

/**
 * One page (10) of Spotify's song search, as a member's Search Spotify on Community lists it. Null
 * when this Spotify has no song search; a 429, a local pause or an answer Tagify doesn't recognize
 * throws.
 */
export async function searchSpotifyTrackItems(searchTerm: string, options?: RequestOptions): Promise<SpotifySearchTrackItem[] | null> {
  const term = searchTerm.trim();
  if (!term || term.length > 500) return [];
  const response = await requestSearchTracks(term, SPOTIFY_SEARCH_PAGE_SIZE, options);
  if (response === null) return null;
  const items = parseSpotifyTrackSearchItems(response);
  if (!items) throw new Error(UNRECOGNIZED);
  return items.slice(0, SPOTIFY_SEARCH_PAGE_SIZE);
}
