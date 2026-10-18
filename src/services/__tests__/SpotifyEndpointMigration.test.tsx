import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlaylistState } from "@/features/playlist-state/hooks/usePlaylistState";
import { fullRefreshPlaylistCache, getPlaylistCache } from "@/utils/PlaylistCache";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("creates a private playlist with its description through Spotify's desktop API, without the Web API", async () => {
  vi.useFakeTimers();
  const fetch = vi.spyOn(globalThis, "fetch");
  const createPlaylist = vi.fn().mockResolvedValue("spotify:playlist:created");
  // A brand-new playlist ignores the first privacy change.
  const getBasePermission = vi.fn().mockResolvedValueOnce("VIEWER").mockResolvedValue("BLOCKED");
  const setBasePermission = vi.fn().mockResolvedValue(undefined);
  const updateDetails = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("Spicetify", { ...Spicetify, Platform: { ...Spicetify.Platform,
    RootlistAPI: { createPlaylist, remove: vi.fn() }, PlaylistPermissionsAPI: { setBasePermission, getBasePermission },
    PlaylistAPI: { ...Spicetify.Platform.PlaylistAPI, updateDetails } } });
  const { result } = renderHook(() => usePlaylistState());
  let id: Promise<string | null> = Promise.resolve(null);
  act(() => { id = result.current.createPlaylistFromFilters([], "Example", "Details", false, true); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  await expect(id).resolves.toBe("created");
  expect(createPlaylist).toHaveBeenCalledWith("Example", { before: "start" });
  expect(setBasePermission).toHaveBeenCalledTimes(2);
  expect(setBasePermission).toHaveBeenLastCalledWith("spotify:playlist:created", "BLOCKED");
  expect(updateDetails).toHaveBeenCalledWith("spotify:playlist:created", { description: "Details" });
  expect(fetch).not.toHaveBeenCalled();
});

it("leaves a public playlist public and explains when this Spotify can't create playlists", async () => {
  const setBasePermission = vi.fn();
  vi.stubGlobal("Spicetify", { ...Spicetify, Platform: { ...Spicetify.Platform,
    RootlistAPI: { createPlaylist: vi.fn().mockResolvedValue("spotify:playlist:open") }, PlaylistPermissionsAPI: { setBasePermission, getBasePermission: vi.fn() } } });
  const { result } = renderHook(() => usePlaylistState());
  let id: string | null = null;
  await act(async () => { id = await result.current.createPlaylistFromFilters([], "Open", "", true, true); });
  expect(id).toBe("open"); expect(setBasePermission).not.toHaveBeenCalled();
  vi.stubGlobal("Spicetify", { ...Spicetify, Platform: { ...Spicetify.Platform, RootlistAPI: {} } });
  const fetch = vi.spyOn(globalThis, "fetch");
  await act(async () => { id = await result.current.createPlaylistFromFilters([], "Example", "", false, true); });
  expect(id).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  expect(Spicetify.showNotification).toHaveBeenLastCalledWith(expect.stringContaining("Update Spotify"), true);
});

it.each(["item", "track"])("reads modern playlist routes and supports %s-shaped entries without duplicate requests", async field => {
  vi.useFakeTimers();
  const get = vi.fn(async (url: string) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/me") return { id: "owner" };
    if (path === "/v1/me/playlists") return { items: [{ id: "playlist", name: "Example", owner: { id: "owner" }, items: { total: 2 }, snapshot_id: "snapshot" }] };
    if (path === "/v1/playlists/playlist/items") return { items: [{ [field]: { uri: "spotify:track:one" } }, { [field]: { uri: "spotify:local:artist:album:song:100" } }], next: null };
    if (path === "/v1/me/tracks") return { items: [], next: null };
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("Spicetify", { ...Spicetify, CosmosAsync: { ...Spicetify.CosmosAsync, get } });
  const task = fullRefreshPlaylistCache();
  await vi.advanceTimersByTimeAsync(1000);
  expect(await task).toBe(2);
  expect(getPlaylistCache().tracks["spotify:track:one"]).toEqual([{ id: "playlist", name: "Example", owner: "You" }]);
  expect(getPlaylistCache().tracks["spotify:local:artist:album:song:100"]).toHaveLength(1);
  expect(get.mock.calls.every(([url]) => !String(url).includes("/playlists/playlist/tracks"))).toBe(true);
  expect(get).toHaveBeenCalledTimes(4);
});
