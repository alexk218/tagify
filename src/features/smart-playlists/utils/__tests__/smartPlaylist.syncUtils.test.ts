import { describe, expect, it } from "vitest";
import {
  applySmartPlaylistCriteriaToTrack,
  collectMatchingTrackUris,
  findDuplicateTrackUris,
} from "@/features/smart-playlists/utils/smartPlaylist.syncUtils";
import { TagDataStructure } from "@/types/tagData";

describe("smartPlaylist.syncUtils", () => {
  it("applies mutable criteria while preserving factual audio metadata", () => {
    const original = {
      rating: 1,
      energy: 9,
      bpm: 91,
      camelotKey: "4A",
      tagIds: ["unrelated", "excluded"],
      dateCreated: 10,
      dateModified: 20,
    };

    const updated = applySmartPlaylistCriteriaToTrack(
      original,
      {
        includeTagClauses: [
          {
            tagIds: ["house", "vocal"],
            excludedTagIds: ["excluded"],
            operator: "OR",
          },
        ],
        clauseConnectors: [],
        ratingFilters: [3, 5],
        energyMinFilter: 4,
        energyMaxFilter: 7,
        bpmMinFilter: 120,
        bpmMaxFilter: 130,
        camelotKeyFilters: ["8B"],
      },
      100,
    );

    expect(updated).toEqual({
      ...original,
      rating: 3,
      energy: 7,
      tagIds: ["unrelated", "excluded"],
      dateModified: 100,
    });
  });

  it("preserves allowed scalar values and breaks equidistant rating ties lower", () => {
    const allowed = applySmartPlaylistCriteriaToTrack(
      { rating: 5, energy: 5, bpm: null, tagIds: [] },
      {
        includeTagClauses: [],
        clauseConnectors: [],
        ratingFilters: [3, 5],
        energyMinFilter: 3,
        energyMaxFilter: 7,
        bpmMinFilter: null,
        bpmMaxFilter: null,
      },
      100,
    );
    expect(allowed.rating).toBe(5);
    expect(allowed.energy).toBe(5);

    const tied = applySmartPlaylistCriteriaToTrack(
      { rating: 4, energy: 0, bpm: null, tagIds: [] },
      {
        includeTagClauses: [],
        clauseConnectors: [],
        ratingFilters: [3, 5],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
      },
      100,
    );
    expect(tied.rating).toBe(3);
  });
  it("finds duplicate URIs and occurrences", () => {
    const { occurrences, duplicateUris } = findDuplicateTrackUris([
      "spotify:track:1",
      "spotify:track:2",
      "spotify:track:1",
      "spotify:track:3",
      "spotify:track:2",
      "spotify:track:2",
    ]);

    expect(duplicateUris.has("spotify:track:1")).toBe(true);
    expect(duplicateUris.has("spotify:track:2")).toBe(true);
    expect(duplicateUris.has("spotify:track:3")).toBe(false);
    expect(occurrences.get("spotify:track:1")).toBe(2);
    expect(occurrences.get("spotify:track:2")).toBe(3);
  });

  it("collects matching track URIs from criteria", () => {
    const trackData: TagDataStructure["tracks"] = {
      "spotify:track:house": {
        rating: 5,
        energy: 8,
        bpm: 126,
        tagIds: ["tag_house"],
      },
      "spotify:track:other": {
        rating: 2,
        energy: 2,
        bpm: 90,
        tagIds: ["tag_alt"],
      },
    };

    const matches = collectMatchingTrackUris(trackData, {
      includeTagClauses: [
        {
          tagIds: ["tag_house"],
          excludedTagIds: [],
          operator: "AND",
        },
      ],
      clauseConnectors: [],
      ratingFilters: [5],
      energyMinFilter: 6,
      energyMaxFilter: null,
      bpmMinFilter: 120,
      bpmMaxFilter: 130,
    });

    expect(matches).toEqual(["spotify:track:house"]);
  });

});
