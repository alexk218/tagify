import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure } from "@/types/tagData";
import { useTagData } from "../useTagData";

const uri = `spotify:track:${"a".repeat(22)}`;
const library: TagDataStructure = {
  ...JSON.parse(JSON.stringify(defaultTagData)),
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  tracks: {
    [uri]: {
      name: "Slide", artists: "Low", rating: 4, energy: 0, bpm: null,
      tagIds: ["rock", "pop", "jazz"], dateCreated: 1_000, dateModified: 1_000,
    },
  },
};

const settle = (milliseconds = 300) => act(() => new Promise((resolve) => setTimeout(resolve, milliseconds)));
const showSyncedChanges = () => act(() => {
  window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "sync", origin: "remote" } }));
});

describe("showing synced changes while tagging", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.clear();
    expect(await indexedDBStorage.init()).toBe(true);
    expect(await indexedDBStorage.saveAll(library)).toBe(true);
    localStorage.setItem("tagify:migrationCompleted", "true");
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Community echoes every backed-up edit. Reloading a large library takes a
  // moment, and a tag added during that moment must not be rolled back.
  it("keeps tags added while the library reloads", { timeout: 20_000 }, async () => {
    const { result } = renderHook(() => useTagData());
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });

    const load = indexedDBStorage.loadAllStrict.bind(indexedDBStorage);
    let finishLoading!: () => void;
    const slowLoad = new Promise<void>((resolve) => { finishLoading = resolve; });
    const loadAll = vi.spyOn(indexedDBStorage, "loadAllStrict").mockImplementation(async () => {
      const saved = await load();
      await slowLoad;
      return saved;
    });

    await showSyncedChanges();
    await waitFor(() => expect(loadAll).toHaveBeenCalled());
    await act(async () => { await result.current.toggleTagSingleTrack(uri, "classical"); });
    await settle();
    finishLoading();
    await settle();
    loadAll.mockRestore();

    expect(result.current.tagData.tracks[uri].tagIds).toEqual(["rock", "pop", "jazz", "classical"]);

    await act(async () => { await result.current.toggleTagSingleTrack(uri, "country"); });
    await settle();

    expect(result.current.tagData.tracks[uri].tagIds).toEqual(["rock", "pop", "jazz", "classical", "country"]);
    expect((await indexedDBStorage.loadAllStrict()).tracks[uri].tagIds).toEqual(["rock", "pop", "jazz", "classical", "country"]);
  });

  it("applies overlapping reloads in order", { timeout: 20_000 }, async () => {
    const { result } = renderHook(() => useTagData());
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });

    const load = indexedDBStorage.loadAllStrict.bind(indexedDBStorage);
    const releases: Array<() => void> = [];
    const loadAll = vi.spyOn(indexedDBStorage, "loadAllStrict").mockImplementation(async () => {
      const saved = await load();
      await new Promise<void>((resolve) => releases.push(resolve));
      return saved;
    });

    await showSyncedChanges();
    await waitFor(() => expect(releases).toHaveLength(1));
    await act(async () => { await result.current.toggleTagSingleTrack(uri, "classical"); });
    await settle();
    await showSyncedChanges();
    await settle();
    // Finish the newer reload first, then the one that started before the edit.
    for (const release of [...releases].reverse()) release();
    await settle();
    releases.splice(0).forEach((release) => release());
    await settle();
    loadAll.mockRestore();

    expect(result.current.tagData.tracks[uri].tagIds).toEqual(["rock", "pop", "jazz", "classical"]);
    expect((await indexedDBStorage.loadAllStrict()).tracks[uri].tagIds).toEqual(["rock", "pop", "jazz", "classical"]);
  });

  // A keyboard rating saved by the extension can arrive while a tag added on
  // this page is still waiting to be saved. Both must be kept.
  it("keeps an unsaved tag when the extension saves another song", { timeout: 20_000 }, async () => {
    const other = `spotify:track:${"z".repeat(22)}`;
    const { result } = renderHook(() => useTagData());
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });

    await act(async () => {
      await result.current.toggleTagSingleTrack(uri, "classical");
      const rated = { name: "Other", artists: "Artist", rating: 5, energy: 0, bpm: null, tagIds: [], dateCreated: 2_000, dateModified: 2_000 };
      await indexedDBStorage.saveTrack(other, rated);
      result.current.applyShortcutTrackUpdate(other, rated);
    });
    await settle();

    const saved = await indexedDBStorage.loadAllStrict();
    expect(saved.tracks[uri].tagIds).toEqual(["rock", "pop", "jazz", "classical"]);
    expect(saved.tracks[other].rating).toBe(5);
    expect(result.current.tagData.tracks[uri].tagIds).toEqual(["rock", "pop", "jazz", "classical"]);
    expect(result.current.tagData.tracks[other].rating).toBe(5);
  });
});
