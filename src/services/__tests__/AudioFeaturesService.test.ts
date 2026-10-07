import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioFeaturesService } from "@/services/AudioFeaturesService";

describe("AudioFeaturesService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to Spotify client audio analysis when extended metadata fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          track: {
              tempo: 124.4,
              key: 7,
              mode: 1,
          },
        }),
      } as unknown as Response);

    const service = new AudioFeaturesService();
    const features = await service.getAudioFeaturesByTrackId("client-fallback");

    expect(features).toEqual({
      bpm: 124,
      key: "G",
      mode: 1,
      camelotKey: "9B",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/client-fallback",
      {
        headers: { Authorization: "Bearer test-token" },
      },
    );
  });

  it("falls back to Spotify Web API audio analysis when client audio analysis is unavailable", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          track: {
            tempo: 127.6,
            key: 9,
            mode: 0,
          },
        }),
      } as unknown as Response);

    const service = new AudioFeaturesService();
    const features = await service.getAudioFeaturesByTrackId("analysis-fallback");

    expect(features).toEqual({
      bpm: 128,
      key: "A",
      mode: 0,
      camelotKey: "8A",
    });
  });
});
