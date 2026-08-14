import { describe, expect, it } from "vitest";
import { ArtistData, TagDataStructure } from "@/types/tagData";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import {
  commitArtistMutation,
  createInitialArtistData,
  withArtistEnergy,
  withArtistMetadata,
  withArtistRating,
  withToggledArtistTag,
} from "../tagData.artistMutations";

describe("tagData.artistMutations", () => {
  it("creates initial artist data with cached metadata", () => {
    expect(
      createInitialArtistData(100, {
        name: "DJ Example",
        imageUrl: "https://example.com/artist.jpg",
        followerCount: 1000,
        genres: ["techno"],
      }),
    ).toEqual({
      rating: 0,
      energy: 0,
      tagIds: [],
      dateCreated: 100,
      dateModified: 100,
      name: "DJ Example",
      imageUrl: "https://example.com/artist.jpg",
      followerCount: 1000,
      genres: ["techno"],
    });
  });

  it("toggles artist tags and removes empty artist records on commit", () => {
    const artist: ArtistData = {
      rating: 0,
      energy: 0,
      tagIds: [],
      dateCreated: 1,
      dateModified: 1,
      name: "Artist",
    };
    const withTag = withToggledArtistTag(artist, "tag_house", 2);
    const withoutTag = withToggledArtistTag(withTag, "tag_house", 3);
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {},
      playlists: {},
      artists: {
        "spotify:artist:1": withTag,
      },
    };

    const { nextData, finalArtistData } = commitArtistMutation(
      currentData,
      "spotify:artist:1",
      withoutTag,
    );

    expect(withTag.tagIds).toEqual(["tag_house"]);
    expect(withoutTag.tagIds).toEqual([]);
    expect(nextData.artists["spotify:artist:1"]).toBeUndefined();
    expect(finalArtistData).toBeNull();
  });

  it("updates artist rating and energy and keeps rated artists without tags", () => {
    const artist: ArtistData = {
      rating: 0,
      energy: 0,
      tagIds: [],
      dateCreated: 1,
      dateModified: 1,
      name: "Artist",
    };
    const rated = withArtistRating(artist, 4, 2);
    const energized = withArtistEnergy(rated, 7, 3);
    const currentData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: createEmptyTaxonomy(),
      tracks: {},
      playlists: {},
      artists: {
        "spotify:artist:1": rated,
      },
    };

    const { nextData, finalArtistData } = commitArtistMutation(
      currentData,
      "spotify:artist:1",
      energized,
    );

    expect(finalArtistData).toMatchObject({
      rating: 4,
      energy: 7,
      tagIds: [],
      dateModified: 3,
    });
    expect(nextData.artists["spotify:artist:1"]).toBe(finalArtistData);
  });

  it("updates cached metadata without clearing existing values or edit timestamps", () => {
    const artist: ArtistData = {
      rating: 0,
      energy: 0,
      tagIds: ["tag_house"],
      dateCreated: 1,
      dateModified: 1,
      name: "Existing",
      imageUrl: "image",
      followerCount: 100,
      genres: ["house"],
    };

    const updated = withArtistMetadata(
      artist,
      {
        name: "Updated",
        imageUrl: null,
        followerCount: null,
        genres: [],
      },
      5,
    );

    expect(updated).toMatchObject({
      name: "Updated",
      imageUrl: "image",
      followerCount: 100,
      genres: ["house"],
      dateModified: 1,
    });
  });
});
