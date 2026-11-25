import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackInfo } from "@/services/SpotifyService";

const { mockSpotifyService } = vi.hoisted(() => ({
  mockSpotifyService: {
    getBatchTracks: vi.fn(),
    getTrack: vi.fn(),
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
        setIsMultiTagging: vi.fn(),
        setMultiTagTracks,
        setLockedTrack: vi.fn(),
        setIsLocked: vi.fn(),
        setLockedMultiTrackUri: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(mockSpotifyService.getBatchTracks).toHaveBeenCalledWith(trackUris, 2, expect.any(AbortSignal));
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

  it.each([
    ["a Spotify song", "spotify:track:single"],
    ["a local file", "spotify:local:Artist:Album:Song:180"],
  ])("opening %s while Bulk Tag is open leaves Bulk Tag", async (_, trackUri) => {
    const trackUris = ["spotify:track:a", "spotify:track:b"];
    Spicetify.Platform.History.location.state = { trackUris };
    mockSpotifyService.getBatchTracks.mockResolvedValue({});
    mockSpotifyService.getTrack.mockResolvedValue(trackInfo);
    let navigate = () => {};
    vi.mocked(Spicetify.Platform.History.listen).mockImplementation((listener: () => void) => {
      navigate = listener;
      return vi.fn();
    });

    const { result } = renderHook(() => {
      const [isMultiTagging, setIsMultiTagging] = useState(false);
      const [multiTagTracks, setMultiTagTracks] = useState<unknown[]>([]);
      const [lockedTrack, setLockedTrack] = useState<unknown>(null);
      useSpicetifyHistory({
        setIsMultiTagging,
        setMultiTagTracks,
        setLockedTrack,
        setIsLocked: vi.fn(),
        setLockedMultiTrackUri: vi.fn(),
      });
      return { isMultiTagging, multiTagTracks, lockedTrack };
    });
    await waitFor(() => expect(result.current.isMultiTagging).toBe(true));

    Spicetify.Platform.History.location.state = { trackUri };
    act(() => navigate());

    await waitFor(() => expect(result.current.lockedTrack).toEqual(expect.objectContaining({ uri: trackUri })));
    expect(result.current.isMultiTagging).toBe(false);
    expect(result.current.multiTagTracks).toEqual([]);
  });
});
