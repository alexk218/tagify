import { describe, expect, it } from "vitest";
import { TagTaxonomy, TrackData } from "@/types/tagData";
import {
  buildAlbumTrackSummaries,
  formatTrackAverage,
  getAlbumProgress,
} from "../albumTrackSummary";

const taxonomy: TagTaxonomy = {
  categoryOrder: ["genre"],
  categoriesById: {
    genre: { id: "genre", name: "Genre", subcategoryIds: ["style"] },
  },
  subcategoriesById: {
    style: {
      id: "style",
      name: "Style",
      categoryId: "genre",
      tagIds: ["ambient", "house", "techno"],
    },
  },
  tagsById: {
    ambient: { id: "ambient", name: "Ambient", subcategoryId: "style" },
    house: { id: "house", name: "House", subcategoryId: "style" },
    techno: { id: "techno", name: "Techno", subcategoryId: "style" },
  },
  customAccentsById: {},
  colorThemesById: {},
  ungroupedColorIds: [],
};

function track(overrides: Partial<TrackData>): TrackData {
  return {
    rating: 0,
    energy: 0,
    bpm: null,
    tagIds: [],
    albumUri: "spotify:album:one",
    ...overrides,
  };
}

describe("buildAlbumTrackSummaries", () => {
  it("summarizes the album's tagged tracks without changing them", () => {
    const tracks: Record<string, TrackData> = {
      one: track({
        rating: 4,
        energy: 7,
        tagIds: ["house", "house"],
        albumName: "Glass Horizons",
        artists: "Maya Fields, Guest Singer",
        albumImageUrl: "https://example.com/album.jpg",
        dateModified: 300,
      }),
      two: track({
        rating: 4.5,
        energy: 8,
        tagIds: ["house", "ambient"],
        artists: "Maya Fields",
        dateModified: 900,
      }),
      three: track({ tagIds: ["ambient"], artists: "Maya Fields", dateCreated: 500 }),
      four: track({ energy: 9, tagIds: ["deleted-tag"] }),
    };
    const original = structuredClone(tracks);

    const summary = buildAlbumTrackSummaries(tracks, taxonomy).get("spotify:album:one");

    expect(summary).toEqual({
      taggedTrackCount: 4,
      ratedTrackCount: 2,
      ratingAverage: 4.25,
      energyTrackCount: 3,
      energyAverage: 8,
      commonTags: [
        { tagId: "ambient", trackCount: 2, coverage: 0.5 },
        { tagId: "house", trackCount: 2, coverage: 0.5 },
      ],
      albumName: "Glass Horizons",
      artistName: "Maya Fields",
      imageUrl: "https://example.com/album.jpg",
      lastTaggedAt: 900,
    });
    expect(tracks).toEqual(original);
  });

  it("leaves averages empty until at least two tracks contribute", () => {
    const summary = buildAlbumTrackSummaries(
      {
        rated: track({ rating: 4.5 }),
        energetic: track({ energy: 7, tagIds: ["house"] }),
      },
      taxonomy,
    ).get("spotify:album:one");

    expect(summary).toMatchObject({
      taggedTrackCount: 2,
      ratedTrackCount: 1,
      ratingAverage: null,
      energyTrackCount: 1,
      energyAverage: null,
    });
  });

  it("ignores tracks that have no rating, energy, or known tag", () => {
    const summaries = buildAlbumTrackSummaries(
      {
        empty: track({}),
        deletedTagOnly: track({ tagIds: ["deleted-tag"] }),
        noAlbum: track({ albumUri: null, rating: 5 }),
      },
      taxonomy,
    );

    expect(summaries.size).toBe(0);
  });

  it("counts a tag as common from a quarter of the tagged tracks", () => {
    const albumTracks = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          String(index),
          track({ rating: 3, tagIds: index < 2 ? ["techno"] : [] }),
        ]),
      );

    expect(
      buildAlbumTrackSummaries(albumTracks(8), taxonomy).get("spotify:album:one")
        ?.commonTags,
    ).toEqual([{ tagId: "techno", trackCount: 2, coverage: 0.25 }]);
    expect(
      buildAlbumTrackSummaries(albumTracks(9), taxonomy).get("spotify:album:one")
        ?.commonTags,
    ).toEqual([]);
  });

  it("leaves common tags empty until at least two tracks have tags", () => {
    const singleTrack = buildAlbumTrackSummaries(
      { only: track({ tagIds: ["house", "techno"] }) },
      taxonomy,
    ).get("spotify:album:one");
    const oneTrackWithTags = buildAlbumTrackSummaries(
      {
        tagged: track({ tagIds: ["house"] }),
        ratedOnly: track({ rating: 4 }),
      },
      taxonomy,
    ).get("spotify:album:one");

    expect(singleTrack?.commonTags).toEqual([]);
    expect(oneTrackWithTags).toMatchObject({ taggedTrackCount: 2, commonTags: [] });
  });

  it("orders equally common tags by taxonomy order", () => {
    const summary = buildAlbumTrackSummaries(
      {
        one: track({ tagIds: ["techno", "ambient", "house"] }),
        two: track({ tagIds: ["house", "techno", "ambient"] }),
      },
      taxonomy,
    ).get("spotify:album:one");

    expect(summary?.commonTags.map((tag) => tag.tagId)).toEqual([
      "ambient",
      "house",
      "techno",
    ]);
  });
});

describe("getAlbumProgress", () => {
  it("measures tagged tracks against the album length", () => {
    expect(getAlbumProgress(9, 13)).toEqual({
      taggedTrackCount: 9,
      totalTrackCount: 13,
      ratio: 9 / 13,
      isComplete: false,
    });
    expect(getAlbumProgress(13, 13).isComplete).toBe(true);
  });

  it("caps progress when Spotify reports fewer tracks than were tagged", () => {
    expect(getAlbumProgress(14, 12)).toEqual({
      taggedTrackCount: 12,
      totalTrackCount: 12,
      ratio: 1,
      isComplete: true,
    });
  });

  it("has no ratio while the album length is unknown", () => {
    expect(getAlbumProgress(3, null)).toEqual({
      taggedTrackCount: 3,
      totalTrackCount: null,
      ratio: null,
      isComplete: false,
    });
    expect(getAlbumProgress(3, 0).ratio).toBeNull();
  });
});

describe("formatTrackAverage", () => {
  it("shows one decimal place", () => {
    expect(formatTrackAverage(4)).toBe("4.0");
    expect(formatTrackAverage(4.25)).toBe("4.3");
    expect(formatTrackAverage(6.666)).toBe("6.7");
  });
});
