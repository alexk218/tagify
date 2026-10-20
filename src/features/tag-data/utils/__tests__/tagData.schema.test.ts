// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  normalizeFilterState,
  normalizeSmartPlaylistCriteriaList,
  normalizeTagDataStructure,
} from "../tagData.schema";
import {
  createLegacyTagIdentityId,
  TAG_DATA_SCHEMA_VERSION,
} from "@/utils/tagTaxonomy";

describe("normalizeTagDataStructure", () => {
  it("defaults missing accent metadata to null on current taxonomy data", () => {
    const result = normalizeTagDataStructure({
      schemaVersion: 2,
      taxonomy: {
        categoryOrder: ["cat_genre"],
        customAccentsById: {},
        categoriesById: {
          cat_genre: {
            id: "cat_genre",
            name: "Genre",
            subcategoryIds: ["sub_electronic"],
          },
        },
        subcategoriesById: {
          sub_electronic: {
            id: "sub_electronic",
            name: "Electronic",
            categoryId: "cat_genre",
            tagIds: ["tag_house"],
          },
        },
        tagsById: {
          tag_house: {
            id: "tag_house",
            name: "House",
            subcategoryId: "sub_electronic",
          },
        },
      },
      tracks: {},
      playlists: {},
      artists: {},
    });

    expect(result.schemaVersion).toBe(TAG_DATA_SCHEMA_VERSION);
    expect(result.taxonomy.tagsById.tag_house.accentId).toBeNull();
  });

  it("preserves valid accent metadata and normalizes invalid accent values to null", () => {
    const result = normalizeTagDataStructure({
      schemaVersion: 2,
      taxonomy: {
        categoryOrder: ["cat_genre"],
        customAccentsById: {},
        categoriesById: {
          cat_genre: {
            id: "cat_genre",
            name: "Genre",
            subcategoryIds: ["sub_electronic"],
          },
        },
        subcategoriesById: {
          sub_electronic: {
            id: "sub_electronic",
            name: "Electronic",
            categoryId: "cat_genre",
            tagIds: ["tag_house", "tag_peak"],
          },
        },
        tagsById: {
          tag_house: {
            id: "tag_house",
            name: "House",
            subcategoryId: "sub_electronic",
            accentId: "blue",
          },
          tag_peak: {
            id: "tag_peak",
            name: "Peak",
            subcategoryId: "sub_electronic",
            accentId: "magenta",
          },
        },
      },
      tracks: {},
      playlists: {},
      artists: {},
    });

    expect(result.taxonomy.tagsById.tag_house.accentId).toBe("blue");
    expect(result.taxonomy.colorThemesById["theme:default"]).toBeUndefined();
    expect(result.taxonomy.tagsById.tag_peak.accentId).toBeNull();
  });

  it("preserves saved custom accent definitions and removes orphaned custom accent ids", () => {
    const result = normalizeTagDataStructure({
      schemaVersion: 3,
      taxonomy: {
        categoryOrder: ["cat_genre"],
        customAccentsById: {
          "custom:lilac": {
            id: "custom:lilac",
            name: "Lilac",
            color: "#c084fc",
          },
        },
        categoriesById: {
          cat_genre: {
            id: "cat_genre",
            name: "Genre",
            subcategoryIds: ["sub_electronic"],
          },
        },
        subcategoriesById: {
          sub_electronic: {
            id: "sub_electronic",
            name: "Electronic",
            categoryId: "cat_genre",
            tagIds: ["tag_house", "tag_peak"],
          },
        },
        tagsById: {
          tag_house: {
            id: "tag_house",
            name: "House",
            subcategoryId: "sub_electronic",
            accentId: "custom:lilac",
          },
          tag_peak: {
            id: "tag_peak",
            name: "Peak",
            subcategoryId: "sub_electronic",
            accentId: "custom:missing",
          },
        },
      },
      tracks: {},
      playlists: {},
      artists: {},
    });

    expect(result.taxonomy.customAccentsById["custom:lilac"]).toEqual({
      id: "custom:lilac",
      name: "Lilac",
      color: "#c084fc",
      themeId: null,
    });
    expect(result.taxonomy.tagsById.tag_house.accentId).toBe("custom:lilac");
    expect(result.taxonomy.tagsById.tag_peak.accentId).toBeNull();
  });

  it("assigns null accent metadata when migrating legacy category trees", () => {
    const result = normalizeTagDataStructure({
      categories: [
        {
          id: "genre",
          name: "Genre",
          subcategories: [
            {
              id: "electronic",
              name: "Electronic",
              tags: [{ id: "house", name: "House" }],
            },
          ],
        },
      ],
      tracks: {},
    });

    const migratedTag = Object.values(result.taxonomy.tagsById)[0];
    expect(migratedTag.accentId).toBeNull();
    expect(result.playlists).toEqual({});
    expect(result.artists).toEqual({});
  });

  it("normalizes playlist tags and cached metadata", () => {
    const result = normalizeTagDataStructure({
      schemaVersion: 4,
      taxonomy: {
        categoryOrder: ["cat_genre"],
        customAccentsById: {},
        categoriesById: {
          cat_genre: {
            id: "cat_genre",
            name: "Genre",
            subcategoryIds: ["sub_electronic"],
          },
        },
        subcategoriesById: {
          sub_electronic: {
            id: "sub_electronic",
            name: "Electronic",
            categoryId: "cat_genre",
            tagIds: ["tag_house"],
          },
        },
        tagsById: {
          tag_house: {
            id: "tag_house",
            name: "House",
            subcategoryId: "sub_electronic",
          },
        },
      },
      tracks: {},
      playlists: {
        "spotify:playlist:1": {
          rating: 4,
          energy: 7,
          tagIds: ["tag_house", "tag_house", ""],
          dateCreated: 1,
          dateModified: 2,
          name: "Club",
          ownerName: "Alex",
          imageUrl: null,
          description: "Set prep",
          trackCount: 42,
          snapshotId: "abc",
        },
      },
      artists: {
        "spotify:artist:1": {
          rating: 5,
          energy: 8,
          tagIds: ["tag_house", "tag_house", ""],
          dateCreated: 3,
          dateModified: 4,
          name: "Artist",
          imageUrl: null,
          followerCount: 1000,
          genres: ["house", 1],
        },
      },
    });

    expect(result.playlists["spotify:playlist:1"]).toEqual({
      rating: 4,
      energy: 7,
      tagIds: ["tag_house"],
      dateCreated: 1,
      dateModified: 2,
      name: "Club",
      ownerName: "Alex",
      imageUrl: null,
      description: "Set prep",
      trackCount: 42,
      snapshotId: "abc",
    });
    expect(result.artists["spotify:artist:1"]).toEqual({
      rating: 5,
      energy: 8,
      tagIds: ["tag_house"],
      dateCreated: 3,
      dateModified: 4,
      name: "Artist",
      imageUrl: null,
      followerCount: 1000,
      genres: ["house"],
    });
  });
});

describe("normalizeFilterState", () => {
  it("migrates legacy AND filters into a single AND clause", () => {
    expect(
      normalizeFilterState({
        activeTagFilters: ["genre:electronic:house", "mood:energy:peak"],
        excludedTagFilters: ["mood:energy:chill"],
        isOrFilterMode: false,
      }),
    ).toEqual({
      includeTagClauses: [
        {
          tagIds: [
            createLegacyTagIdentityId("genre", "electronic", "house"),
            createLegacyTagIdentityId("mood", "energy", "peak"),
          ],
          excludedTagIds: [],
          operator: "AND",
        },
        {
          tagIds: [],
          excludedTagIds: [createLegacyTagIdentityId("mood", "energy", "chill")],
          operator: "OR",
        },
      ],
      clauseConnectors: ["AND"],
    });
  });
});

describe("normalizeSmartPlaylistCriteriaList", () => {
  it("migrates legacy OR criteria into a single OR clause", () => {
    const normalized = normalizeSmartPlaylistCriteriaList([
      {
        id: "smart-playlist:playlist-1:1",
        playlistId: "playlist-1",
        playlistName: "Legacy OR",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
        lastSyncAt: 1,
        smartPlaylistTrackUris: [],
        criteria: {
          activeTagFilters: [
            "genre:electronic:house",
            "mood:energy:peak",
          ],
          excludedTagFilters: ["mood:energy:chill"],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          isOrFilterMode: true,
        },
      },
    ]);

    expect(normalized).toEqual([
      {
        id: "smart-playlist:playlist-1:1",
        playlistId: "playlist-1",
        playlistName: "Legacy OR",
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
        lastSyncAt: 1,
        smartPlaylistTrackUris: [],
        criteria: {
          includeTagClauses: [
            {
              tagIds: [
                createLegacyTagIdentityId("genre", "electronic", "house"),
                createLegacyTagIdentityId("mood", "energy", "peak"),
              ],
              excludedTagIds: [],
              operator: "OR",
            },
            {
              tagIds: [],
              excludedTagIds: [
                createLegacyTagIdentityId("mood", "energy", "chill"),
              ],
              operator: "OR",
            },
          ],
          clauseConnectors: ["AND"],
          ratingFilters: [],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
          camelotKeyFilters: [],
          camelotMinFilter: null,
          camelotMaxFilter: null,
        },
      },
    ]);
  });
});

describe("details saved by a newer Tagify", () => {
  it("keeps fields this version doesn't know while still checking the ones it does", () => {
    const result = normalizeTagDataStructure({
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: { categoryOrder: [], categoriesById: {}, subcategoriesById: {}, tagsById: {}, customAccentsById: {} },
      tracks: {
        "spotify:track:1": {
          uri: "spotify:track:other", rating: "5", energy: 4, bpm: 120, tagIds: ["a", "a"], dateModified: 77,
          recordingGroupId: "group-without-identity", tags: [{ categoryId: "c", subcategoryId: "s", tagId: "t" }],
          mood: "calm", lyricsSync: { offsetMs: 120 },
        },
      },
      playlists: { "spotify:playlist:1": { rating: 3, energy: 0, tagIds: [], coverColor: "#123456" } },
      artists: { "spotify:artist:1": { rating: 2, energy: 0, tagIds: [], hometown: "Leeds" } },
      smartPlaylists: [{
        id: "smart-1", playlistId: "p1", playlistName: "Calm", isActive: true, createdAt: 1, lastSyncAt: 0,
        smartPlaylistTrackUris: [], sortOrder: "energy",
        source: { recipeId: "r1", revision: 2, channel: "beta" },
        criteria: {
          includeTagClauses: [], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null,
          bpmMinFilter: null, bpmMaxFilter: null, durationMaxFilter: 300, activeTagFilters: ["legacy"],
        },
      }],
    });

    expect(result.tracks["spotify:track:1"]).toEqual({
      rating: 0, energy: 4, bpm: 120, tagIds: ["a"], dateModified: 77, mood: "calm", lyricsSync: { offsetMs: 120 },
    });
    expect(result.playlists["spotify:playlist:1"]).toMatchObject({ coverColor: "#123456" });
    expect(result.artists["spotify:artist:1"]).toMatchObject({ hometown: "Leeds" });
    expect(result.smartPlaylists?.[0]).toMatchObject({
      sortOrder: "energy",
      source: { recipeId: "r1", revision: 2, channel: "beta" },
      criteria: { durationMaxFilter: 300, ratingFilters: [5] },
    });
    expect(result.smartPlaylists?.[0].criteria).not.toHaveProperty("activeTagFilters");
  });
});
