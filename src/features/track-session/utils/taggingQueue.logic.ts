import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { TrackData } from "@/types/tagData";

export type QueueGap = "untagged" | "tags" | "rating" | "energy" | "category" | "incomplete";
export interface TaggingQueuePage {
  tracks: SpotifyTrack[];
  checked: number;
  unavailable: number;
  nextOffset: number | null;
  total: number | null;
}
export function matchesQueueGap(track: TrackData | undefined, gap: QueueGap, categoryTags: Set<string>) {
  const tags = track?.tagIds || [];
  const noRating = !(track && track.rating > 0);
  const noEnergy = !(track && track.energy > 0);
  if (gap === "untagged") return !tags.length && noRating && noEnergy;
  if (gap === "tags") return !tags.length;
  if (gap === "rating") return noRating;
  if (gap === "energy") return noEnergy;
  if (gap === "category") return !tags.some((id) => categoryTags.has(id));
  return !tags.length || noRating || noEnergy;
}

export function normalizeQueuePage(page: unknown, offset: number): TaggingQueuePage {
  const value = page as { items?: unknown[]; total?: number; totalLength?: number; next?: unknown };
  if (!Array.isArray(value?.items)) throw new Error("Spotify couldn't return this part of your library. Please try again.");
  const rawTotal = value.totalLength ?? value.total;
  const total = typeof rawTotal === "number" && Number.isSafeInteger(rawTotal) && rawTotal >= 0 ? rawTotal : null;
  const object = (raw: unknown): Record<string, unknown> => raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const text = (raw: unknown, fallback = "") => typeof raw === "string" ? raw : fallback;
  const items = value.items;
  const tracks: SpotifyTrack[] = [];
  for (const raw of items) {
    const wrapper = object(raw);
    const track = object("track" in wrapper ? wrapper.track : "item" in wrapper ? wrapper.item : wrapper);
    const uri = track.uri ?? track.link;
    if (!uri || track.type === "episode") continue;
    if (typeof uri !== "string") throw new Error("Spotify couldn't return this part of your library. Please try again.");
    if (!uri.startsWith("spotify:track:") && !uri.startsWith("spotify:local:")) continue;
    const album = object(track.album);
    const albumUri = text(album.uri ?? album.link);
    const duration = track.duration_ms ?? object(track.duration).milliseconds;
    tracks.push({
      uri, name: text(track.name, "Unavailable track"),
      artists: Array.isArray(track.artists) ? track.artists.map((rawArtist) => {
        const artist = object(rawArtist);
        return { name: text(artist.name ?? object(artist.profile).name, "Unknown artist") };
      }) : [],
      album: { name: text(album.name), uri: albumUri.startsWith("spotify:album:") ? albumUri : null,
        images: Array.isArray(album.images) ? album.images.flatMap((rawImage) => {
          const url = text(object(rawImage).url);
          return url ? [{ url }] : [];
        }) : [] },
      duration_ms: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : 0,
    });
  }
  const hasMore = total !== null ? offset + items.length < total : "next" in value ? !!value.next : items.length === 50;
  if (hasMore && !items.length) throw new Error("Spotify stopped returning tracks before the end. Please retry this page.");
  return { tracks, checked: items.length, unavailable: items.length - tracks.length, nextOffset: hasMore ? offset + items.length : null, total };
}
