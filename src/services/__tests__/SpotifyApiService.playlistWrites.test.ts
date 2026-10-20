// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spotifyApiService } from "../SpotifyApiService";

// Spotify's desktop PlaylistAPI as Tagify's Community playlist writes use it: getContents pages,
// add/remove by occurrence and getMetadata (shapes seen in Spotify 1.2.92).
const PLAYLIST = "P000000000000000000001";
const track = (n: number) => `spotify:track:T${String(n).padStart(21, "0")}`;

function desktopPlaylist(initial: string[]) {
  let uids = 0;
  let items = initial.map((uri) => ({ uri, uid: `uid-${++uids}` }));
  const api = Spicetify.Platform.PlaylistAPI as any;
  api.getContents = vi.fn(async (_uri: string, page?: { offset: number; limit: number }) => {
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? 100;
    return { items: items.slice(offset, offset + limit), totalLength: items.length, ...(page ? { offset } : {}) };
  });
  api.remove = vi.fn(async (_uri: string, batch: Array<{ uri: string; uid: string }>) => {
    const removing = new Set(batch.map((item) => item.uid));
    items = items.filter((item) => !removing.has(item.uid));
  });
  api.add = vi.fn(async (_uri: string, uris: string[], position: { after: string }) => {
    expect(position).toEqual({ after: "end" });
    items = [...items, ...uris.map((uri) => ({ uri, uid: `uid-${++uids}` }))];
  });
  return { api, uris: () => items.map((item) => item.uri) };
}

describe("Writing a Community playlist through Spotify's desktop app", () => {
  beforeEach(() => { localStorage.clear?.(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("fills an empty playlist in order, 100 songs per write", async () => {
    const playlist = desktopPlaylist([]);
    const wanted = Array.from({ length: 250 }, (_, index) => track(index));
    await spotifyApiService.replacePlaylistTracks(PLAYLIST, wanted);
    expect(playlist.uris()).toEqual(wanted);
    expect(playlist.api.add.mock.calls.map((call: unknown[]) => (call[1] as string[]).length)).toEqual([100, 100, 50]);
    expect(playlist.api.remove).not.toHaveBeenCalled();
  });

  it("keeps the songs that already start the playlist and replaces the rest in order", async () => {
    const playlist = desktopPlaylist([track(1), track(2), track(3), track(4)]);
    await spotifyApiService.replacePlaylistTracks(PLAYLIST, [track(1), track(2), track(5), track(3)]);
    expect(playlist.uris()).toEqual([track(1), track(2), track(5), track(3)]);
    // Only the occurrences after the kept start were removed, by their own uid.
    expect(playlist.api.remove.mock.calls[0][1]).toEqual([{ uri: track(3), uid: "uid-3" }, { uri: track(4), uid: "uid-4" }]);
  });

  it("removes a later copy of a kept song without touching the kept one", async () => {
    const playlist = desktopPlaylist([track(1), track(2), track(1)]);
    await spotifyApiService.replacePlaylistTracks(PLAYLIST, [track(1), track(2)]);
    expect(playlist.uris()).toEqual([track(1), track(2)]);
  });

  it("writes nothing when the playlist already matches", async () => {
    const playlist = desktopPlaylist([track(1), track(2)]);
    await spotifyApiService.replacePlaylistTracks(PLAYLIST, [track(1), track(2)]);
    expect(playlist.api.add).not.toHaveBeenCalled();
    expect(playlist.api.remove).not.toHaveBeenCalled();
    expect(playlist.api.getContents).toHaveBeenCalledTimes(1);
  });

  it("empties a playlist", async () => {
    const playlist = desktopPlaylist([track(1), track(2)]);
    await spotifyApiService.replacePlaylistTracks(PLAYLIST, []);
    expect(playlist.uris()).toEqual([]);
  });

  it("fails when Spotify doesn't end up holding the songs in order", async () => {
    const playlist = desktopPlaylist([]);
    playlist.api.add.mockImplementation(async () => undefined);
    await expect(spotifyApiService.replacePlaylistTracks(PLAYLIST, [track(1)])).rejects.toThrow("in order");
  });

  it("renames a playlist and sets its description", async () => {
    const api = Spicetify.Platform.PlaylistAPI as any;
    api.updateDetails = vi.fn(async () => undefined);
    await spotifyApiService.updatePlaylistDetails(PLAYLIST, { name: "Late night", description: "Made on Tagify Community from your tags." });
    expect(api.updateDetails).toHaveBeenCalledWith(`spotify:playlist:${PLAYLIST}`, { name: "Late night", description: "Made on Tagify Community from your tags." });
  });

  it("treats a playlist the member deleted, or that isn't theirs, as gone", async () => {
    const api = Spicetify.Platform.PlaylistAPI as any;
    api.getMetadata = vi.fn().mockResolvedValueOnce({ isOwnedBySelf: true, isSaved: true, canEditItems: true });
    expect(await spotifyApiService.ownPlaylistState(PLAYLIST)).toBe("mine");
    // Spotify keeps a deleted playlist readable; only isSaved changes.
    api.getMetadata = vi.fn().mockResolvedValueOnce({ isOwnedBySelf: true, isSaved: false, canEditItems: true });
    expect(await spotifyApiService.ownPlaylistState(PLAYLIST)).toBe("gone");
    api.getMetadata = vi.fn().mockResolvedValueOnce({ isOwnedBySelf: false, isSaved: true, canEditItems: false });
    expect(await spotifyApiService.ownPlaylistState(PLAYLIST)).toBe("gone");
    api.getMetadata = vi.fn().mockRejectedValueOnce(new Error("offline"));
    await expect(spotifyApiService.ownPlaylistState(PLAYLIST)).rejects.toThrow();
  });
});
