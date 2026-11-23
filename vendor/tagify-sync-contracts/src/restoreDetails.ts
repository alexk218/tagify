// Names, artists, albums and artwork Community keeps for the music in a member's synced library,
// read by Tagify desktop while it restores that library from Community. The sync snapshot carries
// only tags, ratings, energy, BPM and key, so a restored library otherwise shows "Unknown Track"
// until Tagify has asked Spotify for every song again (about 50 songs each time Spotify starts).
// GET /api/v2/sync/restore-details?deviceId&after&limit pages through this member's library.
// Nothing here is a sync field: Tagify saves these as display details only and never sends them back
// as edits, and they never change a song's Last Updated date.
import { normalizeArtworkUrl, normalizeSongTitle } from "./songNames";

export const RESTORE_DETAILS_PROTOCOL_VERSION = 1 as const;
export const MAX_RESTORE_DETAILS_PAGE = 500;
const MAX_ARTISTS_LENGTH = 1_000;

export type RestoreDetailKind = "track" | "album" | "artist" | "playlist";
export interface RestoreDetailEntityV1 { provider: "spotify"; kind: RestoreDetailKind; providerId: string }

export interface RestoreDetailV1 {
  entity: RestoreDetailEntityV1;
  /** The name as Community shows it; null when Community has none yet. */
  title: string | null;
  /** A song's or album's artists, in credit order, joined with ", " as Tagify shows them. */
  artists: string | null;
  /** A song's album. */
  album: { providerId: string; name: string; imageUrl: string | null; releaseDate: string | null } | null;
  /** Artwork from Spotify's image servers. */
  imageUrl: string | null;
}

export interface RestoreDetailsPageV1 {
  items: RestoreDetailV1[];
  /** Pass as `after` for the next page; null on the last page. */
  nextCursor: string | null;
  /** Community's switch for this read is off: restore without details. */
  paused?: true;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{10,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELEASE_DATE = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;
const KINDS = new Set<RestoreDetailKind>(["track", "album", "artist", "playlist"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function entityOf(value: unknown): RestoreDetailEntityV1 | null {
  if (!record(value) || value.provider !== "spotify" || !KINDS.has(value.kind as RestoreDetailKind)
    || typeof value.providerId !== "string" || !SPOTIFY_ID.test(value.providerId)) return null;
  return { provider: "spotify", kind: value.kind as RestoreDetailKind, providerId: value.providerId };
}

function artistsOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const artists = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return artists && artists.length <= MAX_ARTISTS_LENGTH ? artists : null;
}

function albumOf(value: unknown): RestoreDetailV1["album"] {
  if (!record(value) || typeof value.providerId !== "string" || !SPOTIFY_ID.test(value.providerId)) return null;
  const name = normalizeSongTitle(value.name);
  if (!name) return null;
  const releaseDate = typeof value.releaseDate === "string" && RELEASE_DATE.test(value.releaseDate) ? value.releaseDate : null;
  return { providerId: value.providerId, name, imageUrl: normalizeArtworkUrl(value.imageUrl), releaseDate };
}

/**
 * Reads one page as Tagify can safely save it. Items that aren't music, or that carry no detail
 * worth saving, are dropped; unusable fields become null (Community's "Spotify track · <id>" stand-ins
 * are not names). Throws only when the page itself is malformed.
 */
export function parseRestoreDetailsPage(value: unknown): RestoreDetailsPageV1 {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > MAX_RESTORE_DETAILS_PAGE
    || !(value.nextCursor === null || (typeof value.nextCursor === "string" && UUID.test(value.nextCursor)))) {
    throw new Error("Invalid restore details");
  }
  const items: RestoreDetailV1[] = [];
  for (const item of value.items) {
    if (!record(item)) continue;
    const entity = entityOf(item.entity);
    if (!entity) continue;
    const detail: RestoreDetailV1 = {
      entity,
      title: normalizeSongTitle(item.title),
      artists: entity.kind === "track" || entity.kind === "album" ? artistsOf(item.artists) : null,
      album: entity.kind === "track" ? albumOf(item.album) : null,
      imageUrl: normalizeArtworkUrl(item.imageUrl),
    };
    if (detail.title || detail.artists || detail.album || detail.imageUrl) items.push(detail);
  }
  return { items, nextCursor: value.nextCursor as string | null, ...(value.paused === true ? { paused: true as const } : {}) };
}
