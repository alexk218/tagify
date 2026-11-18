import { recordProductInteraction, type ProductEventDetails } from "@/features/product-analytics/productAnalytics";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { streamSpotifyLibrary, type LibraryReader } from "@/services/sync/SpotifyLibrarySender";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { COMMUNITY_ORIGIN } from "../communityLinks";
import { LIKED_PAGE_SONGS, type TaggedByOthersItem } from "./taggedByOthersScan";
import type { TaggedByOthersPreview, TaggedByOthersPreviewSong } from "./TaggedByOthersSection";

/**
 * For people who aren't connected to Community: how other members publicly tagged some of their
 * newest Liked Songs. Community answers without a sign-in, with how many songs it found and, for at
 * most 10 of them, how many people tagged each and their most used tag names (never who). One read
 * of Liked Songs and one question per Spotify session, so a library is never read just for this.
 */
export const PREVIEW_PATH = "/api/v2/public/tagged-by-others-preview";
/** Songs asked about: Liked Songs newest first, one Spotify read. */
export const PREVIEW_SONGS_ASKED = LIKED_PAGE_SONGS;


const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
const idOf = (uri: string) => (uri.startsWith("spotify:track:") ? uri.slice("spotify:track:".length) : null);

/** Reads Community's answer; anything it can't read means no preview. */
export function previewSongsOf(payload: unknown, tracks: ReadonlyMap<string, SpotifyTrack>): { found: number; songs: TaggedByOthersPreviewSong[] } | null {
  const value = payload as { found?: unknown; songs?: unknown } | null;
  if (!value || typeof value.found !== "number" || !Number.isInteger(value.found) || value.found < 0 || !Array.isArray(value.songs)) return null;
  const songs: TaggedByOthersPreviewSong[] = [];
  for (const song of value.songs as { providerId?: unknown; people?: unknown; tags?: unknown }[]) {
    const track = typeof song?.providerId === "string" ? tracks.get(song.providerId) : undefined;
    if (!track || !Array.isArray(song.tags)) continue;
    const tags = (song.tags as { label?: unknown; people?: unknown }[])
      .filter((tag) => typeof tag?.label === "string" && tag.label.trim())
      .map((tag) => ({ label: (tag.label as string).trim(), paths: [(tag.label as string).trim()], people: Number.isInteger(tag.people) && (tag.people as number) > 0 ? tag.people as number : 1 }));
    if (!tags.length) continue;
    const people = Number.isInteger(song.people) && (song.people as number) > 0 ? song.people as number : 1;
    songs.push({ track, tags, people, peopleCapped: people >= 50 });
  }
  return { found: Math.max(value.found, songs.length), songs };
}

export async function loadCommunityTeaserPreview({
  library = spotifyApiService,
  request = fetch,
  origin = COMMUNITY_ORIGIN,
  signal,
}: { library?: LibraryReader; request?: typeof fetch; origin?: string; signal?: AbortSignal } = {}): Promise<TaggedByOthersPreview | null> {
  const tracks = new Map<string, SpotifyTrack>();
  const lists = streamSpotifyLibrary(library, signal, { likedOnly: true, likedPageSize: PREVIEW_SONGS_ASKED });
  try {
    for (;;) {
      const step = await lists.next();
      if (step.done) break;
      if (step.value.kind !== "liked") continue;
      for (const track of step.value.tracks) {
        const id = idOf(track.uri);
        if (id && SPOTIFY_ID.test(id) && tracks.size < PREVIEW_SONGS_ASKED) tracks.set(id, track);
      }
      if (tracks.size) break;
    }
  } catch {
    return null;
  } finally {
    void lists.return?.(undefined);
  }
  if (!tracks.size || signal?.aborted) return null;
  try {
    const response = await request(`${origin}${PREVIEW_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ songs: [...tracks.keys()] }),
      signal,
    });
    if (!response.ok) return null;
    const answer = previewSongsOf(await response.json().catch(() => null), tracks);
    if (!answer || !answer.songs.length) return null;
    return { songs: answer.songs, total: answer.found, asked: tracks.size };
  } catch {
    return null;
  }
}

let shared: Promise<TaggedByOthersPreview | null> | null = null;

/** The preview for this Spotify session: asked once, then reused by every surface. */
export function communityTeaserPreview(): Promise<TaggedByOthersPreview | null> {
  shared ??= loadCommunityTeaserPreview();
  return shared;
}

/** Forgets the preview, for example once the member connects. */
export function forgetCommunityTeaserPreview() {
  shared = null;
}

/** Tagged Tracks rows: the same songs the "Tagged by others" preview shows usable, keyed by Spotify URI. */
export function teaserRowsOf(preview: TaggedByOthersPreview | null, usable: number): Map<string, TaggedByOthersItem> {
  const rows = new Map<string, TaggedByOthersItem>();
  if (!preview) return rows;
  for (const song of [...preview.songs].sort((a, b) => b.people - a.people).slice(0, usable)) {
    const id = idOf(song.track.uri);
    if (id) rows.set(song.track.uri, { providerId: id, people: song.people, peopleCapped: song.peopleCapped, sample: [], tags: song.tags });
  }
  return rows;
}

export type CommunityTeaserSurface = "tab" | "rows" | "track_details";
const viewed = new Set<CommunityTeaserSurface>();

/** Songs other members tagged among the songs asked about, in coarse ranges. */
export function foundBucket(found: number): ProductEventDetails["found_bucket"] {
  if (!Number.isInteger(found) || found < 1) return undefined;
  return found < 10 ? "1-9" : found < 50 ? "10-49" : found < 100 ? "50-99" : found < 250 ? "100-249" : "250+";
}

/** A teaser showed real songs: reported once per surface per Spotify session. */
export function recordCommunityTeaserViewed(surface: CommunityTeaserSurface, found?: number) {
  if (viewed.has(surface)) return;
  viewed.add(surface);
  const bucket = found === undefined ? undefined : foundBucket(found);
  recordProductInteraction("community_teaser_viewed", bucket ? { surface, found_bucket: bucket } : { surface });
}

export function recordCommunityTeaserConnectClicked(surface: CommunityTeaserSurface) {
  recordProductInteraction("community_teaser_connect_clicked", { surface });
}
