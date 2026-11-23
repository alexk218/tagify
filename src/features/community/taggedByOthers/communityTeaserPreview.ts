import { recordProductInteraction, type ProductEventDetails } from "@/features/product-analytics/productAnalytics";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { streamSpotifyLibrary, type LibraryReader } from "@/services/sync/SpotifyLibrarySender";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { COMMUNITY_ORIGIN } from "../communityLinks";
import { LIKED_PAGE_SONGS, type TaggedByOthersItem } from "./taggedByOthersScan";
import type { TaggedByOthersPreview, TaggedByOthersPreviewSong } from "./TaggedByOthersSection";

/**
 * For people who aren't connected to Community: how other members publicly tagged their Liked Songs.
 * Community answers without a sign-in, with how many of the songs asked about it found and, for at
 * most 10 of each request, how many people tagged each and their most used tag names (never who).
 * The whole of Liked Songs is asked about, 500 songs a request, up to the 5,000 songs a day
 * Community allows each address; the answer is kept for the day on this computer, so a Spotify
 * restart doesn't ask again.
 */
export const PREVIEW_PATH = "/api/v2/public/tagged-by-others-preview";
/** Songs per request: the most Community takes at once, and one Liked Songs read. */
export const PREVIEW_SONGS_ASKED = LIKED_PAGE_SONGS;
/** Songs asked about in all: Community's daily allowance for one address. */
export const PREVIEW_MAX_SONGS = 5_000;
/** Songs the preview shows, most members first. */
export const PREVIEW_SONGS_SHOWN = 20;
/** How long an answer is reused before Liked Songs are asked about again. */
export const PREVIEW_KEPT_MS = 12 * 60 * 60_000;
/** An older answer still shows while Community won't answer (paused, over the allowance, offline). */
export const PREVIEW_FALLBACK_MS = 7 * 24 * 60 * 60_000;
const SAVED_KEY = "tagify:community-teaser-preview";

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

/** Most members first; earlier (newer) songs first among equals. */
const byPeople = (songs: TaggedByOthersPreviewSong[]) => songs
  .map((song, order) => ({ song, order }))
  .sort((a, b) => b.song.people - a.song.people || a.order - b.order)
  .map(({ song }) => song);

export async function loadCommunityTeaserPreview({
  library = spotifyApiService,
  request = fetch,
  origin = COMMUNITY_ORIGIN,
  signal,
}: { library?: LibraryReader; request?: typeof fetch; origin?: string; signal?: AbortSignal } = {}): Promise<TaggedByOthersPreview | null> {
  let found = 0;
  let asked = 0;
  let answered = false;
  let complete = true;
  const songs: TaggedByOthersPreviewSong[] = [];
  const seen = new Set<string>();

  // One request: false once Community won't answer more (paused, over the allowance, offline).
  const ask = async (tracks: Map<string, SpotifyTrack>) => {
    try {
      const response = await request(`${origin}${PREVIEW_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ songs: [...tracks.keys()] }),
        signal,
      });
      if (!response.ok) return false;
      const answer = previewSongsOf(await response.json().catch(() => null), tracks);
      if (!answer) return false;
      answered = true;
      found += answer.found;
      asked += tracks.size;
      songs.push(...answer.songs);
      return true;
    } catch {
      return false;
    }
  };

  const lists = streamSpotifyLibrary(library, signal, { likedOnly: true, likedPageSize: PREVIEW_SONGS_ASKED });
  let batch = new Map<string, SpotifyTrack>();
  let refused = false;
  try {
    reading: for (;;) {
      const step = await lists.next();
      if (step.done) break;
      if (step.value.kind !== "liked") continue;
      for (const track of step.value.tracks) {
        const id = idOf(track.uri);
        if (!id || !SPOTIFY_ID.test(id) || seen.has(id)) continue;
        // More Liked Songs than Community answers about in a day: the count covers the newest.
        if (asked + batch.size >= PREVIEW_MAX_SONGS) { complete = false; break reading; }
        seen.add(id);
        batch.set(id, track);
        if (batch.size === PREVIEW_SONGS_ASKED) {
          const ok = await ask(batch);
          batch = new Map();
          if (!ok) { refused = true; break reading; }
        }
      }
      if (signal?.aborted) break;
    }
  } catch {
    // Spotify stopped answering part way: what Community already answered still counts.
    complete = false;
  } finally {
    void lists.return?.(undefined);
  }
  if (refused) complete = false;
  else if (batch.size && !signal?.aborted && !(await ask(batch))) complete = false;
  if (!answered || !songs.length || signal?.aborted) return null;
  return { songs: byPeople(songs).slice(0, PREVIEW_SONGS_SHOWN), total: found, asked, complete };
}

const savedKey = () => {
  const user = (globalThis as { Spicetify?: { Platform?: { username?: unknown } } }).Spicetify?.Platform?.username;
  return typeof user === "string" && user ? `${SAVED_KEY}:${user}` : SAVED_KEY;
};

/** The answer kept from earlier today, so a Spotify restart doesn't spend Community's allowance again. */
export function loadSavedTeaserPreview(now = Date.now(), keptMs = PREVIEW_KEPT_MS): TaggedByOthersPreview | null {
  try {
    const saved = JSON.parse(localStorage.getItem(savedKey()) || "null") as { at?: unknown; preview?: TaggedByOthersPreview } | null;
    if (!saved || typeof saved.at !== "number" || now - saved.at > keptMs || now < saved.at) return null;
    const preview = saved.preview;
    if (!preview || !Array.isArray(preview.songs) || !preview.songs.length || typeof preview.total !== "number") return null;
    return preview;
  } catch {
    return null;
  }
}

export function saveTeaserPreview(preview: TaggedByOthersPreview, now = Date.now()) {
  try { localStorage.setItem(savedKey(), JSON.stringify({ at: now, preview })); } catch { /* Only means asking again. */ }
}

let shared: Promise<TaggedByOthersPreview | null> | null = null;

/** The preview for this Spotify session: asked once, then reused by every surface. */
export function communityTeaserPreview(): Promise<TaggedByOthersPreview | null> {
  shared ??= (async () => {
    const saved = loadSavedTeaserPreview();
    if (saved) return saved;
    const preview = await loadCommunityTeaserPreview();
    if (preview) saveTeaserPreview(preview);
    return preview ?? loadSavedTeaserPreview(Date.now(), PREVIEW_FALLBACK_MS);
  })();
  return shared;
}

/** Forgets the preview, for example once the member connects. */
export function forgetCommunityTeaserPreview() {
  shared = null;
  try { localStorage.removeItem(savedKey()); } catch { /* Nothing kept. */ }
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

export type CommunityTeaserSurface = "tab" | "rows" | "track_details" | "tag_search";
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
