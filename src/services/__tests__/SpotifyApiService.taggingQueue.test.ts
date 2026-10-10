import { afterEach, expect, it, vi } from "vitest";
import { spotifyApiService } from "../SpotifyApiService";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("uses bounded desktop Liked Songs paging with a strict page result", async () => {
  const getTracks = vi.spyOn(Spicetify.Platform.LibraryAPI as any, "getTracks").mockResolvedValue({ items: [{ uri: "spotify:track:one", name: "One" }], totalLength: 51 });
  const page = await spotifyApiService.getTaggingQueuePage(null, 50);
  expect(getTracks).toHaveBeenCalledWith({ offset: 50, limit: 50 });
  expect(page).toMatchObject({ checked: 1, nextOffset: null, backend: "desktop" });
});
it("uses authenticated precise playlist paging when desktop paging is unavailable", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ item: { uri: "spotify:track:one", name: "One" } }], total: 51 }) });
  vi.stubGlobal("fetch", fetchMock);
  const page = await spotifyApiService.getTaggingQueuePage("playlist", 50, undefined, true);
  expect(fetchMock).toHaveBeenCalledWith("https://api.spotify.com/v1/playlists/playlist/items?limit=50&offset=50", expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }));
  expect(page.backend).toBe("web");
});
it("does not turn an API failure into an empty completed library", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
  await expect(spotifyApiService.getTaggingQueuePage(null, 0, undefined, true)).rejects.toThrow("couldn't check");
});
