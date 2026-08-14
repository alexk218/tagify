import { describe, expect, it } from "vitest";
import { TagDataStructure } from "@/types/tagData";
import { buildExportData } from "../tagData.export";
import {
  buildTaxonomyFromCategoryTree,
  createLegacyTagIdentityId,
  TAG_DATA_SCHEMA_VERSION,
} from "@/utils/tagTaxonomy";

describe("buildExportData", () => {
  it("exports non-empty tracks and computes tag analytics", () => {
    const categories = [
      {
        id: "genre",
        name: "Genre",
        subcategories: [
          {
            id: "electronic",
            name: "Electronic",
            tags: [
              { id: "house", name: "House" },
              { id: "techno", name: "Techno" },
              { id: "trance", name: "Trance" },
            ],
          },
        ],
      },
    ];
    const houseTagId = createLegacyTagIdentityId("genre", "electronic", "house");
    const technoTagId = createLegacyTagIdentityId("genre", "electronic", "techno");

    const tagData: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: buildTaxonomyFromCategoryTree(categories),
      tracks: {
        "spotify:track:1": {
          rating: 5,
          energy: 8,
          bpm: 126,
          tagIds: [houseTagId],
        },
        "spotify:track:2": {
          rating: 0,
          energy: 0,
          bpm: null,
          tagIds: [houseTagId, technoTagId],
        },
        "spotify:track:3": {
          rating: 0,
          energy: 0,
          bpm: null,
          tagIds: [],
        },
      },
      playlists: {
        "spotify:playlist:1": {
          rating: 3,
          energy: 6,
          name: "Warehouse",
          ownerName: "Alex",
          imageUrl: null,
          description: "Set prep",
          trackCount: 20,
          snapshotId: "snapshot-1",
          tagIds: [technoTagId],
        },
      },
      artists: {
        "spotify:artist:1": {
          rating: 4,
          energy: 7,
          name: "DJ Example",
          imageUrl: null,
          followerCount: 1000,
          genres: ["techno"],
          tagIds: [technoTagId],
        },
      },
    };

    const result = buildExportData(tagData);

    expect(Object.keys(result.tracks)).toEqual([
      "spotify:track:1",
      "spotify:track:2",
    ]);
    expect(result.playlists["spotify:playlist:1"]).toMatchObject({
      rating: 3,
      energy: 6,
      name: "Warehouse",
      owner_name: "Alex",
      track_count: 20,
      snapshot_id: "snapshot-1",
    });
    expect(result.playlists["spotify:playlist:1"].tags[0].name).toBe("Techno");
    expect(result.artists["spotify:artist:1"]).toMatchObject({
      rating: 4,
      energy: 7,
      name: "DJ Example",
      follower_count: 1000,
      genres: ["techno"],
    });
    expect(result.artists["spotify:artist:1"].tags[0].name).toBe("Techno");
    expect(result.tracks["spotify:track:1"].rekordbox_comment).toContain(
      "BPM 126",
    );
    expect(result.tracks["spotify:track:1"].rekordbox_comment).toContain(
      "Energy 8",
    );
    expect(result.tracks["spotify:track:1"].rekordbox_comment).toContain(
      "House",
    );

    expect(result.tag_analytics.total_tags).toBe(3);
    expect(result.tag_analytics.used_tags).toBe(2);
    expect(result.tag_analytics.unused_tags).toBe(1);
    expect(result.tag_analytics.tag_usage_summary.usage_percentage).toBe(67);
    expect(result.tag_analytics.tag_usage_summary.unused_tag_names).toEqual([
      "Trance",
    ]);
    expect(result.tag_analytics.tag_usage_summary.most_used_tags[0]).toEqual({
      name: "Techno",
      usage_count: 3,
    });
  });
});
