// Names and artwork Tagify desktop already keeps for the songs, albums and artists it syncs, sent
// to Community so its pages show them without asking Spotify (Community migration desktop_song_names). A side
// document next to sync: GET /api/v2/sync/song-names lists the music in this member's library that
// Community has no name for, POST sends what Tagify has saved for it. Tagify sends only what it
// already has; it never asks Spotify for this.
export const SONG_NAMES_PROTOCOL_VERSION = 1 as const;
export const MAX_SONG_NAME_REPORT_ITEMS = 200;
export const MAX_SONG_NAMES_NEEDED = 500;
export const MAX_SONG_TITLE_LENGTH = 240;
const MAX_ARTWORK_URL_LENGTH = 500;

export type SongNameEntityKind = "track" | "album" | "artist";
export interface SongNameEntityV1 { provider: "spotify"; kind: SongNameEntityKind; providerId: string }
export interface SongNameReportItemV1 { entity: SongNameEntityV1; title: string; thumbnailUrl: string | null }
export interface SongNameReportV1 { protocolVersion: typeof SONG_NAMES_PROTOCOL_VERSION; deviceId: string; items: SongNameReportItemV1[] }
export interface SongNamesNeededV1 { items: SongNameEntityV1[]; hasMore: boolean }
export interface SongNameReportResultV1 { accepted: number; ignored: number }

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTWORK = /^https:\/\/(i\.scdn\.co|[a-z0-9-]+\.spotifycdn\.com)\/[^\s"'<>]+$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function isSongNameEntity(value: unknown): value is SongNameEntityV1 {
  return record(value) && value.provider === "spotify" && (value.kind === "track" || value.kind === "album" || value.kind === "artist")
    && typeof value.providerId === "string" && SPOTIFY_ID.test(value.providerId);
}

/**
 * A title as Community shows it: one line, no angle brackets, at most 240 characters. Null when
 * unusable, including Community's own stand-ins such as "Spotify track · <id>".
 */
export function normalizeSongTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").replaceAll("<", "‹").replaceAll(">", "›").trim();
  if (!title || title.length > MAX_SONG_TITLE_LENGTH) return null;
  return /^Spotify (track|album|artist)(?:(?: ·)? [A-Za-z0-9]{10,64})?$/.test(title) ? null : title;
}

/** Artwork only from Spotify's image servers. */
export function normalizeArtworkUrl(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_ARTWORK_URL_LENGTH && ARTWORK.test(value) ? value : null;
}

export function assertSongNameReport(value: unknown): asserts value is SongNameReportV1 {
  if (!record(value) || value.protocolVersion !== SONG_NAMES_PROTOCOL_VERSION || typeof value.deviceId !== "string" || !UUID.test(value.deviceId)
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_SONG_NAME_REPORT_ITEMS) throw new Error("Invalid song names");
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || !isSongNameEntity(item.entity) || normalizeSongTitle(item.title) !== item.title
      || (item.thumbnailUrl !== null && normalizeArtworkUrl(item.thumbnailUrl) !== item.thumbnailUrl)) throw new Error("Invalid song names");
    const key = `${item.entity.kind}:${item.entity.providerId}`;
    if (seen.has(key)) throw new Error("Invalid song names");
    seen.add(key);
  }
}

export function assertSongNamesNeeded(value: unknown): asserts value is SongNamesNeededV1 {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > MAX_SONG_NAMES_NEEDED || typeof value.hasMore !== "boolean"
    || !value.items.every(isSongNameEntity)) throw new Error("Invalid song name request");
}
