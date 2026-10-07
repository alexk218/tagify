import { describe, expect, it } from "vitest";
import { TrackData } from "@/types/tagData";
import {
  buildPlaylistTrackApplyUpdates,
  previewPlaylistTrackApply,
} from "../playlistTrackApply";

function track(overrides: Partial<TrackData>): TrackData {
  return { rating: 0, energy: 0, bpm: null, tagIds: [], ...overrides };
}

const trackUris = [
  "spotify:track:complete",
  "spotify:track:rated",
  "spotify:track:new",
  "spotify:track:rated",
];
const tracks: Record<string, TrackData> = {
  "spotify:track:complete": track({ rating: 3, energy: 4, tagIds: ["house", "warm"] }),
  "spotify:track:rated": track({ rating: 2, tagIds: ["house"] }),
};
const values = { tagIds: ["house", "warm"], rating: 4.5, energy: 7 };
const allChoices = { tags: true, rating: true, energy: true };

describe("previewPlaylistTrackApply", () => {
  it("counts the tracks each value would change", () => {
    expect(previewPlaylistTrackApply(trackUris, tracks, values)).toEqual({
      trackCount: 3,
      tagTrackCount: 2,
      ratingTrackCount: 1,
      energyTrackCount: 2,
    });
  });

  it("ignores values the album or playlist does not have", () => {
    expect(
      previewPlaylistTrackApply(trackUris, tracks, { tagIds: [], rating: 0, energy: 0 }),
    ).toEqual({ trackCount: 3, tagTrackCount: 0, ratingTrackCount: 0, energyTrackCount: 0 });
  });
});

describe("buildPlaylistTrackApplyUpdates", () => {
  it("adds missing tags and only fills in missing rating and energy", () => {
    expect(buildPlaylistTrackApplyUpdates(trackUris, tracks, values, allChoices)).toEqual([
      {
        trackUri: "spotify:track:rated",
        toAdd: ["warm"],
        toRemove: [],
        newEnergy: 7,
      },
      {
        trackUri: "spotify:track:new",
        toAdd: ["house", "warm"],
        toRemove: [],
        newRating: 4.5,
        newEnergy: 7,
      },
    ]);
  });

  it("skips values the user chose not to copy", () => {
    expect(
      buildPlaylistTrackApplyUpdates(trackUris, tracks, values, {
        tags: false,
        rating: true,
        energy: false,
      }),
    ).toEqual([
      { trackUri: "spotify:track:new", toAdd: [], toRemove: [], newRating: 4.5 },
    ]);
  });

  it("attaches album details so new tracks count toward the album", () => {
    const albumDetails = {
      albumUri: "spotify:album:glass",
      albumName: "Glass Horizons",
      albumImageUrl: "https://example.com/cover.jpg",
    };

    expect(
      buildPlaylistTrackApplyUpdates(
        ["spotify:track:new"],
        {},
        values,
        allChoices,
        albumDetails,
      )[0].albumDetails,
    ).toEqual(albumDetails);
  });
});
