// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { spotifyApiService } from "../SpotifyApiService";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("uses bounded desktop Liked Songs paging with a strict page result", async () => {
  const getTracks = vi.spyOn(Spicetify.Platform.LibraryAPI as any, "getTracks").mockResolvedValue({ items: [{ uri: "spotify:track:one", name: "One" }], totalLength: 51, offset: 50 });
  const page = await spotifyApiService.getTaggingQueuePage(null, 50);
  expect(getTracks).toHaveBeenCalledWith({ offset: 50, limit: 50 });
  expect(page).toMatchObject({ checked: 1, nextOffset: null });
});
it("pages a playlist on desktop although Spotify reports offset 0, without the Web API", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Spotify 1.2.92 returns the requested page but reports offset 0 for playlists.
  const getContents = vi.fn().mockResolvedValue({ items: [{ uri: "spotify:track:one", name: "One" }], totalLength: 51, offset: 0 });
  vi.stubGlobal("Spicetify", { ...Spicetify, Platform: { ...Spicetify.Platform, PlaylistAPI: { ...Spicetify.Platform.PlaylistAPI, getContents } } });
  await expect(spotifyApiService.getTaggingQueuePage("playlist", 50)).resolves.toMatchObject({ checked: 1, nextOffset: null });
  expect(getContents).toHaveBeenCalledWith("spotify:playlist:playlist", { offset: 50, limit: 50 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects a Liked Songs page that Spotify says came from another offset", async () => {
  vi.spyOn(Spicetify.Platform.LibraryAPI as any, "getTracks").mockResolvedValue({ items: [{ uri: "spotify:track:one", name: "One" }], totalLength: 51, offset: 0 });
  await expect(spotifyApiService.getTaggingQueuePage(null, 50)).rejects.toThrow("couldn't check");
});
it("does not turn a desktop failure into an empty completed library or a Web API request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Spicetify.Platform.LibraryAPI as any, "getTracks").mockRejectedValue(new Error("Desktop library unavailable"));
  await expect(spotifyApiService.getTaggingQueuePage(null, 0)).rejects.toThrow("couldn't check");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("saves songs to Liked Songs and checks them through Spotify's desktop app, never the Web API", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const add = vi.spyOn(Spicetify.Platform.LibraryAPI as any, "add").mockResolvedValue(undefined);
  const contains = vi.spyOn(Spicetify.Platform.LibraryAPI as any, "contains").mockResolvedValue([true, false]);
  await spotifyApiService.saveToLikedSongs(["spotify:track:one", "spotify:track:two"]);
  expect(add).toHaveBeenCalledWith({ uris: ["spotify:track:one", "spotify:track:two"] });
  await expect(spotifyApiService.likedSongsContain(["spotify:track:one", "spotify:track:two"])).resolves.toEqual([true, false]);
  expect(contains).toHaveBeenCalledWith("spotify:track:one", "spotify:track:two");
  contains.mockResolvedValue([true]);
  await expect(spotifyApiService.likedSongsContain(["spotify:track:one", "spotify:track:two"])).rejects.toThrow("couldn't check your Liked Songs");
  expect(fetchMock).not.toHaveBeenCalled();
});
