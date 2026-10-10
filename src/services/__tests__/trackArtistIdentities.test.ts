import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_ARTIST_CHECK_LIMIT, MANUAL_ARTIST_CHECK_LIMIT, TrackArtistIdentitiesStore } from "../trackArtistIdentities";

const artists = [{ uri: "spotify:artist:first", name: "Same Name" }, { uri: "spotify:artist:second", name: "Same Name" }];
const largeLibrary = Array.from({ length: 5000 }, (_, index) => `spotify:track:${index}`);

describe("artist identities and request budgets", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it("keeps collaborators with distinct Spotify identities and deduplicates reads", async () => {
    const lookup = vi.fn().mockResolvedValue(artists);
    const storage = { getItem: () => null, setItem: vi.fn() };
    const store = new TrackArtistIdentitiesStore(lookup, storage);
    await Promise.all([store.request("spotify:track:one"), store.request("spotify:track:one")]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()["spotify:track:one"].artists).toEqual(artists);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(storage.setItem).toHaveBeenCalled();
  });
  it("rejects name-only associations and pauses failed checks instead of cascading through a library", async () => {
    const lookup = vi.fn().mockResolvedValueOnce([{ name: "Artist" }]).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(artists);
    const store = new TrackArtistIdentitiesStore(lookup, null);
    await store.check(largeLibrary);
    expect(lookup).toHaveBeenCalledTimes(1);
    await store.check(largeLibrary);
    expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await store.check(largeLibrary);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual({});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await store.request("spotify:track:one")).toBe(true);
  });
  it("retains old identities without a monthly full-library rescan and rejects corrupt entries", async () => {
    const lookup = vi.fn();
    const storage = { getItem: (key: string) => key.endsWith(":v1") ? JSON.stringify({ "spotify:track:one": { checkedAt: 1, artists }, bad: null }) : null, setItem: vi.fn() };
    const store = new TrackArtistIdentitiesStore(lookup, storage);
    expect(store.getSnapshot()["spotify:track:one"].artists).toEqual(artists);
    await store.request("spotify:track:one");
    expect(lookup).not.toHaveBeenCalled();
    expect(Object.keys(store.getSnapshot())).toEqual(["spotify:track:one"]);
  });
  it("caps a cold 5,000-track library at 50 automatic requests across reopens, then 250 per explicit check", async () => {
    const starts: number[] = [];
    const lookup = vi.fn(async () => { starts.push(Date.now()); return artists; });
    const store = new TrackArtistIdentitiesStore(lookup, null);
    const first = store.check(largeLibrary, { automatic: true });
    await vi.runAllTimersAsync();
    await first;
    expect(lookup).toHaveBeenCalledTimes(AUTOMATIC_ARTIST_CHECK_LIMIT);
    await store.check(largeLibrary, { automatic: true });
    expect(lookup).toHaveBeenCalledTimes(50);
    const manual = store.check(largeLibrary);
    await vi.runAllTimersAsync();
    await manual;
    expect(lookup).toHaveBeenCalledTimes(50 + MANUAL_ARTIST_CHECK_LIMIT);
    expect(starts.every((time, index) => index === 0 || time - starts[index - 1] >= 1000)).toBe(true);
  });
  it("lets later tracks make progress after an unavailable song instead of retrying it first forever", async () => {
    const lookup = vi.fn(async (uri: string) => uri === "spotify:track:missing" ? [] : artists);
    const store = new TrackArtistIdentitiesStore(lookup, null);
    const uris = ["spotify:track:missing", "spotify:track:available"];
    await store.check(uris);
    expect(lookup.mock.calls.map(([uri]) => uri)).toEqual(["spotify:track:missing"]);
    await vi.advanceTimersByTimeAsync(60_000);
    const retry = store.check(uris);
    await vi.runAllTimersAsync();
    await retry;
    expect(store.getSnapshot()["spotify:track:available"].artists).toEqual(artists);
    expect(lookup.mock.calls[1]).toEqual(["spotify:track:available"]);
  });
  it("makes zero requests when metadata has already supplied the library's artists", async () => {
    const lookup = vi.fn();
    const store = new TrackArtistIdentitiesStore(lookup, null);
    store.rememberMany(largeLibrary.map((uri) => [uri, artists] as const));
    await store.check(largeLibrary, { automatic: true });
    expect(lookup).not.toHaveBeenCalled();
    expect(Object.keys(store.getSnapshot())).toHaveLength(5000);
  });
  it("stops on the first 429, persists Retry-After across reloads, and preserves existing results", async () => {
    const lookup = vi.fn().mockRejectedValue({ response: { status: 429, headers: { "Retry-After": "120" } } });
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) };
    const store = new TrackArtistIdentitiesStore(lookup, storage);
    store.remember("spotify:track:saved", artists);
    await store.check(largeLibrary, { automatic: true });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()["spotify:track:saved"].artists).toEqual(artists);
    expect(store.getCheckState().blockedUntil).toBe(Date.now() + 120_000);
    const reloaded = new TrackArtistIdentitiesStore(lookup, storage);
    await reloaded.check(largeLibrary);
    expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(119_000);
    await store.check(largeLibrary);
    expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await store.check(largeLibrary);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it("cancels after navigation and serializes overlapping consumers", async () => {
    let visible = true;
    const lookup = vi.fn().mockResolvedValue(artists);
    const store = new TrackArtistIdentitiesStore(lookup, null);
    const first = store.check(largeLibrary, { automatic: true, shouldContinue: () => visible });
    await vi.advanceTimersByTimeAsync(0);
    visible = false;
    const remount = store.check(largeLibrary, { automatic: true, shouldContinue: () => false });
    await vi.runAllTimersAsync();
    await Promise.all([first, remount]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("publishes bursts of reused metadata once rather than rebuilding summaries for every track", async () => {
    const store = new TrackArtistIdentitiesStore(vi.fn(), null);
    const listener = vi.fn();
    store.subscribe(listener);
    for (const uri of largeLibrary.slice(0, 50)) store.remember(uri, artists);
    expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
