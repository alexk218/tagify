import { describe, expect, it } from "vitest";
import { TagDataStructure, TrackTag } from "@/types/tagData";
import { applyBatchTagUpdatesToData } from "../tagData.batchUpdates";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";

const HOUSE_TAG: TrackTag = "tag_house";
const TECHNO_TAG: TrackTag = "tag_techno";

describe("applyBatchTagUpdatesToData", () => {
  it("creates a missing track and applies initial rating + tags", () => {
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {},
      playlists: {},
      artists: {},
    };

    const now = 1_700_000_000_000;
    const { nextData, finalTrackDataMap } = applyBatchTagUpdatesToData(
      currentData,
      [
        {
          trackUri: "spotify:track:new123",
          toAdd: [HOUSE_TAG],
          toRemove: [],
          newRating: 4,
        },
      ],
      now,
    );

    expect(nextData.tracks["spotify:track:new123"]).toEqual({
      rating: 4,
      energy: 0,
      bpm: null,
      tagIds: [HOUSE_TAG],
      dateCreated: now,
      dateModified: now,
    });
    expect(finalTrackDataMap["spotify:track:new123"]).toEqual(
      nextData.tracks["spotify:track:new123"],
    );
  });

  it("applies add/remove changes without duplicating tags", () => {
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {
        "spotify:track:existing": {
          rating: 2,
          energy: 3,
          bpm: 124,
          tagIds: [HOUSE_TAG, TECHNO_TAG],
          dateCreated: 100,
          dateModified: 100,
        },
      },
      playlists: {},
      artists: {},
    };

    const now = 200;
    const { nextData } = applyBatchTagUpdatesToData(
      currentData,
      [
        {
          trackUri: "spotify:track:existing",
          toAdd: [HOUSE_TAG],
          toRemove: [TECHNO_TAG],
          newEnergy: 7,
        },
      ],
      now,
    );

    expect(nextData.tracks["spotify:track:existing"].tagIds).toEqual([HOUSE_TAG]);
    expect(nextData.tracks["spotify:track:existing"].energy).toBe(7);
    expect(nextData.tracks["spotify:track:existing"].rating).toBe(2);
    expect(nextData.tracks["spotify:track:existing"].dateCreated).toBe(100);
    expect(nextData.tracks["spotify:track:existing"].dateModified).toBe(now);
  });

  it("removes the track when result becomes empty", () => {
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {
        "spotify:track:to-delete": {
          rating: 0,
          energy: 0,
          bpm: null,
          tagIds: [HOUSE_TAG],
          dateCreated: 50,
          dateModified: 60,
        },
      },
      playlists: {},
      artists: {},
    };

    const { nextData, finalTrackDataMap } = applyBatchTagUpdatesToData(
      currentData,
      [
        {
          trackUri: "spotify:track:to-delete",
          toAdd: [],
          toRemove: [HOUSE_TAG],
        },
      ],
      999,
    );

    expect(nextData.tracks["spotify:track:to-delete"]).toBeUndefined();
    expect(finalTrackDataMap["spotify:track:to-delete"]).toBeNull();
  });
});
