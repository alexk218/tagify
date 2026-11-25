// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import protobuf from "protobufjs/light";
import { AudioFeaturesService } from "@/services/AudioFeaturesService";

/** Spotify's extended-metadata answer, in the shape the service decodes. */
function extendedMetadataAnswer(entries: { track: string; bpm: number; key: string }[]): Response {
  const root = protobuf.Root.fromJSON({ nested: {
    Message: { fields: { extension_kind: { type: "uint32", id: 2 }, response: { type: "Response", id: 3, rule: "repeated" } } },
    Response: { fields: { track: { type: "string", id: 2 }, attributes: { type: "Wrapper", id: 3 } } },
    Wrapper: { fields: { attributes: { type: "Attributes", id: 2 } } },
    Attributes: { fields: { bpm: { type: "double", id: 1 }, key: { type: "Key", id: 2 } } },
    Key: { fields: { key: { type: "string", id: 1 }, majorMinor: { type: "uint32", id: 2 } } },
  } });
  const bytes = root.lookupType("Message").encode({
    extension_kind: 222,
    response: entries.map(({ track, bpm, key }) => ({ track, attributes: { attributes: { bpm, key: { key, majorMinor: 1 } } } })),
  }).finish();
  return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, { status: 200 });
}

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

  it("matches each BPM and key to its own song when Spotify leaves one out", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => String(url).includes("extended-metadata")
      ? extendedMetadataAnswer([{ track: "spotify:track:a", bpm: 100, key: "A" }, { track: "spotify:track:c", bpm: 140, key: "C" }])
      : new Response(null, { status: 404 }));
    const service = new AudioFeaturesService();

    const [a, b, c] = await service.getAudioFeatures(["a", "b", "c"]);

    expect(a).toEqual(expect.objectContaining({ bpm: 100, key: "A" }));
    expect(b).toBeNull();
    expect(c).toEqual(expect.objectContaining({ bpm: 140, key: "C" }));
    // The cached answer is the right one too.
    expect(await service.getAudioFeaturesByTrackId("c")).toEqual(expect.objectContaining({ bpm: 140 }));
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("audio-analysis/b"))).toHaveLength(1);
  });
});
