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

  it("leaves tracks the update would not change untouched", () => {
    const existing = {
      rating: 4,
      energy: 6,
      bpm: 120,
      tagIds: [HOUSE_TAG],
      dateCreated: 10,
      dateModified: 20,
    };
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: { "spotify:track:unchanged": existing },
      playlists: {},
      artists: {},
    };

    const { nextData, finalTrackDataMap } = applyBatchTagUpdatesToData(
      currentData,
      [
        {
          trackUri: "spotify:track:unchanged",
          toAdd: [HOUSE_TAG],
          toRemove: [TECHNO_TAG],
          newRating: 4,
          newEnergy: 6,
        },
        { trackUri: "spotify:track:missing", toAdd: [], toRemove: [] },
      ],
      999,
    );

    expect(nextData.tracks["spotify:track:unchanged"]).toBe(existing);
    expect(nextData.tracks["spotify:track:missing"]).toBeUndefined();
    expect(finalTrackDataMap).toEqual({});
  });

  it("fills in missing album details without mixing up albums", () => {
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {
        "spotify:track:other-album": {
          rating: 3,
          energy: 0,
          bpm: null,
          tagIds: [],
          albumUri: "spotify:album:original",
          dateCreated: 10,
          dateModified: 20,
        },
        "spotify:track:same-album": {
          rating: 3,
          energy: 0,
          bpm: null,
          tagIds: [],
          albumUri: "spotify:album:glass",
          albumName: "Glass Horizons (Deluxe)",
          dateCreated: 10,
          dateModified: 20,
        },
      },
      playlists: {},
      artists: {},
    };
    const albumDetails = {
      albumUri: "spotify:album:glass",
      albumName: "Glass Horizons",
      albumImageUrl: "https://example.com/cover.jpg",
    };

    const { nextData } = applyBatchTagUpdatesToData(
      currentData,
      ["other-album", "same-album", "new"].map((id) => ({
        trackUri: `spotify:track:${id}`,
        toAdd: [HOUSE_TAG],
        toRemove: [],
        albumDetails,
      })),
      500,
    );

    expect(nextData.tracks["spotify:track:other-album"]).toMatchObject({
      albumUri: "spotify:album:original",
      dateModified: 500,
    });
    expect(nextData.tracks["spotify:track:other-album"].albumImageUrl).toBeUndefined();
    expect(nextData.tracks["spotify:track:same-album"]).toMatchObject({
      albumName: "Glass Horizons (Deluxe)",
      albumImageUrl: "https://example.com/cover.jpg",
    });
    expect(nextData.tracks["spotify:track:new"]).toMatchObject(albumDetails);
  });
});
