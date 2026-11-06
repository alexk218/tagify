// Song details Tagify desktop already keeps for each song (TrackData durationMs and releaseDate,
// filled from Spotify's desktop app since 3.3.5) and sends Community, so My library and Smart
// playlists can filter by Length and Released there too (pending Community migration 9001).
// A side document next to sync: GET /api/v2/sync/song-details lists this member's songs whose
// details Community hasn't had from their desktop, POST sends the ones the desktop knows. Sending
// costs no Spotify read. Details stay with the member's own library: they never change another
// member's filters.
export const SONG_DETAILS_PROTOCOL_VERSION = 1 as const;
export const MAX_SONG_DETAILS_REPORT_ITEMS = 200;
export const MAX_SONG_DETAILS_NEEDED = 500;

export interface SongDetailsEntityV1 { provider: "spotify"; kind: "track"; providerId: string }
export interface SongDetailsReportItemV1 {
  entity: SongDetailsEntityV1;
  /** The song's length in milliseconds (1 to 86,400,000), or null when the desktop doesn't know it yet. */
  durationMs: number | null;
  /** The album's release date at the precision Spotify knows it ("2024", "2024-06" or "2024-06-01"), or null. */
  releaseDate: string | null;
}
export interface SongDetailsReportV1 { protocolVersion: typeof SONG_DETAILS_PROTOCOL_VERSION; deviceId: string; items: SongDetailsReportItemV1[] }
export interface SongDetailsNeededV1 { items: SongDetailsEntityV1[]; hasMore: boolean; paused?: boolean }
export interface SongDetailsReportResultV1 { accepted: number; ignored: number; paused?: boolean }

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELEASE_DATE = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function isSongDetailsEntity(value: unknown): value is SongDetailsEntityV1 {
  return record(value) && value.provider === "spotify" && value.kind === "track" && typeof value.providerId === "string" && SPOTIFY_ID.test(value.providerId);
}

/** Checks a report; each item names a song once and carries a length, a release date or both. */
export function assertSongDetailsReport(value: unknown): asserts value is SongDetailsReportV1 {
  if (!record(value) || value.protocolVersion !== SONG_DETAILS_PROTOCOL_VERSION || typeof value.deviceId !== "string" || !UUID.test(value.deviceId)
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_SONG_DETAILS_REPORT_ITEMS) throw new Error("Invalid song details");
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || !isSongDetailsEntity(item.entity) || seen.has(item.entity.providerId)) throw new Error("Invalid song details");
    seen.add(item.entity.providerId);
    const { durationMs, releaseDate } = item;
    if (!(durationMs === null || (typeof durationMs === "number" && Number.isInteger(durationMs) && durationMs >= 1 && durationMs <= 86_400_000))
      || !(releaseDate === null || (typeof releaseDate === "string" && RELEASE_DATE.test(releaseDate)))
      || (durationMs === null && releaseDate === null)) throw new Error("Invalid song details");
  }
}

export function assertSongDetailsNeeded(value: unknown): asserts value is SongDetailsNeededV1 {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > MAX_SONG_DETAILS_NEEDED || typeof value.hasMore !== "boolean"
    || !value.items.every(isSongDetailsEntity)) throw new Error("Invalid song details request");
}
