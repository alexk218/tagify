import { expect, it } from "vitest";
import { buildArtistTrackSummaries } from "../artistTrackSummaries";
import { summarizeTrackUris } from "@/features/playlist-state";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";

const taxonomy = buildTaxonomyFromCategoryTree([{ id: "cat_genre", name: "Genre", subcategories: [{ id: "sub_style", name: "Style", tags: [{ id: "tag_style", name: "Tag" }] }] }]);
const tracks = {
  a: { rating: 4, energy: 8, tagIds: ["tag_style"], bpm: null, artists: "Same Name", dateModified: 123 },
  b: { rating: 3, energy: 6, tagIds: [], bpm: null, artists: "Same Name, Guest", dateModified: 456 },
  c: { rating: 0, energy: 0, tagIds: ["tag_style"], bpm: null, artists: "Same Name", dateModified: 789 },
  d: { rating: 5, energy: 9, tagIds: [], bpm: null, artists: "Same Name", dateModified: 999 },
};
it("uses identities for namesakes and gives a collaboration one contribution per artist", () => {
  const original = structuredClone(tracks);
  const result = buildArtistTrackSummaries(tracks, taxonomy, {
    a: { artists: [{ uri: "spotify:artist:one", name: "Same Name" }] },
    b: { artists: [{ uri: "spotify:artist:one", name: "Same Name" }, { uri: "spotify:artist:guest", name: "Guest" }, { uri: "spotify:artist:guest", name: "Guest" }] },
    c: { artists: [{ uri: "spotify:artist:one", name: "Same Name" }] },
    d: { artists: [{ uri: "spotify:artist:two", name: "Same Name" }] },
  });
  expect(result.get("spotify:artist:one")).toMatchObject({ taggedTrackCount: 3, ratedTrackCount: 2, ratingAverage: 3.5, energyAverage: 7 });
  expect(result.get("spotify:artist:two")).toMatchObject({ taggedTrackCount: 1, ratedTrackCount: 1, ratingAverage: null });
  expect(result.get("spotify:artist:guest")).toMatchObject({ taggedTrackCount: 1, ratedTrackCount: 1 });
  expect(tracks).toEqual(original);
});
it("counts duplicate playlist songs once, excludes unrated tracks from averages, and handles empty lists", () => {
  expect(summarizeTrackUris(tracks, taxonomy, ["a", "b", "a", "c", "missing"]))
    .toMatchObject({ taggedTrackCount: 3, ratedTrackCount: 2, ratingAverage: 3.5, energyAverage: 7 });
  expect(summarizeTrackUris(tracks, taxonomy, ["a", "c"]).ratingAverage).toBeNull();
  expect(summarizeTrackUris(tracks, taxonomy, []).taggedTrackCount).toBe(0);
});
