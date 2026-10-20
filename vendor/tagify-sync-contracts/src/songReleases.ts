// Song releases Tagify desktop reads from Spotify's desktop app and sends Community: each song's
// ISRC and the release (album, single or compilation) Spotify files it under. Community names the
// album on song pages and gives every Spotify version of the same recording (an exact ISRC match)
// one page, without spending its development-mode Web API quota (migration 0261).
// A side document next to sync: GET /api/v2/sync/song-releases lists what Community still needs
// from this member's library, POST sends what the desktop found.
export const SONG_RELEASES_PROTOCOL_VERSION = 1 as const;
export const MAX_SONG_RELEASE_REPORT_ITEMS = 200;
export const MAX_SONG_RELEASES_NEEDED = 500;
export const MAX_RELEASE_NAME_LENGTH = 240;

/** Spotify's own release kinds; an EP is a single, as Spotify's Web API files it. */
export type SongReleaseKind = "album" | "single" | "compilation";
export interface SongReleaseEntityV1 { provider: "spotify"; kind: "track"; providerId: string }
export interface SongReleaseAlbumV1 {
  providerId: string;
  name: string;
  albumType: SongReleaseKind;
  /** "2024", "2024-06" or "2024-06-01". */
  releaseDate: string | null;
  /** Spotify's cover image (i.scdn.co or *.spotifycdn.com). */
  imageUrl: string | null;
}
export interface SongReleaseReportItemV1 {
  entity: SongReleaseEntityV1;
  /** The recording's ISRC, upper case without separators; null when Spotify lists none. */
  isrc: string | null;
  album: SongReleaseAlbumV1;
}
export interface SongReleaseReportV1 { protocolVersion: typeof SONG_RELEASES_PROTOCOL_VERSION; deviceId: string; items: SongReleaseReportItemV1[] }
export interface SongReleasesNeededV1 { items: SongReleaseEntityV1[]; hasMore: boolean }
export interface SongReleaseReportResultV1 { accepted: number; ignored: number }

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;
const RELEASE_DATE = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function isSongReleaseEntity(value: unknown): value is SongReleaseEntityV1 {
  return record(value) && value.provider === "spotify" && value.kind === "track" && typeof value.providerId === "string" && SPOTIFY_ID.test(value.providerId);
}

/** An ISRC as Community keeps it ("usabc-24-00001" → "USABC2400001"), or null when it isn't one. */
export function normalizeIsrc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const isrc = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return ISRC.test(isrc) ? isrc : null;
}

/** Spotify's album_type as Community keeps it; an EP counts as a single. Null for anything else. */
export function normalizeReleaseKind(value: unknown): SongReleaseKind | null {
  if (typeof value !== "string") return null;
  const kind = value.trim().toLowerCase();
  return kind === "album" || kind === "single" || kind === "compilation" ? kind : kind === "ep" ? "single" : null;
}

/** A release name as Community shows it: trimmed, one line, at most 240 characters. Null when unusable. */
export function normalizeReleaseName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_RELEASE_NAME_LENGTH ? name : null;
}

export function isSpotifyImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "i.scdn.co" || url.hostname.endsWith(".spotifycdn.com"));
  } catch {
    return false;
  }
}

function assertAlbum(value: unknown): asserts value is SongReleaseAlbumV1 {
  if (!record(value) || typeof value.providerId !== "string" || !SPOTIFY_ID.test(value.providerId)
    || normalizeReleaseName(value.name) !== value.name || normalizeReleaseKind(value.albumType) !== value.albumType
    || !(value.releaseDate === null || (typeof value.releaseDate === "string" && RELEASE_DATE.test(value.releaseDate)))
    || !(value.imageUrl === null || isSpotifyImageUrl(value.imageUrl))) throw new Error("Invalid song releases");
}

export function assertSongReleaseReport(value: unknown): asserts value is SongReleaseReportV1 {
  if (!record(value) || value.protocolVersion !== SONG_RELEASES_PROTOCOL_VERSION || typeof value.deviceId !== "string" || !UUID.test(value.deviceId)
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_SONG_RELEASE_REPORT_ITEMS) throw new Error("Invalid song releases");
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || !isSongReleaseEntity(item.entity) || seen.has(item.entity.providerId)) throw new Error("Invalid song releases");
    seen.add(item.entity.providerId);
    if (!(item.isrc === null || (typeof item.isrc === "string" && ISRC.test(item.isrc)))) throw new Error("Invalid song releases");
    assertAlbum(item.album);
  }
}

export function assertSongReleasesNeeded(value: unknown): asserts value is SongReleasesNeededV1 {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > MAX_SONG_RELEASES_NEEDED || typeof value.hasMore !== "boolean"
    || !value.items.every(isSongReleaseEntity)) throw new Error("Invalid song release request");
}
