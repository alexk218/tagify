import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackInfo } from "@/services/SpotifyService";

const { mockSpotifyService } = vi.hoisted(() => ({
  mockSpotifyService: {
    getBatchTracks: vi.fn(),
  },
}));

vi.mock("@/services/SpotifyService", () => ({
  spotifyService: mockSpotifyService,
}));

import { useSpicetifyHistory } from "@/features/track-session/hooks/useSpicetifyHistory";

const trackInfo: TrackInfo = {
  name: "Track",
  artists: "Artist",
  albumName: "Album",
  albumImageUrl: null,
  albumUri: "spotify:album:album",
  artistsData: [{ name: "Artist", uri: "spotify:artist:artist" }],
  duration_ms: 180000,
  release_date: "2025-01-01",
};

describe("useSpicetifyHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Spicetify.Platform.History.location = {
      pathname: "/tagify",
      search: "",
      state: {},
    };
  });

  it("loads every track in a large Bulk Tag selection through the batch loader", async () => {
    const trackUris = Array.from(
      { length: 250 },
      (_, index) => `spotify:track:${index}`,
    );
    const batchTracks = Object.fromEntries(
      trackUris.map((uri) => [uri, { ...trackInfo, name: `Track ${uri}` }]),
    );
    Spicetify.Platform.History.location.state = { trackUris };
    mockSpotifyService.getBatchTracks.mockResolvedValue(batchTracks);

    const setMultiTagTracks = vi.fn();

    renderHook(() =>
      useSpicetifyHistory({
        isMultiTagging: false,
        setIsMultiTagging: vi.fn(),
        setMultiTagTracks,
        setLockedTrack: vi.fn(),
        setIsLocked: vi.fn(),
        setLockedMultiTrackUri: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(mockSpotifyService.getBatchTracks).toHaveBeenCalledWith(trackUris);
      expect(setMultiTagTracks).toHaveBeenLastCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ uri: trackUris[0], name: `Track ${trackUris[0]}` }),
          expect.objectContaining({
            uri: trackUris[trackUris.length - 1],
            name: `Track ${trackUris[trackUris.length - 1]}`,
          }),
        ]),
      );
    });

    expect(setMultiTagTracks.mock.calls.at(-1)?.[0]).toHaveLength(250);
  });
});
