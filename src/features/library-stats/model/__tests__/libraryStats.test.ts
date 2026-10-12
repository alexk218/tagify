import { describe, expect, it } from "vitest";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { buildTaxonomyFromCategoryTree, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import { computeLibraryStats, computeTagDetail, createStatsBaseline, dayKey, rangeStart, selectStatsTracks, statsTrackEntries } from "../libraryStats";

// Noon on Saturday 11 October 2026, local time.
const NOW = new Date(2026, 9, 11, 12).getTime();
const at = (month: number, day: number, year = 2026) => new Date(year, month - 1, day, 15).getTime();

function track(overrides: Partial<TrackData>): TrackData {
  return { rating: 0, energy: 0, bpm: null, tagIds: [], ...overrides };
}

function library(): TagDataStructure {
  const taxonomy = buildTaxonomyFromCategoryTree([
    { id: "cat_mood", name: "Mood", subcategories: [{ id: "sub_energy", name: "Energy", tags: [
      { id: "tag_calm", name: "Calm", accentId: "teal" },
      { id: "tag_loud", name: "Loud", accentId: "custom:neon" },
      { id: "tag_unused", name: "Unused" },
    ] }] },
    { id: "cat_place", name: "Place", subcategories: [{ id: "sub_where", name: "Where", tags: [
      { id: "tag_night", name: "Night drive" },
    ] }] },
  ]);
  // Custom colors must exist before a tag can use one, so attach it after building the tree.
  taxonomy.customAccentsById = { "custom:neon": { id: "custom:neon", name: "Neon", color: "#a855f7" } };
  taxonomy.tagsById.tag_loud.accentId = "custom:neon";
  return {
    schemaVersion: TAG_DATA_SCHEMA_VERSION,
    taxonomy,
    tracks: {
      "spotify:track:1": track({ tagIds: ["tag_calm", "tag_night"], rating: 4.5, energy: 3, bpm: 92, camelotKey: "8A", dateCreated: at(10, 11), dateModified: at(10, 11), name: "One", artists: "M83, Kavinsky", albumUri: "spotify:album:a", albumName: "Hurry Up", albumImageUrl: "https://i.scdn.co/a" }),
      "spotify:track:2": track({ tagIds: ["tag_calm", "tag_night"], rating: 4, energy: 2, bpm: 126, camelotKey: "8a", dateCreated: at(10, 10), dateModified: at(10, 10), artists: "M83", albumUri: "spotify:album:a", albumName: "Hurry Up" }),
      "spotify:track:3": track({ tagIds: ["tag_calm"], rating: 5, dateCreated: at(10, 9), dateModified: at(10, 9), artists: "Slowdive" }),
      "spotify:track:4": track({ tagIds: ["tag_loud"], dateCreated: at(9, 1), dateModified: at(9, 1), artists: "Kavinsky" }),
      "spotify:track:5": track({ rating: 3, dateCreated: at(5, 2), dateModified: at(5, 2) }),
      "spotify:track:6": track({ tagIds: ["tag_loud"], energy: 9, dateCreated: at(1, 3, 2025), dateModified: at(2, 1, 2025) }),
      "spotify:local:Artist:Album:Song+Name:200": track({ tagIds: ["tag_night"], rating: 2 }),
      // Present but never annotated; stats ignore it.
      "spotify:track:empty": track({ dateCreated: at(10, 11) }),
    },
    playlists: {
      "spotify:album:a": { rating: 4, energy: 0, tagIds: ["tag_night"], dateCreated: at(10, 1) },
      "spotify:playlist:p": { rating: 0, energy: 0, tagIds: ["tag_calm"], dateCreated: at(3, 1, 2024) },
    },
    artists: {
      "spotify:artist:m": { rating: 0, energy: 0, tagIds: ["tag_night", "tag_calm"], dateCreated: at(10, 2) },
    },
  };
}

describe("library stats", () => {
  it("summarizes the whole library", () => {
    const stats = computeLibraryStats(library(), "all", NOW);
    expect(stats.overview).toMatchObject({
      tracks: 7, taggedTracks: 6, ratedTracks: 5, energyTracks: 3, bpmTracks: 2, keyTracks: 2, completeTracks: 2, localTracks: 1,
      albums: 1, playlists: 1, artists: 1, tagsTotal: 4, tagsUsed: 3, tagsColored: 2, categories: 2,
    });
    expect(stats.overview.averageTagsPerTaggedTrack).toBeCloseTo(8 / 6);
    expect(stats.overview.averageRating).toBeCloseTo((4.5 + 4 + 5 + 3 + 2) / 5);
    expect(stats.undatedTracks).toBe(1);
  });

  it("ranks tags by every kind of use and resolves their colors", () => {
    const stats = computeLibraryStats(library(), "all", NOW);
    expect(stats.tags.top.map((tag) => [tag.name, tag.tracks, tag.albums, tag.playlists, tag.artists, tag.total])).toEqual([
      ["Calm", 3, 0, 1, 1, 5], ["Night drive", 3, 1, 0, 1, 5], ["Loud", 2, 0, 0, 0, 2],
    ]);
    expect(stats.tags.top.find((tag) => tag.name === "Calm")?.color).toBe("#2dd4bf");
    expect(stats.tags.top.find((tag) => tag.name === "Loud")?.color).toBe("#a855f7");
    expect(stats.tags.unused.map((tag) => tag.name)).toEqual(["Unused"]);
    expect(stats.tags.categories).toEqual([
      { id: "cat_mood", name: "Mood", uses: 7, tags: 3, usedTags: 2 },
      { id: "cat_place", name: "Place", uses: 5, tags: 1, usedTags: 1 },
    ]);
  });

  it("finds tags that go together, rising tags and tags left behind", () => {
    const stats = computeLibraryStats(library(), "all", NOW);
    expect(stats.tags.pairs.map((pair) => [pair.a.name, pair.b.name, pair.tracks])).toEqual([["Calm", "Night drive", 2]]);
    // Calm and Night drive appear on tracks first tagged in the last 30 days, none in the 30 before.
    expect(stats.tags.rising.map((tag) => tag.name)).toEqual(["Calm", "Night drive"]);
    // Loud was last on a track changed in February 2025 and on one changed 1 September 2026 (within 90 days).
    expect(stats.tags.stale.map((tag) => tag.name)).toEqual([]);
    const older = computeLibraryStats(library(), "all", new Date(2027, 0, 15).getTime());
    expect(older.tags.stale.map((tag) => tag.name)).toEqual(["Loud", "Calm", "Night drive"]);
  });

  it("counts activity by day, week, month and streak", () => {
    const { activity } = computeLibraryStats(library(), "all", NOW);
    expect(activity.days).toHaveLength(53 * 7 - 1 + 1 - (6 - new Date(NOW).getDay()));
    expect(activity.days.at(-1)).toEqual({ date: "2026-10-11", count: 1 });
    expect(new Date(activity.days[0].date + "T12:00").getDay()).toBe(0);
    expect(activity.currentStreak).toBe(3);
    expect(activity.longestStreak).toBe(3);
    expect(activity.busiestDay).toEqual({ date: "2026-10-11", count: 1 });
    expect(activity.months.at(-1)).toEqual({ month: "2026-10", count: 3 });
    // The first dated tagging was January 2025, so All time shows 22 months.
    expect(activity.months).toHaveLength(22);
    expect(activity.months[0]).toEqual({ month: "2025-01", count: 1 });
    expect(activity.hours[15]).toBe(6);
    expect(activity.weekdays.reduce((sum, count) => sum + count, 0)).toBe(6);
    expect(activity.activeDays).toBe(6);
  });

  it("keeps a streak alive until the end of the day after the last tagging", () => {
    const tomorrow = new Date(2026, 9, 12, 20).getTime();
    expect(computeLibraryStats(library(), "all", tomorrow).activity.currentStreak).toBe(3);
    const twoDaysLater = new Date(2026, 9, 13, 9).getTime();
    expect(computeLibraryStats(library(), "all", twoDaysLater).activity.currentStreak).toBe(0);
  });

  it("limits everything but the heatmap to tracks first tagged in the chosen range", () => {
    expect(new Date(rangeStart("30d", NOW)!).getDate()).toBe(12);
    // The last 12 months reach back past New Year, to 12 October 2025.
    expect(new Date(rangeStart("12m", NOW)!)).toEqual(new Date(2025, 9, 12));
    const lastYear = library();
    lastYear.tracks["spotify:track:november"] = track({ tagIds: ["tag_calm"], dateCreated: at(11, 28, 2025), dateModified: at(11, 28, 2025) });
    const twelveMonths = computeLibraryStats(lastYear, "12m", NOW);
    expect(twelveMonths.overview.taggedTracks).toBe(5);
    expect(twelveMonths.activity.months[0].month).toBe("2025-10");
    expect(twelveMonths.activity.months.find((month) => month.month === "2025-11")?.count).toBe(1);
    // The last 30 days start on 12 September, so the chart shows both months, in full.
    expect(computeLibraryStats(library(), "30d", NOW).activity.months.map((month) => month.month)).toEqual(["2026-09", "2026-10"]);
    const stats = computeLibraryStats(library(), "30d", NOW);
    expect(stats.overview.tracks).toBe(3);
    expect(stats.overview.albums).toBe(1);
    expect(stats.overview.playlists).toBe(0);
    expect(stats.activity.days.length).toBe(computeLibraryStats(library(), "all", NOW).activity.days.length);
    expect(stats.activity.months).toEqual([{ month: "2026-09", count: 1 }, { month: "2026-10", count: 3 }]);
    expect(computeLibraryStats(library(), "12m", NOW).overview.tracks).toBe(5);
  });

  it("collects ratings, tag averages and tracks that need attention", () => {
    const { ratings } = computeLibraryStats(library(), "all", NOW);
    expect(ratings.distribution.find((entry) => entry.rating === 4.5)?.count).toBe(1);
    expect(ratings.tagAverages.map((entry) => [entry.tag.name, entry.average, entry.tracks])).toEqual([
      ["Calm", 4.5, 3], ["Night drive", (4.5 + 4 + 2) / 3, 3],
    ]);
    expect(ratings.taggedUnrated.sort()).toEqual(["spotify:track:4", "spotify:track:6"]);
    expect(ratings.ratedUntagged).toEqual(["spotify:track:5"]);
    expect(ratings.missingEnergy.sort()).toEqual(["spotify:local:Artist:Album:Song+Name:200", "spotify:track:3", "spotify:track:4"]);
  });

  it("summarizes artists, albums, tempo, energy and keys", () => {
    const { music } = computeLibraryStats(library(), "all", NOW);
    expect(music.artists.slice(0, 3)).toEqual([
      { name: "Kavinsky", tracks: 2, averageRating: 4.5 },
      { name: "M83", tracks: 2, averageRating: 4.25 },
      { name: "Slowdive", tracks: 1, averageRating: 5 },
    ]);
    expect(music.albums).toEqual([{ uri: "spotify:album:a", name: "Hurry Up", artists: "M83, Kavinsky", imageUrl: "https://i.scdn.co/a", tracks: 2 }]);
    expect(music.bpm.find((bucket) => bucket.label === "80–100")?.count).toBe(1);
    expect(music.bpm.find((bucket) => bucket.label === "125–128")?.count).toBe(1);
    expect(music.averageBpm).toBe(109);
    expect(music.keys.find((entry) => entry.key === "8A")?.count).toBe(2);
    expect(music.energy.find((entry) => entry.energy === 9)?.count).toBe(1);
  });

  it("describes one tag in depth", () => {
    const data = library();
    const stats = computeLibraryStats(data, "all", NOW);
    const detail = computeTagDetail(data, stats, "tag_night", NOW)!;
    expect(detail.tag.name).toBe("Night drive");
    expect(detail.averageRating).toBeCloseTo((4.5 + 4 + 2) / 3);
    expect(detail.companions).toEqual([{ tag: expect.objectContaining({ name: "Calm" }), tracks: 2, share: 2 / 3 }]);
    expect(detail.artists[0]).toEqual({ name: "M83", tracks: 2 });
    expect(detail.months.at(-1)).toEqual({ month: "2026-10", count: 2 });
    expect(detail.recent.map((item) => item.name)).toEqual(["One", "Unknown track", "Song Name"]);
    expect(detail.trackUris).toHaveLength(3);
    expect(computeTagDetail(data, stats, "tag_missing", NOW)).toBeNull();
  });

  it("formats local calendar days", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
  });

  it("lists the tracks behind any number, newest change first", () => {
    const data = library();
    const pick = (selection: Parameters<typeof selectStatsTracks>[3], range: Parameters<typeof selectStatsTracks>[1] = "all") => selectStatsTracks(data, range, NOW, selection);
    expect(pick({ kind: "taggedUnrated" })).toEqual(["spotify:track:4", "spotify:track:6"]);
    expect(pick({ kind: "ratedUntagged" })).toEqual(["spotify:track:5"]);
    expect(pick({ kind: "tag", tagId: "tag_night" })).toEqual(["spotify:track:1", "spotify:track:2", "spotify:local:Artist:Album:Song+Name:200"]);
    expect(pick({ kind: "pair", tagIds: ["tag_calm", "tag_night"] })).toEqual(["spotify:track:1", "spotify:track:2"]);
    expect(pick({ kind: "category", categoryId: "cat_place" })).toEqual(["spotify:track:1", "spotify:track:2", "spotify:local:Artist:Album:Song+Name:200"]);
    expect(pick({ kind: "rating", rating: 5 })).toEqual(["spotify:track:3"]);
    expect(pick({ kind: "energy", energy: 9 })).toEqual(["spotify:track:6"]);
    expect(pick({ kind: "bpm", label: "125–128" })).toEqual(["spotify:track:2"]);
    expect(pick({ kind: "key", key: "8A" })).toEqual(["spotify:track:1", "spotify:track:2"]);
    expect(pick({ kind: "artist", name: "Kavinsky" })).toEqual(["spotify:track:1", "spotify:track:4"]);
    expect(pick({ kind: "album", uri: "spotify:album:a" })).toEqual(["spotify:track:1", "spotify:track:2"]);
    expect(pick({ kind: "day", date: "2026-10-10" })).toEqual(["spotify:track:2"]);
    expect(pick({ kind: "month", month: "2026-10" }, "30d")).toEqual(["spotify:track:1", "spotify:track:2", "spotify:track:3"]);
    // Outside the range, a tag's older tracks are left out.
    expect(pick({ kind: "tag", tagId: "tag_loud" }, "30d")).toEqual([]);
  });

  describe("tracks dated when Tagify started keeping dates", () => {
    // Before the first release, every track already in a library got this exact moment when
    // dates were introduced.
    const STAMP = new Date(2024, 11, 1, 17, 35, 3).getTime();
    function stampedLibrary(count = 25, stamp = STAMP): TagDataStructure {
      const data = library();
      for (let index = 0; index < count; index += 1) {
        // The first ten were changed this year; the rest haven't been touched since.
        const changed = index < 10 ? at(3, index + 1) : stamp;
        data.tracks[`spotify:track:stamped${index}`] = track({ tagIds: ["tag_calm"], dateCreated: stamp, dateModified: changed });
      }
      return data;
    }

    it("count from their last change, or as tagged before dates were kept", () => {
      const data = stampedLibrary();
      const year = computeLibraryStats(data, "12m", NOW);
      // Five dated tracks this year plus the ten stamped tracks changed this year.
      expect(year.overview.tracks).toBe(15);
      // The fifteen untouched stamped tracks join the local file with no date at all.
      expect(year.undatedTracks).toBe(16);
      const all = computeLibraryStats(data, "all", NOW);
      expect(all.overview.tracks).toBe(32);
      expect(all.activity.busiestDay?.date).not.toBe(dayKey(STAMP));
      expect(all.activity.hours[17]).toBe(0);
      expect(selectStatsTracks(data, "all", NOW, { kind: "day", date: dayKey(STAMP) })).toEqual([]);
      expect(selectStatsTracks(data, "all", NOW, { kind: "month", month: "2026-03" })).toHaveLength(10);
      // Stored dates stay as they are.
      expect(data.tracks["spotify:track:stamped0"].dateCreated).toBe(STAMP);
    });

    it("only apply to libraries from before the first release; later batches are real bulk tagging", () => {
      // A new member's first action: bulk-tagging 25 tracks at once.
      const firstSession = new Date(2025, 9, 2, 20, 0).getTime();
      const data = library();
      delete data.tracks["spotify:track:6"];
      for (let index = 0; index < 25; index += 1) {
        data.tracks[`spotify:track:bulk${index}`] = track({ tagIds: ["tag_calm"], dateCreated: firstSession, dateModified: firstSession });
      }
      const all = computeLibraryStats(data, "all", NOW);
      expect(all.undatedTracks).toBe(1);
      expect(all.activity.busiestDay).toEqual({ date: dayKey(firstSession), count: 25 });
    });

    it("leave a small batch with the same date alone, since that's ordinary bulk tagging", () => {
      const data = stampedLibrary(19);
      expect(statsTrackEntries(data.tracks).find(([uri]) => uri === "spotify:track:stamped0")?.[1].dateCreated).toBe(STAMP);
      expect(computeLibraryStats(data, "all", NOW).activity.busiestDay?.date).toBe(dayKey(STAMP));
    });
  });

  describe("dates saved when Stats first opened", () => {
    it("count existing tracks by their last update then, and new tracks by when they're first tagged", () => {
      const data = library();
      // Track 6 was first tagged in January 2025 but last changed this February.
      data.tracks["spotify:track:6"] = { ...data.tracks["spotify:track:6"], dateModified: at(2, 1) };
      const baseline = createStatsBaseline(data.tracks, at(10, 1));
      expect(baseline.dates["spotify:track:6"]).toBe(at(2, 1));
      expect(baseline.dates["spotify:track:empty"]).toBeUndefined();

      // Later: track 6 is edited again, and track 7 is tagged for the first time.
      data.tracks["spotify:track:6"] = { ...data.tracks["spotify:track:6"], dateModified: at(10, 10) };
      data.tracks["spotify:track:7"] = track({ tagIds: ["tag_calm"], dateCreated: at(10, 5), dateModified: at(10, 9) });
      const year = computeLibraryStats(data, "12m", NOW, baseline);
      expect(year.overview.tracks).toBe(7);
      const month = selectStatsTracks(data, "all", NOW, { kind: "month", month: "2026-02" }, baseline);
      expect(month).toEqual(["spotify:track:6"]);
      expect(selectStatsTracks(data, "all", NOW, { kind: "day", date: dayKey(at(10, 5)) }, baseline)).toEqual(["spotify:track:7"]);
    });

    it("use the new first-tagged date for a track cleared and tagged again since", () => {
      const data = library();
      const baseline = createStatsBaseline(data.tracks, at(10, 1));
      data.tracks["spotify:track:6"] = { ...data.tracks["spotify:track:6"], dateCreated: at(10, 6), dateModified: at(10, 6) };
      expect(statsTrackEntries(data.tracks, baseline).find(([uri]) => uri === "spotify:track:6")?.[1].dateCreated).toBe(at(10, 6));
    });

    it("treat a saved date that is only the pre-release stamp as no date", () => {
      const STAMP = new Date(2024, 11, 1, 17, 35, 3).getTime();
      const data = library();
      for (let index = 0; index < 25; index += 1) {
        data.tracks[`spotify:track:stamped${index}`] = track({ tagIds: ["tag_calm"], dateCreated: STAMP, dateModified: index < 10 ? at(3, 1) : STAMP });
      }
      const baseline = createStatsBaseline(data.tracks, at(10, 1));
      const all = computeLibraryStats(data, "all", NOW, baseline);
      expect(all.undatedTracks).toBe(16);
      expect(computeLibraryStats(data, "12m", NOW, baseline).overview.tracks).toBe(15);
    });
  });
});
