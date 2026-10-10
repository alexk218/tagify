import { act } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { readRules, writeRules } from "../store";
import { useAutomaticTags } from "../useAutomaticTags";
const state = vi.hoisted(() => ({ facts: {} as Record<string, { durationMs: number }>, listeners: new Set<() => void>(), account: "one", empty: {} }));
vi.mock("../facts", () => ({ readRuleFacts: () => state.facts, subscribeRuleFacts: (l: () => void) => { state.listeners.add(l); return () => state.listeners.delete(l); } }));
vi.mock("@/services/trackArtistIdentities", () => ({ trackArtistIdentitiesStore: { subscribe: () => () => {}, getSnapshot: () => state.empty } }));
vi.mock("@/features/track-insights/services/playlistMembership", () => ({ playlistMembershipStore: { subscribe: () => () => {}, getSnapshot: () => state.empty } }));
vi.mock("@/services/sync/SyncLocalState", async (original) => ({ ...await original<typeof import("@/services/sync/SyncLocalState")>(), getTagifyDatabaseName: () => state.account }));
vi.mock("@/features/playlist-state/services/albumTrackLists", () => ({ albumTrackListsStore: { subscribe: () => () => {}, getSnapshot: () => state.empty } }));
vi.mock("@/services/SpotifyService", () => ({ spotifyService: { getTrack: vi.fn() } }));
const data = { ...defaultTagData, taxonomy: { ...defaultTagData.taxonomy, tagsById: { short: { id: "short", name: "Short", subcategoryId: "f" } } }, tracks: { a: { rating: 4, energy: 8, bpm: 120, tagIds: [], dateModified: 123 } } };
const rule = { id: "r", name: "Short songs", enabled: true, scopes: [], conditions: [{ field: "length" as const, max: 180 }], tagIds: ["short"], otherwiseTagIds: [] };
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); state.facts = { a: { durationMs: 170000 } }; state.account = "one"; vi.stubGlobal("Spicetify", { showNotification: vi.fn() }); writeRules([rule]); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const run = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(600); }); };
it("uses cached details with zero Spotify calls, stays idempotent across renders and manual removal", async () => {
  const apply = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(({ current }) => useAutomaticTags(current, true, apply), { initialProps: { current: data } });
  await run(); expect(apply).toHaveBeenCalledTimes(1);
  hook.rerender({ current: { ...data, tracks: { ...data.tracks, a: { ...data.tracks.a, tagIds: [] } } } });
  await run(); expect(apply).toHaveBeenCalledTimes(1);
  const { spotifyService } = await import("@/services/SpotifyService");
  expect(spotifyService.getTrack).not.toHaveBeenCalled();
});
it("waits for missing details and applies when they arrive", async () => {
  state.facts = {};
  const apply = vi.fn().mockResolvedValue(undefined);
  renderHook(() => useAutomaticTags(data, true, apply));
  await run(); expect(apply).not.toHaveBeenCalled();
  act(() => { state.facts = { a: { durationMs: 170000 } }; state.listeners.forEach(l => l()); });
  await run(); expect(apply).toHaveBeenCalledTimes(1);
});
it("holds automation during loading and checks the current library after it finishes", async () => {
  const apply = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(({ ready }) => useAutomaticTags(data, ready, apply), { initialProps: { ready: false } });
  await run(); expect(apply).not.toHaveBeenCalled();
  hook.rerender({ ready: true }); await run(); expect(apply).toHaveBeenCalledTimes(1);
});
it("pauses rules on a failed save instead of making repeated attempts", async () => {
  const apply = vi.fn().mockRejectedValue(new Error("Save failed"));
  renderHook(() => useAutomaticTags(data, true, apply));
  await run(); expect(readRules()[0].enabled).toBe(false);
  await run(); expect(apply).toHaveBeenCalledTimes(1);
  expect(Spicetify.showNotification).toHaveBeenCalledWith(expect.stringContaining("paused"), true);
});
it("marks already-tagged songs so removing a manual tag does not immediately add it again", async () => {
  const apply = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(({ current }) => useAutomaticTags(current, true, apply), { initialProps: { current: { ...data, tracks: { a: { ...data.tracks.a, tagIds: ["short"] } } } } });
  await run(); expect(apply).not.toHaveBeenCalled();
  hook.rerender({ current: data }); await run(); expect(apply).not.toHaveBeenCalled();
});
