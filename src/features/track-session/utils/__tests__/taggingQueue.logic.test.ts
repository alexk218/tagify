// @vitest-environment node
import { expect, it } from "vitest";
import { matchesQueueGap, normalizeQueuePage } from "../taggingQueue.logic";
it("distinguishes automatic metadata from intentional tags, rating, energy and category coverage", () => {
  const automatic = { rating: 0, energy: 0, bpm: 120, camelotKey: "8A", tagIds: [] };
  expect(matchesQueueGap(automatic, "untagged", new Set())).toBe(true);
  const rated = { ...automatic, rating: 4, tagIds: ["mood"] };
  expect(matchesQueueGap(rated, "tags", new Set())).toBe(false);
  expect(matchesQueueGap(rated, "energy", new Set())).toBe(true);
  expect(matchesQueueGap(rated, "category", new Set(["genre"]))).toBe(true);
  expect(matchesQueueGap(rated, "category", new Set(["mood"]))).toBe(false);
  expect(matchesQueueGap({ ...rated, energy: 5 }, "incomplete", new Set())).toBe(false);
});
it("advances by all items including unavailable tracks and distinguishes an unfinished page", () => {
  const page = normalizeQueuePage({ items: [{ track: { uri: "spotify:track:one", name: "One" } }, { track: null }], total: 3, next: "next" }, 0);
  expect(page).toMatchObject({ checked: 2, unavailable: 1, nextOffset: 2, total: 3 });
  expect(page.tracks.map(track => track.name)).toEqual(["One"]);
  expect(() => normalizeQueuePage({ items: [], total: 3 }, 2)).toThrow();
  expect(() => normalizeQueuePage({}, 0)).toThrow();
});

it("keeps when each song was added, as Spotify's desktop library reports it", () => {
  const page = normalizeQueuePage({ items: [
    { type: "track", uri: "spotify:track:a", name: "Liked", addedAt: "2026-11-15T10:00:00.000Z" },
    { uid: "x", addedAt: { timestamp: 1_700_000_000_000 }, type: "track", uri: "spotify:track:b", name: "Playlist" },
    { type: "track", uri: "spotify:track:c", name: "Undated", addedAt: "not a date" },
  ], total: 3 }, 0);
  expect(page.tracks.map(track => track.addedAt)).toEqual([Date.parse("2026-11-15T10:00:00.000Z"), 1_700_000_000_000, undefined]);
});
