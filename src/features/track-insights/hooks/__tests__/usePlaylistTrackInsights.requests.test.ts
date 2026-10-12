import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePlaylistTrackInsights } from "../usePlaylistTrackInsights";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("bounds a large playlist refresh and ignores repeated focus events", async () => {
  vi.useFakeTimers();
  const lookup = vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockResolvedValue([]);
  const playlists = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`spotify:playlist:insights-${i}`, { rating: 0, energy: 0, tagIds: [] }]));
  const hook = renderHook(() => usePlaylistTrackInsights(playlists, {}, createEmptyTaxonomy(), true, null));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(lookup).toHaveBeenCalledTimes(20);
  await act(async () => {
    for (let i = 0; i < 50; i++) window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(lookup).toHaveBeenCalledTimes(20);
  await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
  expect(lookup).toHaveBeenCalledTimes(40);
  hook.unmount();
});
