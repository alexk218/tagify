import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlaylistState } from "@/features/playlist-state/hooks/usePlaylistState";
import { fullRefreshPlaylistCache, getPlaylistCache } from "@/utils/PlaylistCache";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("creates a playlist through /me with one request when desktop creation is unavailable", async () => {
  vi.stubGlobal("Spicetify", { ...Spicetify, Platform: { ...Spicetify.Platform, RootlistAPI: {} } });
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "created" }), { status: 201 }));
  const { result } = renderHook(() => usePlaylistState());
  let id: string | null = null;
  await act(async () => { id = await result.current.createPlaylistFromFilters([], "Example", "Details", false, true); });
  expect(id).toBe("created"); expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith("https://api.spotify.com/v1/me/playlists", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Example", description: "Details", public: false }) }));
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
