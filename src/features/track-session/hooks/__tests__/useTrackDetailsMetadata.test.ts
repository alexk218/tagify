import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { spotifyService } from "@/services/SpotifyService";
import { useTrackDetailsMetadata } from "@/features/track-session/hooks/useTrackDetailsMetadata";
import { SpotifyTrack } from "@/types/SpotifyTypes";

vi.mock("@/services/AudioFeaturesService", () => ({
  audioFeaturesService: {
    getAudioFeaturesFromUri: vi.fn(),
  },
}));

vi.mock("@/services/SpotifyService", () => ({
  spotifyService: {
    getTrackMetadata: vi.fn(),
    getContextName: vi.fn(),
  },
}));

const mockTrack: SpotifyTrack = {
  uri: "spotify:track:5WAR8YFgSS4lgJo9FpMo6g",
  name: "Test Track",
  artists: [{ name: "Test Artist" }],
  album: { name: "Test Album" },
  duration_ms: 180000,
};

describe("useTrackDetailsMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(Spicetify.Player, "data", {
      value: {
        context: { uri: null },
        item: null,
      },
      configurable: true,
    });
  });

  it("still shows BPM and key when Spotify GraphQL metadata fails", async () => {
    vi.mocked(spotifyService.getTrackMetadata).mockRejectedValue(
      new TypeError("GraphQL.Request is not a function"),
    );
    vi.mocked(audioFeaturesService.getAudioFeaturesFromUri).mockResolvedValue({
      bpm: 124,
      key: "G",
      mode: 1,
      camelotKey: "9B",
    });

    const onSetBpm = vi.fn();
    const onSetCamelotKey = vi.fn();
    const { result } = renderHook(() =>
      useTrackDetailsMetadata({
        displayedTrack: mockTrack,
        artistNames: "Test Artist",
        trackData: {
          rating: 0,
          energy: 0,
          bpm: null,
          camelotKey: null,
          tagIds: [],
        },
        onSetBpm,
        onSetCamelotKey,
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingMetadata).toBe(false);
    });

    expect(result.current.trackMetadata.bpm).toBe(124);
    expect(result.current.trackMetadata.camelotKey).toBe("9B");
    expect(onSetBpm).not.toHaveBeenCalled();
    expect(onSetCamelotKey).not.toHaveBeenCalled();
  });
});
