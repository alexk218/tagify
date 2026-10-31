// Catalog fill jobs: a catalog filler desktop (Community's allowlist, Alex's) reads album track
// lists and artist discographies that MusicBrainz and Spotify's embed page couldn't give Community,
// through Spotify's desktop app, and sends them (Community pending migration 9004; artist and album
// pages, Slice 3). GET /api/v2/sync/catalog-fill hands out jobs and the pace this desktop keeps;
// POST sends what it read. Every other desktop is handed nothing and reads nothing.
export const CATALOG_FILL_PROTOCOL_VERSION = 1 as const;
export const MAX_CATALOG_FILL_JOBS = 50;
export const MAX_CATALOG_FILL_REPORT_ITEMS = 20;
export const MAX_CATALOG_FILL_TRACKS = 300;
export const MAX_CATALOG_FILL_RELEASES = 1000;
export const MAX_CATALOG_FILL_ARTISTS_PER_TRACK = 20;
export const MAX_CATALOG_FILL_NAME_LENGTH = 240;

export type CatalogFillJobKind = "albumTracks" | "artistDiscography";
export interface CatalogFillJobV1 { kind: CatalogFillJobKind; providerId: string }
/** How fast this desktop may read for the filler. */
export interface CatalogFillPaceV1 {
  preset: "conservative" | "fast";
  /** The least time between two reads. */
  readIntervalMs: number;
  hourlyReads: number;
  /** Reads in a UTC day on this computer. */
  dailyReads: number;
}
export interface CatalogFillJobsV1 { filler: boolean; pace: CatalogFillPaceV1 | null; items: CatalogFillJobV1[]; hasMore: boolean }

export interface CatalogFillArtistV1 { providerId: string; name: string }
export interface CatalogFillTrackV1 {
  disc: number;
  position: number;
  providerId: string;
  name: string;
  artists: CatalogFillArtistV1[];
  durationMs: number | null;
}
/** Spotify's own release kinds, EPs kept apart (artist pages list EPs on their own). */
export type CatalogFillReleaseKind = "album" | "single" | "ep" | "compilation";
export interface CatalogFillReleaseV1 {
  providerId: string;
  name: string;
  albumType: CatalogFillReleaseKind;
  /** "2024", "2024-06" or "2024-06-01". */
  releaseDate: string | null;
}
export type CatalogFillReportItemV1 =
  | { kind: "albumTracks"; providerId: string; outcome: "found"; tracks: CatalogFillTrackV1[] }
  | { kind: "artistDiscography"; providerId: string; outcome: "found"; releases: CatalogFillReleaseV1[] }
  | { kind: CatalogFillJobKind; providerId: string; outcome: "missing" };
export interface CatalogFillReportV1 { protocolVersion: typeof CATALOG_FILL_PROTOCOL_VERSION; deviceId: string; items: CatalogFillReportItemV1[] }
export interface CatalogFillReportResultV1 { accepted: number; ignored: number }

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELEASE_DATE = /^[0-9]{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?)?$/;
const KINDS = new Set(["album", "single", "ep", "compilation"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** A Spotify name as Community keeps it: one line, trimmed, at most 240 characters. Null when unusable. */
export function normalizeCatalogFillName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_CATALOG_FILL_NAME_LENGTH ? name : null;
}

/** Spotify's release type (ALBUM, SINGLE, EP, COMPILATION) as Community keeps it, or null. */
export function normalizeCatalogFillReleaseKind(value: unknown): CatalogFillReleaseKind | null {
  if (typeof value !== "string") return null;
  const kind = value.trim().toLowerCase();
  return KINDS.has(kind) ? kind as CatalogFillReleaseKind : null;
}

export function isCatalogFillReleaseDate(value: unknown): value is string {
  return typeof value === "string" && RELEASE_DATE.test(value);
}

function isPace(value: unknown): value is CatalogFillPaceV1 {
  return record(value) && (value.preset === "conservative" || value.preset === "fast")
    && whole(value.readIntervalMs, 250, 600_000) && whole(value.hourlyReads, 1, 100_000) && whole(value.dailyReads, 1, 1_000_000);
}

/** Community's jobs answer. An unknown job kind is dropped, never guessed at, so later kinds don't stop older desktops. */
export function parseCatalogFillJobs(value: unknown): CatalogFillJobsV1 {
  if (!record(value) || typeof value.filler !== "boolean" || !Array.isArray(value.items) || value.items.length > MAX_CATALOG_FILL_JOBS
    || typeof value.hasMore !== "boolean") throw new Error("Invalid catalog fill jobs");
  const pace = isPace(value.pace) ? {
    preset: value.pace.preset, readIntervalMs: value.pace.readIntervalMs, hourlyReads: value.pace.hourlyReads, dailyReads: value.pace.dailyReads,
  } : null;
  const items = value.items.flatMap((item): CatalogFillJobV1[] =>
    record(item) && (item.kind === "albumTracks" || item.kind === "artistDiscography") && typeof item.providerId === "string" && SPOTIFY_ID.test(item.providerId)
      ? [{ kind: item.kind, providerId: item.providerId }] : []);
  return { filler: value.filler && !!pace, pace, items: value.filler && pace ? items : [], hasMore: value.filler && !!pace && value.hasMore };
}

function isArtist(value: unknown): value is CatalogFillArtistV1 {
  return record(value) && typeof value.providerId === "string" && SPOTIFY_ID.test(value.providerId) && normalizeCatalogFillName(value.name) === value.name;
}

function isTrack(value: unknown): value is CatalogFillTrackV1 {
  return record(value) && whole(value.disc, 1, 99) && whole(value.position, 1, MAX_CATALOG_FILL_TRACKS)
    && typeof value.providerId === "string" && SPOTIFY_ID.test(value.providerId) && normalizeCatalogFillName(value.name) === value.name
    && Array.isArray(value.artists) && value.artists.length <= MAX_CATALOG_FILL_ARTISTS_PER_TRACK && value.artists.every(isArtist)
    && (value.durationMs === null || whole(value.durationMs, 1, 86_400_000));
}

function isRelease(value: unknown): value is CatalogFillReleaseV1 {
  return record(value) && typeof value.providerId === "string" && SPOTIFY_ID.test(value.providerId)
    && normalizeCatalogFillName(value.name) === value.name && normalizeCatalogFillReleaseKind(value.albumType) === value.albumType
    && (value.releaseDate === null || isCatalogFillReleaseDate(value.releaseDate));
}

function isReportItem(value: unknown): value is CatalogFillReportItemV1 {
  if (!record(value) || (value.kind !== "albumTracks" && value.kind !== "artistDiscography")
    || typeof value.providerId !== "string" || !SPOTIFY_ID.test(value.providerId)) return false;
  if (value.outcome === "missing") return true;
  if (value.outcome !== "found") return false;
  if (value.kind === "albumTracks") {
    if (!Array.isArray(value.tracks) || value.tracks.length < 1 || value.tracks.length > MAX_CATALOG_FILL_TRACKS || !value.tracks.every(isTrack)) return false;
    return new Set(value.tracks.map((track) => `${track.disc}:${track.position}`)).size === value.tracks.length;
  }
  if (!Array.isArray(value.releases) || value.releases.length < 1 || value.releases.length > MAX_CATALOG_FILL_RELEASES || !value.releases.every(isRelease)) return false;
  return new Set(value.releases.map((release) => release.providerId)).size === value.releases.length;
}

export function assertCatalogFillReport(value: unknown): asserts value is CatalogFillReportV1 {
  if (!record(value) || value.protocolVersion !== CATALOG_FILL_PROTOCOL_VERSION || typeof value.deviceId !== "string" || !UUID.test(value.deviceId)
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_CATALOG_FILL_REPORT_ITEMS || !value.items.every(isReportItem)) {
    throw new Error("Invalid catalog fill report");
  }
}
