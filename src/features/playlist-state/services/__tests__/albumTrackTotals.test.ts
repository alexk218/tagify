import { describe, expect, it, vi } from "vitest";
import {
  ALBUM_TRACK_TOTALS_STORAGE_KEY,
  AlbumTrackTotalsStore,
} from "../albumTrackTotals";

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
