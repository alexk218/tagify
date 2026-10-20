// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { graphqlRateLimiter } from "@/utils/RateLimiter";
import { spotifyFetch, spotifyRead, spotifyWrite } from "../SpotifyRequests";
import { AudioFeaturesService } from "../AudioFeaturesService";
import { spotifyApiService } from "../SpotifyApiService";
beforeEach(() => { (Spicetify.Platform.PlaylistAPI as any).getContents = vi.fn(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps successful fetch bodies readable and shares concurrent reads", async () => {
  let signal!: AbortSignal;
  const fetch = vi.fn(async (_url, init) => { signal = init.signal; return new Response('{"ok":true}'); });
  vi.stubGlobal("fetch", fetch);
  const responses = await Promise.all([spotifyFetch("https://api.spotify.com/test"), spotifyFetch("https://api.spotify.com/test")]);
  expect(signal.aborted).toBe(false);
  expect(await responses[0].json()).toEqual({ ok: true });
  expect(await responses[1].json()).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("stops audio fallbacks and retains Retry-After across a dispatcher reset", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  vi.stubGlobal("fetch", fetch);
  const audio = new AudioFeaturesService();
  await expect(audio.getAudioFeaturesByTrackId("first")).rejects.toMatchObject({ status: 429 });
  graphqlRateLimiter.reset();
  await expect(audio.getAudioFeaturesByTrackId("second")).rejects.toMatchObject({ status: 429 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("adds 250 songs with one membership read and three bounded writes", async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const read = vi.spyOn(api, "getContents").mockResolvedValue({ items: [] });
  const add = vi.spyOn(api, "add").mockResolvedValue(undefined);
  const uris = Array.from({ length: 250 }, (_, i) => `spotify:track:${i}`);
  const result = await spotifyApiService.updatePlaylistTracks("batch", uris, []);
  expect(result).toEqual({ success: true, added: uris, removed: [] });
  expect(read).toHaveBeenCalledTimes(1);
  expect(add.mock.calls.map(call => (call[1] as string[]).length)).toEqual([100, 100, 50]);
});
it("stops a write pass after a failed batch, retaining only confirmed additions", async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  vi.spyOn(api, "getContents").mockResolvedValue({ items: [] });
  const add = vi.spyOn(api, "add").mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("offline"));
  const uris = Array.from({ length: 250 }, (_, i) => `spotify:track:${i}`);
  const result = await spotifyApiService.updatePlaylistTracks("failure", uris, []);
  expect(result).toEqual({ success: false, added: uris.slice(0, 100), removed: [] });
  expect(add).toHaveBeenCalledTimes(2);
});
it("rejects repeated playlist pagination without returning incomplete membership", async () => {
  const desktop = vi.spyOn(Spicetify.Platform.PlaylistAPI as any, "getContents").mockResolvedValue({ items: [{ uri: "spotify:track:repeat", uid: "same" }], totalLength: 2 });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("repeated")).rejects.toThrow("repeated");
  expect(desktop).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();
});
it("uses rootlist names without fan-out for 300 playlists", async () => {
  const platform = Spicetify.Platform as any;
  platform.RootlistAPI = { getContents: vi.fn().mockResolvedValue({ items: Array.from({ length: 300 }, (_, i) => ({ type: "playlist", uri: `spotify:playlist:${i}`, name: `Playlist ${i}` })) }) };
  const metadata = vi.spyOn(platform.PlaylistAPI, "getMetadata");
  expect(await spotifyApiService.getAllUserPlaylistReferencesStrict()).toHaveLength(300);
  expect(metadata).not.toHaveBeenCalled();
});
it("shares cooldown between REST and desktop APIs", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
  await expect(spotifyFetch("https://api.spotify.com/test")).rejects.toMatchObject({ status: 429 });
  const desktop = vi.fn();
  await expect(spotifyRead("desktop", desktop)).rejects.toMatchObject({ status: 429 });
  expect(desktop).not.toHaveBeenCalled();
});

it("does not mark partially removed duplicate songs as completely removed", async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  api.getContents.mockResolvedValue({ items: Array.from({ length: 150 }, (_, i) => ({ uri: "spotify:track:duplicate", uid: String(i) })) });
  api.remove = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("offline"));
  const result = await spotifyApiService.updatePlaylistTracks("duplicates", [], ["spotify:track:duplicate"], ["spotify:track:duplicate"]);
  expect(result).toEqual({ success: false, added: [], removed: [] });
});

it("never shares a pre-write read with a post-write confirmation", async () => {
  let finish!: (value: string) => void;
  const old = spotifyRead("membership", () => new Promise<string>(resolve => { finish = resolve; }));
  await spotifyWrite(async () => undefined);
  const lookup = vi.fn().mockResolvedValue("after");
  await expect(spotifyRead("membership", lookup)).resolves.toBe("after");
  expect(lookup).toHaveBeenCalledTimes(1);
  finish("before"); await old;
});
