import { describe, expect, it } from "vitest";
import { PlaylistData, TagDataStructure } from "@/types/tagData";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import {
  commitPlaylistMutation,
  createInitialPlaylistData,
  withPlaylistEnergy,
  withPlaylistMetadata,
  withPlaylistRating,
  withToggledPlaylistTag,
} from "../tagData.playlistMutations";

describe("tagData.playlistMutations", () => {
  it("creates initial playlist data with cached metadata", () => {
    expect(
      createInitialPlaylistData(100, {
        name: "Warehouse",
        ownerName: "Alex",
        imageUrl: "https://example.com/image.jpg",
        description: "Set prep",
        trackCount: 40,
        snapshotId: "snapshot-1",
      }),
    ).toEqual({
      rating: 0,
      energy: 0,
      tagIds: [],
      dateCreated: 100,
      dateModified: 100,
      name: "Warehouse",
      ownerName: "Alex",
      imageUrl: "https://example.com/image.jpg",
      description: "Set prep",
      trackCount: 40,
      snapshotId: "snapshot-1",
    });
  });

  it("toggles playlist tags and removes empty playlist records on commit", () => {
    const playlist: PlaylistData = {
      rating: 0,
      energy: 0,
      tagIds: [],
      dateCreated: 1,
      dateModified: 1,
      name: "Club",
    };
    const withTag = withToggledPlaylistTag(playlist, "tag_house", 2);
    const withoutTag = withToggledPlaylistTag(withTag, "tag_house", 3);
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {},
      playlists: {
        "spotify:playlist:1": withTag,
      },
      artists: {},
    };

    const { nextData, finalPlaylistData } = commitPlaylistMutation(
      currentData,
      "spotify:playlist:1",
      withoutTag,
    );

    expect(withTag.tagIds).toEqual(["tag_house"]);
    expect(withoutTag.tagIds).toEqual([]);
    expect(nextData.playlists["spotify:playlist:1"]).toBeUndefined();
    expect(finalPlaylistData).toBeNull();
  });

  it("updates playlist rating and energy and keeps rated playlists without tags", () => {
    const playlist: PlaylistData = {
      rating: 0,
      energy: 0,
      tagIds: [],
      dateCreated: 1,
      dateModified: 1,
      name: "Club",
    };
    const rated = withPlaylistRating(playlist, 4, 2);
    const energized = withPlaylistEnergy(rated, 7, 3);
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {},
      playlists: {
        "spotify:playlist:1": rated,
      },
      artists: {},
    };

    const { nextData, finalPlaylistData } = commitPlaylistMutation(
      currentData,
      "spotify:playlist:1",
      energized,
    );

    expect(finalPlaylistData).toMatchObject({
      rating: 4,
      energy: 7,
      tagIds: [],
      dateModified: 3,
    });
    expect(nextData.playlists["spotify:playlist:1"]).toBe(finalPlaylistData);
  });

  it("updates cached metadata without clearing existing values or edit timestamps", () => {
    const playlist: PlaylistData = {
      rating: 0,
      energy: 0,
      tagIds: ["tag_house"],
      dateCreated: 1,
      dateModified: 1,
      name: "Existing",
      ownerName: "Owner",
      imageUrl: "image",
      description: "description",
      trackCount: 10,
      snapshotId: "old",
    };

    const updated = withPlaylistMetadata(
      playlist,
      {
        name: "Updated",
        ownerName: null,
        imageUrl: null,
        description: null,
        trackCount: null,
        snapshotId: "new",
      },
      5,
    );

    expect(updated).toMatchObject({
      name: "Updated",
      ownerName: "Owner",
      imageUrl: "image",
      description: "description",
      trackCount: 10,
      snapshotId: "new",
      dateModified: 1,
    });
  });
});
