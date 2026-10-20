// Artist credits Tagify desktop reads from Spotify's desktop app and sends Community, so the
// website doesn't spend its development-mode Web API quota on one lookup per song or album.
// A side document next to sync: GET /api/v2/sync/artist-credits lists what Community still needs
// from this member's library, POST sends what the desktop found.
export const ARTIST_CREDITS_PROTOCOL_VERSION = 1 as const;
export const MAX_ARTIST_CREDIT_REPORT_ITEMS = 200;
export const MAX_ARTIST_CREDITS_PER_ITEM = 20;
export const MAX_ARTIST_CREDITS_NEEDED = 500;
export const MAX_ARTIST_NAME_LENGTH = 200;

export type ArtistCreditEntityKind = "track" | "album";
export interface ArtistCreditEntityV1 { provider: "spotify"; kind: ArtistCreditEntityKind; providerId: string }
/** One artist as Spotify's desktop app lists it; the first is the main artist. */
export interface ArtistCreditV1 { providerId: string; name: string }
export interface ArtistCreditReportItemV1 { entity: ArtistCreditEntityV1; artists: ArtistCreditV1[] }
export interface ArtistCreditReportV1 { protocolVersion: typeof ARTIST_CREDITS_PROTOCOL_VERSION; deviceId: string; items: ArtistCreditReportItemV1[] }
export interface ArtistCreditsNeededV1 { items: ArtistCreditEntityV1[]; hasMore: boolean }
export interface ArtistCreditReportResultV1 { accepted: number; ignored: number }

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function isArtistCreditEntity(value: unknown): value is ArtistCreditEntityV1 {
  return record(value) && value.provider === "spotify" && (value.kind === "track" || value.kind === "album")
    && typeof value.providerId === "string" && SPOTIFY_ID.test(value.providerId);
}

/** A name as Community shows it: trimmed, one line, at most 200 characters. Null when unusable. */
export function normalizeArtistName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return name && name.length <= MAX_ARTIST_NAME_LENGTH ? name : null;
}

function assertArtists(value: unknown): asserts value is ArtistCreditV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ARTIST_CREDITS_PER_ITEM) throw new Error("Invalid artist credits");
  const seen = new Set<string>();
  for (const artist of value) {
    if (!record(artist) || typeof artist.providerId !== "string" || !SPOTIFY_ID.test(artist.providerId) || seen.has(artist.providerId)
      || normalizeArtistName(artist.name) !== artist.name) throw new Error("Invalid artist credits");
    seen.add(artist.providerId);
  }
}

export function assertArtistCreditReport(value: unknown): asserts value is ArtistCreditReportV1 {
  if (!record(value) || value.protocolVersion !== ARTIST_CREDITS_PROTOCOL_VERSION || typeof value.deviceId !== "string" || !UUID.test(value.deviceId)
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_ARTIST_CREDIT_REPORT_ITEMS) throw new Error("Invalid artist credits");
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!record(item) || !isArtistCreditEntity(item.entity)) throw new Error("Invalid artist credits");
    const key = `${item.entity.kind}:${item.entity.providerId}`;
    if (seen.has(key)) throw new Error("Invalid artist credits");
    seen.add(key);
    assertArtists(item.artists);
  }
}

export function assertArtistCreditsNeeded(value: unknown): asserts value is ArtistCreditsNeededV1 {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > MAX_ARTIST_CREDITS_NEEDED || typeof value.hasMore !== "boolean"
    || !value.items.every(isArtistCreditEntity)) throw new Error("Invalid artist credit request");
}
