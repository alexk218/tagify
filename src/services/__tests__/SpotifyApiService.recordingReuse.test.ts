import { discussion39Artists, discussion39Releases } from "../../../scripts/tests/fixtures/discussion39";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let api: typeof import("../SpotifyApiService").spotifyApiService;
beforeEach(async () => {
  vi.resetModules();
  api = (await import("../SpotifyApiService")).spotifyApiService;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const exactIds = discussion39Releases.map(release => release.id);
const exactGids = discussion39Releases.map(release => release.gid);
const artistGids = discussion39Artists.map(artist => artist.gid);
const artistIds = discussion39Artists.map(artist => artist.id);
function desktopUris() {
  vi.stubGlobal("Spicetify", { ...Spicetify, URI: {
    idToHex: (id: string) => exactGids[exactIds.indexOf(id)],
    hexToId: (gid: string) => artistIds[artistGids.indexOf(gid)],
  } });
}

it("confirms the discussion #39 single, EP and album using live-captured desktop metadata without Web API requests", async () => {
  desktopUris();
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, status: 200, json: async () => ({
    gid: url.split("/").pop(), name: "HARDSTYLE 2 - Lou Nour remix", duration: 192000,
    external_id: [{ type: "isrc", id: "GBAHS2600027" }], artist: artistGids.map(gid => ({ gid })),
  }) }));
  vi.stubGlobal("fetch", fetchMock);
  const identities = await Promise.all(exactIds.map(id => api.getRecordingIdentity(`spotify:track:${id}`)));
  expect(identities).toEqual(Array(3).fill({ isrc: "GBAHS2600027", name: "HARDSTYLE 2 - Lou Nour remix", durationMs: 192000, artistIds: [...artistIds].sort() }));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls.every(([url]) => url.startsWith("https://spclient.wg.spotify.com/metadata/4/track/"))).toBe(true);
});

const desktopRecording = { gid: exactGids[0], name: "Song - Original Mix", duration: 180000, external_id: [{ type: "isrc", id: "USABC2400001" }], artist: [{ gid: artistGids[0] }] };

it("never asks the Web API when Spotify's desktop metadata is unavailable", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Spicetify", { ...Spicetify, URI: undefined });
  await expect(api.getRecordingIdentity(`spotify:track:${exactIds[0]}`)).rejects.toThrow("couldn't check this recording");
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  { gid: exactGids[1] },
  { external_id: [] },
  { artist: [{ gid: "bad-artist" }] },
])("leaves incomplete or mismatched desktop metadata without an identity: %j", async (change) => {
  desktopUris();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...desktopRecording, ...change }) });
  vi.stubGlobal("fetch", fetchMock);
  await expect(api.getRecordingIdentity(`spotify:track:${exactIds[0]}`)).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("leaves a song Spotify's desktop metadata can't find without an identity, and asks nothing else", async () => {
  desktopUris();
  const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, headers: new Headers() });
  vi.stubGlobal("fetch", fetchMock);
  await expect(api.getRecordingIdentity(`spotify:track:${exactIds[0]}`)).resolves.toBeUndefined();
  expect(fetchMock.mock.calls.map(([url]) => url.includes("spclient"))).toEqual([true]);
});

it("stops matching during Spotify's cooldown", async () => {
  desktopUris();
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "Retry-After": "120" }) })
    .mockResolvedValue({ ok: true, status: 200, json: async () => desktopRecording });
  vi.stubGlobal("fetch", fetchMock);
  await expect(api.getRecordingIdentity(`spotify:track:${exactIds[0]}`)).rejects.toMatchObject({ status: 429 });
  await expect(api.getRecordingIdentity(`spotify:track:${exactIds[1]}`)).rejects.toMatchObject({ status: 429 });
  expect(fetchMock.mock.calls.map(([url]) => url.includes("spclient"))).toEqual([true]);
});

it("does not retry after a cancelled desktop lookup", async () => {
  desktopUris();
  const controller = new AbortController();
  const fetchMock = vi.fn().mockImplementation(async () => { controller.abort(); throw new DOMException("Cancelled", "AbortError"); });
  vi.stubGlobal("fetch", fetchMock);
  await expect(api.getRecordingIdentity(`spotify:track:${exactIds[0]}`, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("backs off for Spotify's requested interval instead of retrying a rate-limited match", async () => {
  desktopUris();
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "Retry-After": "120" }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => desktopRecording });
  vi.stubGlobal("fetch", fetchMock);
  const uri = `spotify:track:${exactIds[0]}`;
  await expect(api.getRecordingIdentity(uri)).rejects.toMatchObject({ status: 429 });
  now += 119999;
  await expect(api.getRecordingIdentity(uri)).rejects.toMatchObject({ status: 429 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  now += 1;
  await expect(api.getRecordingIdentity(uri)).resolves.toMatchObject({ isrc: "USABC2400001" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
