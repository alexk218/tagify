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
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("does not probe restricted Web APIs when desktop audio data is unavailable", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    const service = new AudioFeaturesService();
    expect(await service.getAudioFeaturesByTrackId("analysis-fallback")).toBeNull();
    expect(await service.getAudioFeaturesByTrackId("analysis-fallback")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith("https://spclient.wg.spotify.com/"))).toBe(true);
  });
});
