import { describe, expect, it } from "vitest";
import {
  calculatePlaylistTrackDelta,
  collectMatchingTrackUris,
  findDuplicateTrackUris,
  withUpdatedPlaylistTrackUris,
} from "@/features/smart-playlists/utils/smartPlaylist.syncUtils";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { TagDataStructure } from "@/types/tagData";

describe("smartPlaylist.syncUtils", () => {
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

  it("calculates add/remove track deltas", () => {
    const { tracksToAdd, tracksToRemove } = calculatePlaylistTrackDelta(
      ["spotify:track:1", "spotify:track:2"],
      ["spotify:track:2", "spotify:track:3"],
    );

    expect(tracksToAdd).toEqual(["spotify:track:3"]);
    expect(tracksToRemove).toEqual(["spotify:track:1"]);
  });

  it("updates playlist URIs and lastSyncAt immutably", () => {
    const playlist: SmartPlaylistCriteria = {
      playlistId: "a",
      playlistName: "A",
      isActive: true,
      createdAt: 1,
      lastSyncAt: 1,
      smartPlaylistTrackUris: ["spotify:track:1"],
      criteria: {
        includeTagClauses: [],
        clauseConnectors: [],
        ratingFilters: [],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
      },
    };

    const otherPlaylist: SmartPlaylistCriteria = {
      ...playlist,
      playlistId: "b",
      playlistName: "B",
    };

    const updated = withUpdatedPlaylistTrackUris(
      [playlist, otherPlaylist],
      "a",
      ["spotify:track:9"],
    );

    expect(updated[0].smartPlaylistTrackUris).toEqual(["spotify:track:9"]);
    expect(updated[0].lastSyncAt).toBeGreaterThanOrEqual(1);
    expect(updated[1].smartPlaylistTrackUris).toEqual(["spotify:track:1"]);
  });
});
