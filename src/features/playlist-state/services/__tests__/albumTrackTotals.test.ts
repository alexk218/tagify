import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALBUM_TRACK_TOTALS_STORAGE_KEY,
  AlbumTrackTotalsStore,
} from "../albumTrackTotals";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
}

function createStore(
  overrides: Partial<ConstructorParameters<typeof AlbumTrackTotalsStore>[0]> = {},
) {
  const storage = createStorage();
  const dependencies = {
    lookupTotals: vi.fn(async (albumUris: string[]) => {
      return new Map(albumUris.map((albumUri, index) => [albumUri, index + 10]));
    }),
    lookupSingleTotal: vi.fn(async () => 12),
    pause: vi.fn(async () => undefined),
    storage,
    ...overrides,
  };

  return { store: new AlbumTrackTotalsStore(dependencies), dependencies, storage };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

const albumUris = (count: number) =>
  Array.from({ length: count }, (_, index) => `spotify:album:album${index}`);

describe("AlbumTrackTotalsStore", () => {
  it("reads saved album lengths and ignores damaged entries", () => {
    const storage = createStorage({
      [ALBUM_TRACK_TOTALS_STORAGE_KEY]: JSON.stringify({
        "spotify:album:kept": 12,
        "spotify:album:zero": 0,
        "spotify:album:fraction": 2.5,
        "spotify:playlist:other": 30,
      }),
    });
    const { store } = createStore({ storage });

    expect(store.getSnapshot()).toEqual({ "spotify:album:kept": 12 });
  });

  it("looks up unknown albums in groups of 20 and saves the answers", async () => {
    const { store, dependencies, storage } = createStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.request([...albumUris(25), "spotify:playlist:ignored"]);
    await vi.waitFor(() =>
      expect(store.getSnapshot()["spotify:album:album24"]).toBeDefined(),
    );

    expect(dependencies.lookupTotals).toHaveBeenCalledTimes(2);
    expect(vi.mocked(dependencies.lookupTotals).mock.calls[0][0]).toHaveLength(20);
    expect(vi.mocked(dependencies.lookupTotals).mock.calls[1][0]).toEqual(albumUris(25).slice(20));
    expect(store.getSnapshot()["spotify:album:album0"]).toBe(10);
    expect(store.getSnapshot()["spotify:album:album24"]).toBe(14);
    expect(JSON.parse(storage.values.get(ALBUM_TRACK_TOTALS_STORAGE_KEY)!)).toEqual(
      store.getSnapshot(),
    );
    expect(listener).toHaveBeenCalled();
  });

  it("does not ask Spotify twice about the same album in one session", async () => {
    const lookupTotals = vi.fn(async () => new Map<string, number>());
    const { store } = createStore({ lookupTotals });

    store.request(albumUris(3));
    await settle();
    store.request(albumUris(3));
    await settle();

    expect(lookupTotals).toHaveBeenCalledTimes(1);
  });

  it("falls back to a limited number of single lookups when batches fail", async () => {
    const lookupTotals = vi.fn(async () => null);
    const lookupSingleTotal = vi.fn(async () => 8);
    const { store } = createStore({ lookupTotals, lookupSingleTotal });

    store.request(albumUris(160));
    await vi.waitFor(() => expect(lookupSingleTotal).toHaveBeenCalledTimes(150));
    await settle();

    expect(lookupTotals).toHaveBeenCalledTimes(1);
    expect(lookupSingleTotal).toHaveBeenCalledTimes(150);
    expect(Object.keys(store.getSnapshot())).toHaveLength(150);
  });

  it("looks up whatever was asked for most recently first", async () => {
    const lookupSingleTotal = vi.fn(async (_albumUri: string) => 9);
    let releaseFirstBatch: (() => void) | undefined;
    const lookupTotals = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          releaseFirstBatch = () => resolve(null);
        }),
    );
    const { store } = createStore({ lookupTotals, lookupSingleTotal });

    store.request(["spotify:album:first"]);
    await settle();
    store.request(albumUris(3));
    store.request(["spotify:album:album2", "spotify:album:album0"]);
    releaseFirstBatch?.();
    await vi.waitFor(() => expect(lookupSingleTotal).toHaveBeenCalledTimes(4));

    expect(lookupSingleTotal.mock.calls.map(([albumUri]) => albumUri)).toEqual([
      "spotify:album:first",
      "spotify:album:album2",
      "spotify:album:album0",
      "spotify:album:album1",
    ]);
  });

  it("keeps remembered lengths when local storage is full", () => {
    const storage = createStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { store } = createStore({ storage });

    store.remember({ "spotify:album:full": 9 });

    expect(store.getSnapshot()).toEqual({ "spotify:album:full": 9 });
  });
});

it("drops queued counts supplied by a completed tracklist", async () => {
  let finish!: (value: Map<string, number>) => void;
  const lookupTotals = vi.fn(() => new Promise<Map<string, number>>(resolve => { finish = resolve; }));
  const { store } = createStore({ lookupTotals });
  store.request(["spotify:album:first"]); await settle();
  store.request(["spotify:album:second"]);
  store.remember({ "spotify:album:second": 20 });
  finish(new Map([["spotify:album:first", 10]])); await settle();
  expect(lookupTotals).toHaveBeenCalledTimes(1);
});
it("waits for a pending tracklist and only falls back when it fails", async () => {
  const { store, dependencies } = createStore();
  let finish!: (value: unknown[] | null) => void;
  store.waitForTrackList("spotify:album:shared", new Promise(resolve => { finish = resolve; }));
  store.request(["spotify:album:shared"]); await settle();
  expect(dependencies.lookupTotals).not.toHaveBeenCalled();
  finish(Array(12).fill({})); await settle();
  expect(store.getSnapshot()["spotify:album:shared"]).toBe(12);
  expect(dependencies.lookupTotals).not.toHaveBeenCalled();
  store.waitForTrackList("spotify:album:failed", Promise.reject(new Error("unavailable")));
  store.request(["spotify:album:failed"]); await settle();
  expect(dependencies.lookupTotals).toHaveBeenCalledOnce();
});
it("does not repeat empty count lookups after a reload", async () => {
  const lookupTotals = vi.fn().mockResolvedValue(new Map());
  const first = createStore({ lookupTotals });
  first.store.request(albumUris(20)); await settle();
  (globalThis as any).__tagifyBackgroundPolicyV1.clear();
  const second = createStore({ lookupTotals });
  second.store.request(albumUris(20)); await settle();
  expect(lookupTotals).toHaveBeenCalledOnce();
});

it("automatically retries a throttled count batch when its allowance returns", async () => {
  const lookupTotals = vi.fn().mockRejectedValueOnce({ status: 429, retryAfterSeconds: 1 })
    .mockResolvedValue(new Map([["spotify:album:retry", 12]]));
  const { store } = createStore({ lookupTotals });
  store.request(["spotify:album:retry"]); await settle();
  for (let i = 0; i < 20; i++) store.request(["spotify:album:retry"]);
  await vi.advanceTimersByTimeAsync(3_599_999);
  expect(lookupTotals).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(lookupTotals).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot()["spotify:album:retry"]).toBe(12);
  expect(vi.getTimerCount()).toBe(0);
});

it("retries counts deferred by a persisted pause without hot-looping", async () => {
  const { spotifyBackgroundPolicy } = await import("@/services/SpotifyBackgroundPolicy");
  spotifyBackgroundPolicy.throttled(1_000);
  const { store, dependencies } = createStore();
  store.request(albumUris(2)); await settle();
  await vi.advanceTimersByTimeAsync(119_999);
  expect(dependencies.lookupTotals).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(dependencies.lookupTotals).toHaveBeenCalledOnce();
  expect(Object.keys(store.getSnapshot())).toHaveLength(2);
});

it("keeps safety-deferred work and drops counts supplied by a foreground tracklist", async () => {
  const lookupTotals = vi.fn().mockRejectedValueOnce({ spotifyRequestStopped: true }).mockResolvedValue(new Map());
  const { store } = createStore({ lookupTotals });
  store.request(albumUris(2)); await settle();
  store.remember({ "spotify:album:album0": 15 });
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(lookupTotals.mock.calls[1][0]).toEqual(["spotify:album:album1"]);
  expect(store.getSnapshot()["spotify:album:album0"]).toBe(15);
});

it("bounds work per hour and eventually processes albums beyond the initial allowance", async () => {
  const { store, dependencies } = createStore();
  store.request(albumUris(220));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(dependencies.lookupTotals).toHaveBeenCalledTimes(10);
  expect(Object.keys(store.getSnapshot())).toHaveLength(200);
  await vi.advanceTimersByTimeAsync(3_590_000);
  expect(dependencies.lookupTotals).toHaveBeenCalledTimes(11);
  expect(Object.keys(store.getSnapshot())).toHaveLength(220);
  expect(vi.getTimerCount()).toBe(0);
});

it("resumes single lookups after a stop without repeating already resolved counts", async () => {
  const lookupSingleTotal = vi.fn().mockResolvedValueOnce(10).mockRejectedValueOnce({ spotifyRequestStopped: true }).mockResolvedValue(12);
  const { store } = createStore({ lookupTotals: vi.fn().mockResolvedValue(null), lookupSingleTotal });
  store.request(albumUris(3)); await settle();
  expect(lookupSingleTotal).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(lookupSingleTotal.mock.calls.map(([uri]) => uri)).toEqual([
    "spotify:album:album0", "spotify:album:album1", "spotify:album:album1", "spotify:album:album2",
  ]);
  expect(Object.keys(store.getSnapshot())).toHaveLength(3);
});
