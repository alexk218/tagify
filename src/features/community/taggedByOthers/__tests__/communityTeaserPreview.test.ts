import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { LibraryReader } from "@/services/sync/SpotifyLibrarySender";

vi.mock("@/services/SpotifyApiService", () => ({ spotifyApiService: {} }));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: vi.fn() }));

import {
  PREVIEW_FALLBACK_MS, PREVIEW_KEPT_MS, PREVIEW_MAX_SONGS, PREVIEW_SONGS_SHOWN, loadCommunityTeaserPreview, loadSavedTeaserPreview, saveTeaserPreview,
} from "../communityTeaserPreview";

const idOf = (index: number) => `t${String(index).padStart(21, "0")}`;
const song = (index: number) => ({ uri: `spotify:track:${idOf(index)}`, name: `Song ${index}`, artists: [{ name: "Artist" }] }) as unknown as SpotifyTrack;

/** Liked Songs of `count` songs, newest first, read 500 at a time as the desktop library answers. */
function library(count: number) {
  const reads: number[] = [];
  const reader: LibraryReader = {
    getTaggingQueuePage: vi.fn(async (_list, offset = 0, _signal, size = 50) => {
      reads.push(offset);
      const tracks = Array.from({ length: Math.max(0, Math.min(size, count - offset)) }, (_, index) => song(offset + index));
      return { tracks, nextOffset: offset + size < count ? offset + size : null };
    }),
    getAllUserPlaylistReferencesStrict: vi.fn(),
    readPlaylistTracks: vi.fn(),
  };
  return { reader, reads };
}

/** Community: every 10th song asked about is tagged by others; describes at most 10 a request. */
function community({ refuseFrom = Infinity }: { refuseFrom?: number } = {}) {
  const asked: number[] = [];
  const request = vi.fn(async (_url: string, init?: RequestInit) => {
    const songs = (JSON.parse(String(init?.body)) as { songs: string[] }).songs;
    asked.push(songs.length);
    if (asked.length >= refuseFrom) return new Response(JSON.stringify({ error: "tagged_by_others_preview_limited" }), { status: 429 });
    const tagged = songs.filter((id) => Number(id.slice(1)) % 10 === 0);
    return new Response(JSON.stringify({
      found: tagged.length,
      songs: tagged.slice(0, 10).map((providerId) => ({ providerId, people: Number(providerId.slice(1)) % 7 + 1, tags: [{ label: "Dark", people: 2 }] })),
    }), { status: 200 });
  });
  return { request: request as unknown as typeof fetch, asked };
}

afterEach(() => localStorage.clear());

describe("the preview for people who aren't connected", () => {
  it("asks about the whole of Liked Songs, 500 at a time, and counts every song found", async () => {
    const { reader } = library(1_234);
    const { request, asked } = community();
    const preview = await loadCommunityTeaserPreview({ library: reader, request, origin: "https://x" });
    expect(asked).toEqual([500, 500, 234]);
    expect(preview).toMatchObject({ total: 124, asked: 1_234, complete: true });
    expect(preview!.songs).toHaveLength(PREVIEW_SONGS_SHOWN);
    // Most members first.
    const people = preview!.songs.map((item) => item.people);
    expect([...people].sort((a, b) => b - a)).toEqual(people);
  });

  it("stops at the songs Community answers about in a day and says only the newest were counted", async () => {
    const { reader } = library(7_000);
    const { request, asked } = community();
    const preview = await loadCommunityTeaserPreview({ library: reader, request, origin: "https://x" });
    expect(asked.reduce((sum, size) => sum + size, 0)).toBe(PREVIEW_MAX_SONGS);
    expect(preview).toMatchObject({ total: 500, asked: PREVIEW_MAX_SONGS, complete: false });
  });

  it("keeps what Community already answered when it stops answering", async () => {
    const { reader } = library(2_000);
    const { request, asked } = community({ refuseFrom: 3 });
    const preview = await loadCommunityTeaserPreview({ library: reader, request, origin: "https://x" });
    expect(asked).toHaveLength(3);
    expect(preview).toMatchObject({ total: 100, asked: 1_000, complete: false });
  });

  it("shows nothing while Community has the preview paused, after one request", async () => {
    const { reader, reads } = library(2_000);
    const { request, asked } = community({ refuseFrom: 1 });
    expect(await loadCommunityTeaserPreview({ library: reader, request, origin: "https://x" })).toBeNull();
    expect(asked).toHaveLength(1);
    expect(reads).toEqual([0]);
  });

  it("keeps the answer for the day, so a Spotify restart doesn't ask again", () => {
    const preview = { total: 742, asked: 3_000, complete: true, songs: [{ track: song(10), tags: [{ label: "Dark", paths: ["Dark"], people: 2 }], people: 3, peopleCapped: false }] };
    saveTeaserPreview(preview, 1_000);
    expect(loadSavedTeaserPreview(1_000 + PREVIEW_KEPT_MS - 1)).toMatchObject({ total: 742, complete: true });
    expect(loadSavedTeaserPreview(1_000 + PREVIEW_KEPT_MS + 1)).toBeNull();
  });

  it("falls back to an older answer for a week while Community won't answer", () => {
    const preview = { total: 742, asked: 3_000, complete: true, songs: [{ track: song(10), tags: [{ label: "Dark", paths: ["Dark"], people: 2 }], people: 3, peopleCapped: false }] };
    saveTeaserPreview(preview, 1_000);
    expect(loadSavedTeaserPreview(1_000 + PREVIEW_KEPT_MS + 1, PREVIEW_FALLBACK_MS)).toMatchObject({ total: 742 });
    expect(loadSavedTeaserPreview(1_000 + PREVIEW_FALLBACK_MS + 1, PREVIEW_FALLBACK_MS)).toBeNull();
  });
});
