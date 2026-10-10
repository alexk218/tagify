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
