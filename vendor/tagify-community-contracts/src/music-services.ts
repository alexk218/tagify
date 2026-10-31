// Music services on Community (packages/tagify-community/docs/MUSIC_SERVICES.md, Phase 3). Additive
// only: every V1 type and @tagify/sync-contracts stay as they are, and Tagify desktops never read these.

/** A music service a Community viewer can listen on. */
export type MusicServiceId = "spotify" | "apple_music";

export const MUSIC_SERVICE_IDS: readonly MusicServiceId[] = ["spotify", "apple_music"];

export function isMusicServiceId(value: unknown): value is MusicServiceId {
  return value === "spotify" || value === "apple_music";
}

/**
 * Whether some music is on a service: `available` with its IDs there, `unavailable` when the
 * service was asked and has none, `unknown` while that isn't known yet.
 */
export interface ServiceAvailabilityV1 {
  service: MusicServiceId;
  status: "available" | "unavailable" | "unknown";
  /** The music's IDs on `service`, best first; empty unless available. */
  ids: string[];
}

/** A song's MusicBrainz (CC0) name, shown to viewers whose service doesn't name it. */
export interface NeutralNameV1 {
  title: string;
  artistCredit: string | null;
  source: "musicbrainz";
  license: "CC0-1.0";
  sourceUrl: string;
}

/**
 * Apple Music's own name, artist line and artwork for music an Apple Music viewer can play there,
 * as Community stored it from Apple (migration 0292, refreshed every 30 days). Shown only beside
 * Apple Music playback; Spotify viewers never receive it.
 */
export interface AppleMusicNameV1 {
  title: string;
  artistName: string | null;
  /** Apple's artwork URL template (`{w}x{h}`) with its full size, or null. */
  artwork: { url: string; width: number | null; height: number | null } | null;
}

/** What a viewer of one service may see of a catalog item (`service_presentations_v1`, 0287). */
export interface ServicePresentationV1 {
  entityId: string;
  kind: "track" | "album" | "artist";
  /** The service the item was born on. */
  origin: MusicServiceId;
  availability: ServiceAvailabilityV1;
  /** Only for items that aren't the viewer's service's own, when MusicBrainz names them. */
  neutral: NeutralNameV1 | null;
  /** Only for Apple Music viewers and music available to them there (0292): Apple's stored name. */
  apple?: AppleMusicNameV1 | null;
}

const APPLE_ARTWORK = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.mzstatic\.com\//;
const artworkSize = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);

/** Apple's stored name for a presentation, only when it is an Apple Music viewer's playable item. */
function parseAppleMusicName(value: unknown, availability: ServiceAvailabilityV1): AppleMusicNameV1 | null {
  if (availability.service !== "apple_music" || availability.status !== "available" || !value || typeof value !== "object") return null;
  const apple = value as Record<string, unknown>;
  if (typeof apple.title !== "string" || !apple.title.trim()) return null;
  const artwork = apple.artwork as Record<string, unknown> | null | undefined;
  return {
    title: apple.title,
    artistName: typeof apple.artistName === "string" && apple.artistName.trim() ? apple.artistName : null,
    artwork: artwork && typeof artwork.url === "string" && APPLE_ARTWORK.test(artwork.url)
      ? { url: artwork.url, width: artworkSize(artwork.width), height: artworkSize(artwork.height) } : null,
  };
}

/** Reads one presentation from the database's answer, or null when it isn't one. */
export function parseServicePresentationV1(value: unknown): ServicePresentationV1 | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const availability = row.availability as Record<string, unknown> | null | undefined;
  if (typeof row.entityId !== "string" || !["track", "album", "artist"].includes(String(row.kind)) || !isMusicServiceId(row.origin)
    || !availability || !isMusicServiceId(availability.service) || !["available", "unavailable", "unknown"].includes(String(availability.status))
    || !Array.isArray(availability.ids)) return null;
  const neutral = row.neutral as Record<string, unknown> | null | undefined;
  const shown: ServiceAvailabilityV1 = {
    service: availability.service,
    status: availability.status as ServiceAvailabilityV1["status"],
    ids: availability.ids.filter((id): id is string => typeof id === "string"),
  };
  const apple = parseAppleMusicName(row.apple, shown);
  return {
    entityId: row.entityId,
    kind: row.kind as ServicePresentationV1["kind"],
    origin: row.origin,
    availability: shown,
    neutral: neutral && typeof neutral.title === "string" && typeof neutral.sourceUrl === "string" ? {
      title: neutral.title,
      artistCredit: typeof neutral.artistCredit === "string" ? neutral.artistCredit : null,
      source: "musicbrainz",
      license: "CC0-1.0",
      sourceUrl: neutral.sourceUrl,
    } : null,
    ...(apple ? { apple } : {}),
  };
}
