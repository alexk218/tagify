import { describe, expect, it } from "vitest";
import { TagDataStructure, TrackData, TrackTag } from "@/types/tagData";
import {
  commitTrackMutation,
  createInitialTrackData,
  withRating,
  withTrackMetadata,
  withToggledTrackTag,
} from "../tagData.trackMutations";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";

const HOUSE_TAG: TrackTag = "tag_house";

describe("tagData.trackMutations", () => {
  it("toggles a tag on and then off", () => {
    const baseTrack: TrackData = {
      rating: 1,
      energy: 2,
      bpm: 123,
      tagIds: [],
      dateCreated: 10,
      dateModified: 10,
    };

    const withTag = withToggledTrackTag(baseTrack, HOUSE_TAG, 100);
    const withoutTag = withToggledTrackTag(withTag, HOUSE_TAG, 200);

    expect(withTag.tagIds).toEqual([HOUSE_TAG]);
    expect(withoutTag.tagIds).toEqual([]);
    expect(withoutTag.dateModified).toBe(200);
  });

  it("removes track from state when committed track is empty", () => {
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {
        "spotify:track:x": {
          rating: 0,
          energy: 0,
          bpm: null,
          tagIds: [HOUSE_TAG],
          dateCreated: 1,
          dateModified: 1,
        },
      },
      playlists: {},
      artists: {},
    };

    const emptiedTrack: TrackData = {
      ...currentData.tracks["spotify:track:x"],
      tagIds: [],
      dateModified: 2,
    };

    const { nextData, finalTrackData } = commitTrackMutation(
      currentData,
      "spotify:track:x",
      emptiedTrack,
    );

    expect(nextData.tracks["spotify:track:x"]).toBeUndefined();
    expect(finalTrackData).toBeNull();
  });

  it("preserves existing metadata when applying fallback metadata", () => {
    const track: TrackData = {
      rating: 1,
      energy: 1,
      bpm: 110,
      tagIds: [HOUSE_TAG],
      dateCreated: 1,
      dateModified: 2,
      name: "Existing Name",
      artists: "Existing Artist",
    };

    const updated = withTrackMetadata(
      track,
      { name: "New Name", artists: "New Artist" },
      999,
    );

    expect(updated.name).toBe("Existing Name");
    expect(updated.artists).toBe("Existing Artist");
    expect(updated.dateModified).toBe(999);
  });

  it("creates initial track data and updates rating timestamps", () => {
    const initial = createInitialTrackData(
      100,
      128,
      { name: "Track", artists: "Artist" },
    );
    const rated = withRating(initial, 5, 200);

    expect(initial).toEqual({
      rating: 0,
      energy: 0,
      bpm: 128,
      tagIds: [],
      dateCreated: 100,
      dateModified: 100,
      name: "Track",
      artists: "Artist",
    });
    expect(rated.rating).toBe(5);
    expect(rated.dateCreated).toBe(100);
    expect(rated.dateModified).toBe(200);
  });
});
