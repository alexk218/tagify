// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isTagifyPlaylistAddition, readPlaylistAdditionOrigins, rememberPlaylistAdditions } from "../SpotifyPlaylistWriteOrigins";
import { spotifyApiService } from "../SpotifyApiService";
import { graphqlRateLimiter } from "@/utils/RateLimiter";

const originalAccount = Spicetify.Platform.username;
beforeEach(() => { localStorage.clear(); Spicetify.Platform.username = "origins-a"; });
afterEach(() => { localStorage.clear(); Spicetify.Platform.username = originalAccount; graphqlRateLimiter.reset(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("scopes recovery to both accounts and acknowledges only entries already read", () => {
  rememberPlaylistAdditions("p", ["one"]);
  const first = readPlaylistAdditionOrigins("p");
  rememberPlaylistAdditions("p", ["two"]);
  first.acknowledge();
  expect([...readPlaylistAdditionOrigins("p").uris]).toEqual(["two"]);
  Spicetify.Platform.username = "origins-b";
  expect(readPlaylistAdditionOrigins("p").uris.size).toBe(0);
  Spicetify.Platform.username = "origins-a";
  localStorage.setItem("tagify:sync:account-id", "another-library");
  expect(readPlaylistAdditionOrigins("p").uris.size).toBe(0);
  localStorage.removeItem("tagify:sync:account-id");
  expect([...readPlaylistAdditionOrigins("p").uris]).toEqual(["two"]);
});

it("stops before dispatch if recovery cannot be persisted", async () => {
  const add = vi.spyOn(Spicetify.Platform.PlaylistAPI as any, "add").mockResolvedValue(undefined);
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new DOMException("Full", "QuotaExceededError"); });
  const result = await spotifyApiService.updatePlaylistTracks("quota", ["spotify:track:one"], [], [], { feature: "smart-playlists" });
  expect(result.success).toBe(false);
  expect(add).not.toHaveBeenCalled();
});

it("persists 50k additions in bounded batches and identifies own hook calls without scans", async () => {
  vi.useFakeTimers();
  const uris = Array.from({ length: 50000 }, (_, i) => `spotify:track:${String(i).padStart(22, "0")}`);
  const set = vi.spyOn(localStorage, "setItem");
  const add = vi.spyOn(Spicetify.Platform.PlaylistAPI as any, "add").mockImplementation(async (_id, batch) => {
    expect(isTagifyPlaylistAddition(batch)).toBe(true);
  });
  const work = spotifyApiService.updatePlaylistTracks("bulk-origins", uris, [], [], { feature: "smart-playlists" });
  await vi.advanceTimersByTimeAsync(120000);
  expect(await work).toEqual({ success: true, added: uris, removed: [] });
  expect(add).toHaveBeenCalledTimes(500);
  const entries = set.mock.calls.filter(([key]) => key.startsWith("tagify:playlist-additions:"));
  expect(entries).toHaveLength(500);
  expect(entries.every(([, value]) => JSON.parse(value).length === 100)).toBe(true);
  expect(readPlaylistAdditionOrigins("bulk-origins").uris.size).toBe(50000);
  readPlaylistAdditionOrigins("bulk-origins").acknowledge();
  expect(readPlaylistAdditionOrigins("bulk-origins").uris.size).toBe(0);
});

it("retains every ambiguous batch while acknowledging successfully saved additions", () => {
  rememberPlaylistAdditions("p", ["saved"]);
  rememberPlaylistAdditions("p", ["uncertain", "saved"]);
  readPlaylistAdditionOrigins("p").acknowledge(new Set(["saved"]));
  expect([...readPlaylistAdditionOrigins("p").uris].sort()).toEqual(["saved", "uncertain"]);
});
