// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spotifyApiService } from "../SpotifyApiService";
import { graphqlRateLimiter } from "@/utils/RateLimiter";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request"))); (globalThis as any).__tagifyArtistMetadataV1?.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("reads 50,000 playlist entries through bounded desktop pages without Web API calls", async () => {
  vi.useFakeTimers();
  const contents = vi.fn(async (_uri, page = { offset: 0, limit: 100 }) => ({ totalLength: 50_000, offset: page.offset,
    items: Array.from({ length: Math.min(100, 50_000 - page.offset) }, (_, i) => ({ uri: `spotify:track:${page.offset + i}`, uid: `occurrence-${page.offset + i}` })),
  }));
  (Spicetify.Platform.PlaylistAPI as any).getContents = contents;
  const result = spotifyApiService.getAllTrackUrisInPlaylistStrict("large");
  await vi.runAllTimersAsync();
  expect((await result).length).toBe(50_000);
  expect(contents).toHaveBeenCalledTimes(500);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it.each(["repeat", "shrink", "empty", "snapshot"])("rejects %s pages rather than returning a partial playlist", async mode => {
  const contents = vi.fn().mockResolvedValueOnce({ items: [{ uri: "spotify:track:first", uid: "one" }], totalLength: 2, snapshotId: "v1" })
    .mockResolvedValue(mode === "repeat" ? { items: [{ uri: "spotify:track:first", uid: "one" }], totalLength: 2 } : mode === "empty" ? { items: [], totalLength: 2 } : { items: [{ uri: "spotify:track:second", uid: "two" }], totalLength: mode === "shrink" ? 1 : 2, snapshotId: "v2" });
  (Spicetify.Platform.PlaylistAPI as any).getContents = contents;
  await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict(mode)).rejects.toThrow();
  expect(contents).toHaveBeenCalledTimes(2);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it("recovers through desktop after a cooldown without consuming a failed partial baseline", async () => {
  vi.useFakeTimers();
  const contents = vi.fn().mockRejectedValueOnce({ status: 429, retryAfterSeconds: 60 })
    .mockResolvedValue({ items: [{ uri: "spotify:track:saved" }], totalLength: 1 });
  (Spicetify.Platform.PlaylistAPI as any).getContents = contents;
  await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("resume")).rejects.toMatchObject({ status: 429 });
  await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("resume")).rejects.toMatchObject({ spotifyFailure: { dispatched: false } });
  expect(contents).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("resume")).resolves.toEqual(["spotify:track:saved"]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it("shares and caches desktop artist metadata while separating accounts", async () => {
  const request = vi.mocked(Spicetify.GraphQL.Request);
  (Spicetify.GraphQL.Definitions as any).queryArtistOverview = { name: "queryArtistOverview" };
  request.mockResolvedValue({ data: { artistUnion: { uri: "spotify:artist:test", profile: { name: "Artist" } } } } as never);
  const [one, two] = await Promise.all([spotifyApiService.getArtistMetadata("test"), spotifyApiService.getArtistMetadata("test")]);
  expect(one?.name).toBe("Artist"); expect(two).toEqual(one);
  await spotifyApiService.getArtistMetadata("test");
  expect(request).toHaveBeenCalledTimes(1);
  const user = Spicetify.Platform.username;
  Spicetify.Platform.username = "other";
  try { await spotifyApiService.getArtistMetadata("test"); } finally { Spicetify.Platform.username = user; }
  expect(request).toHaveBeenCalledTimes(2);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it("never uses another transport when artist GraphQL is throttled", async () => {
  (Spicetify.GraphQL.Definitions as any).queryArtistOverview = { name: "queryArtistOverview" };
  vi.mocked(Spicetify.GraphQL.Request).mockRejectedValue({ status: 429, retryAfterSeconds: 60 });
  await expect(spotifyApiService.getArtistMetadata("paused")).rejects.toMatchObject({ status: 429 });
  await expect(spotifyApiService.getArtistMetadata("paused")).rejects.toMatchObject({ spotifyFailure: { dispatched: false } });
  expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  graphqlRateLimiter.reset();
});
it("retries missing artist details after the negative-cache interval", async () => {
  vi.useFakeTimers();
  (Spicetify.GraphQL.Definitions as any).queryArtistOverview = { name: "queryArtistOverview" };
  const request = vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue({ data: {} } as never);
  await expect(spotifyApiService.getArtistMetadata("missing")).resolves.toBeNull();
  const count = request.mock.calls.length;
  await spotifyApiService.getArtistMetadata("missing");
  expect(request).toHaveBeenCalledTimes(count);
  await vi.advanceTimersByTimeAsync(60_000);
  request.mockResolvedValue({ data: { artistUnion: { uri: "spotify:artist:missing", profile: { name: "Recovered" } } } } as never);
  await expect(spotifyApiService.getArtistMetadata("missing")).resolves.toMatchObject({ name: "Recovered" });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
