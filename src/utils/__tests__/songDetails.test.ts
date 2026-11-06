// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { filterTrackEntries, buildSmartPlaylistCriteria } from "@/features/track-session/utils/trackList.logic";
import type { TrackListEntry, TrackListFilterInputs } from "@/features/track-session/model/trackList.types";
import { normalizeSmartPlaylistCriteriaList, normalizeTagDataStructure } from "@/features/tag-data/utils/tagData.schema";
import { createSmartPlaylistRecipeBundle, isSmartPlaylistRecipeBundle } from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import { formatLength, matchesSongDetailFilters, releaseDate, songDetailFilterLabels } from "@/utils/songDetails";

const entry = (uri: string, durationMs?: number, date?: string): TrackListEntry =>
  [uri, { rating: 0, energy: 0, bpm: null, tagIds: ["tag_a"], name: uri, artists: "x", ...(durationMs ? { durationMs } : {}), ...(date ? { releaseDate: date } : {}) }];
const entries = [
  entry("spotify:track:short", 150_000, "1995-06-01"),
  entry("spotify:track:mid", 240_900, "2008"),
  entry("spotify:track:long", 420_000, "2023-01"),
  entry("spotify:track:unknown"),
];
const info = Object.fromEntries(entries.map(([uri]) => [uri, { name: uri, artists: "x" }]));
const base: TrackListFilterInputs = {
  includeTagClauses: [], clauseConnectors: [], ratingFilters: [], energyMinFilter: null, energyMaxFilter: null,
  bpmMinFilter: null, bpmMaxFilter: null, normalizedCamelotKeyFilters: [], searchTerm: "",
};
const uris = (filters: Partial<TrackListFilterInputs>) => filterTrackEntries(entries, info, { ...base, ...filters }).map(([uri]) => uri);

describe("length and release year filters", () => {
  it("keeps every song when no length or year filter is set", () => {
    expect(uris({})).toHaveLength(4);
  });

  it("filters by length, including the whole last second of the upper bound", () => {
    expect(uris({ lengthMaxFilter: 240 })).toEqual(["spotify:track:short", "spotify:track:mid"]);
    expect(uris({ lengthMinFilter: 180 })).toEqual(["spotify:track:mid", "spotify:track:long"]);
    expect(uris({ lengthMinFilter: 180, lengthMaxFilter: 300 })).toEqual(["spotify:track:mid"]);
  });

  it("filters by release year at any date precision", () => {
    expect(uris({ releaseYearMinFilter: 2000 })).toEqual(["spotify:track:mid", "spotify:track:long"]);
    expect(uris({ releaseYearMinFilter: 1990, releaseYearMaxFilter: 1999 })).toEqual(["spotify:track:short"]);
  });

  it("leaves out songs whose details aren't known yet only when that filter is in use", () => {
    expect(matchesSongDetailFilters({}, {})).toBe(true);
    expect(matchesSongDetailFilters({}, { lengthMaxFilter: 600 })).toBe(false);
    expect(matchesSongDetailFilters({ durationMs: 100_000 }, { releaseYearMinFilter: 1900 })).toBe(false);
  });

  it("reads Spotify release dates and describes filters in plain words", () => {
    expect(releaseDate({ isoString: "2019-05-03T00:00:00Z", precision: "DAY" })).toBe("2019-05-03");
    expect(releaseDate({ isoString: "2019-01-01T00:00:00Z" })).toBe("2019");
    expect(releaseDate(undefined)).toBeNull();
    expect(formatLength(185)).toBe("3:05");
    expect(songDetailFilterLabels({ lengthMinFilter: 180, lengthMaxFilter: 300, releaseYearMinFilter: 1990, releaseYearMaxFilter: 1999 }))
      .toEqual(["Length 3:00–5:00", "Released 1990–1999"]);
    expect(songDetailFilterLabels({ lengthMaxFilter: 240, releaseYearMinFilter: 2020 })).toEqual(["Length up to 4:00", "Released 2020 or later"]);
    expect(songDetailFilterLabels({ lengthMinFilter: 180, releaseYearMaxFilter: 1999 })).toEqual(["Length 3:00 or longer", "Released 1999 or earlier"]);
  });
});

describe("saving length and release year filters", () => {
  const playlist = (extra: Partial<SmartPlaylistCriteria["criteria"]>): SmartPlaylistCriteria => buildSmartPlaylistCriteria({
    playlistId: "p", playlistName: "Short nineties", trackUris: [], includeTagClauses: [{ tagIds: [Object.keys(defaultTagData.taxonomy.tagsById)[0]], excludedTagIds: [], operator: "OR" }],
    clauseConnectors: [], ratingFilters: [], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null,
    normalizedCamelotKeyFilters: [], ...extra,
  });

  it("stores only the filters in use, so playlists without them keep their saved shape", () => {
    expect(Object.keys(playlist({}).criteria)).not.toContain("lengthMinFilter");
    expect(playlist({ lengthMaxFilter: 240, releaseYearMinFilter: null }).criteria).toMatchObject({ lengthMaxFilter: 240 });
    expect(playlist({ lengthMaxFilter: 240, releaseYearMinFilter: null }).criteria).not.toHaveProperty("releaseYearMinFilter");
  });

  it("keeps the filters through saving and reloading, and drops impossible values", () => {
    const [saved] = normalizeSmartPlaylistCriteriaList([playlist({ lengthMinFilter: 120, lengthMaxFilter: 240, releaseYearMinFilter: 1990, releaseYearMaxFilter: 1999 })]);
    expect(saved.criteria).toMatchObject({ lengthMinFilter: 120, lengthMaxFilter: 240, releaseYearMinFilter: 1990, releaseYearMaxFilter: 1999 });
    const [damaged] = normalizeSmartPlaylistCriteriaList([{ ...saved, criteria: { ...saved.criteria, lengthMinFilter: "long", releaseYearMaxFilter: 99_999 } }]);
    expect(damaged.criteria).not.toHaveProperty("lengthMinFilter");
    expect(damaged.criteria).not.toHaveProperty("releaseYearMaxFilter");
    expect(damaged.criteria).toMatchObject({ lengthMaxFilter: 240, releaseYearMinFilter: 1990 });
  });

  it("keeps song lengths and release dates on saved songs", () => {
    const data = normalizeTagDataStructure({ ...JSON.parse(JSON.stringify(defaultTagData)), schemaVersion: TAG_DATA_SCHEMA_VERSION, tracks: {
      "spotify:track:a": { rating: 0, energy: 0, bpm: null, tagIds: [], durationMs: 185_000, releaseDate: "1999-04", songDetailsAttempts: 1, songDetailsCheckedAt: 1_700_000_000_000 },
      "spotify:track:b": { rating: 0, energy: 0, bpm: null, tagIds: [], durationMs: -5, releaseDate: "April" },
    } });
    expect(data.tracks["spotify:track:a"]).toMatchObject({ durationMs: 185_000, releaseDate: "1999-04", songDetailsAttempts: 1, songDetailsCheckedAt: 1_700_000_000_000 });
    expect(data.tracks["spotify:track:b"]).not.toHaveProperty("durationMs");
    expect(data.tracks["spotify:track:b"]).not.toHaveProperty("releaseDate");
  });

  it("shares the filters with other people", async () => {
    const shared = { ...playlist({ lengthMaxFilter: 240, releaseYearMinFilter: 1990, releaseYearMaxFilter: 1999 }), id: "s" };
    const bundle = await createSmartPlaylistRecipeBundle([shared], defaultTagData.taxonomy, new Date("2026-11-03T00:00:00Z"));
    expect(isSmartPlaylistRecipeBundle(bundle)).toBe(true);
    expect(bundle.recipes[0].criteria).toMatchObject({ lengthMaxFilter: 240, releaseYearMinFilter: 1990, releaseYearMaxFilter: 1999 });
    const reversed = JSON.parse(JSON.stringify(bundle));
    reversed.recipes[0].criteria.releaseYearMinFilter = 2005;
    expect(isSmartPlaylistRecipeBundle(reversed)).toBe(false);
  });
});
