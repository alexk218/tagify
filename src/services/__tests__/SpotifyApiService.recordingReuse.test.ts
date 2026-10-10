import { afterEach, beforeEach, expect, it, vi } from "vitest";

let api: typeof import("../SpotifyApiService").spotifyApiService;
beforeEach(async () => {
  vi.resetModules();
  api = (await import("../SpotifyApiService")).spotifyApiService;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const uri = `spotify:track:${"a".repeat(22)}`;
const recording = {
  external_ids: { isrc: "usabc2400001" },
  artists: [{ id: "c".repeat(22) }, { id: "b".repeat(22) }],
  duration_ms: 180000,
  name: "Song - Original Mix",
};

it("confirms recording identity from authenticated Spotify metadata", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => recording });
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  await expect(api.getRecordingIdentity(uri, controller.signal)).resolves.toEqual({
    isrc: "USABC2400001", artistIds: ["b".repeat(22), "c".repeat(22)],
    durationMs: 180000, name: "Song - Original Mix",
  });
  expect(fetchMock).toHaveBeenCalledWith(`https://api.spotify.com/v1/tracks/${"a".repeat(22)}`, {
    headers: { Authorization: "Bearer test-token" }, signal: controller.signal,
  });
});

it("does not confirm a release when Spotify omits its recording identifier", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...recording, external_ids: {} }) }));
  await expect(api.getRecordingIdentity(uri)).resolves.toBeUndefined();
});

it("backs off for Spotify's requested interval instead of retrying a rate-limited match", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "Retry-After": "120" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => recording });
  vi.stubGlobal("fetch", fetchMock);
  await expect(api.getRecordingIdentity(uri)).rejects.toThrow("couldn't check");
  now += 119999;
  await expect(api.getRecordingIdentity(uri)).rejects.toThrow("short break");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  now += 1;
  await expect(api.getRecordingIdentity(uri)).resolves.toMatchObject({ isrc: "USABC2400001" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
