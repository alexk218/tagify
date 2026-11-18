// Each song's original release date, as Community works it out, for Tagify desktop's Released
// filter and Smart playlists. The date Tagify keeps for a song (TrackData releaseDate) is its
// album's, so a 2011 remaster of a 1977 song reads as 2011. Community already knows the earliest
// release of each recording (song_facts, migration 0504: every Spotify and Apple Music version with
// the same ISRC, MusicBrainz's first release and the album dates desktops reported), and its own
// Released filters use it. This lets a linked desktop filter the same way.
// A side document next to sync: GET /api/v2/sync/original-release-dates?offset=N lists, a page at a
// time, the songs in this member's library whose original release date Community knows. It is
// read-only, costs no Spotify read and names no other member.
export const ORIGINAL_RELEASE_DATES_PROTOCOL_VERSION = 1 as const;
export const MAX_ORIGINAL_RELEASE_DATES_PAGE = 500;
/** Community answers offsets up to 100,000, the size of the largest library sync accepts. */
export const MAX_ORIGINAL_RELEASE_DATES_OFFSET = 100_000;

export interface OriginalReleaseDateItemV1 {
  entity: { provider: "spotify"; kind: "track"; providerId: string };
  /** The earliest release Community knows for the recording: "1977", "1977-06" or "1977-06-01". */
  releaseDate: string;
}
export interface OriginalReleaseDatesPageV1 {
  protocolVersion: typeof ORIGINAL_RELEASE_DATES_PROTOCOL_VERSION;
  items: OriginalReleaseDateItemV1[];
  /** The offset of the next page, or null when this was the last one. */
  nextOffset: number | null;
  /** The feature is switched off on Community: keep what was saved and ask again later. */
  paused?: boolean;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const RELEASE_DATE = /^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** "1977", "1977-06" or "1977-06-01" with a year from 1000 to 9999. */
export function isOriginalReleaseDate(value: unknown): value is string {
  return typeof value === "string" && RELEASE_DATE.test(value) && Number(value.slice(0, 4)) >= 1000;
}

/** Checks a page; each song appears once and offsets only move forward. */
export function assertOriginalReleaseDatesPage(value: unknown, offset = 0): asserts value is OriginalReleaseDatesPageV1 {
  if (!record(value) || value.protocolVersion !== ORIGINAL_RELEASE_DATES_PROTOCOL_VERSION || !Array.isArray(value.items)
    || value.items.length > MAX_ORIGINAL_RELEASE_DATES_PAGE
    || !(value.nextOffset === null || (typeof value.nextOffset === "number" && Number.isSafeInteger(value.nextOffset)
      && value.nextOffset > offset && value.nextOffset <= MAX_ORIGINAL_RELEASE_DATES_OFFSET))
    || !(value.paused === undefined || typeof value.paused === "boolean")) throw new Error("Invalid original release dates");
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || !record(item.entity) || item.entity.provider !== "spotify" || item.entity.kind !== "track"
      || typeof item.entity.providerId !== "string" || !SPOTIFY_ID.test(item.entity.providerId) || seen.has(item.entity.providerId)
      || !isOriginalReleaseDate(item.releaseDate)) throw new Error("Invalid original release dates");
    seen.add(item.entity.providerId);
  }
}
