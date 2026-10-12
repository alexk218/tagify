import { IDBFactory } from "fake-indexeddb";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import type { ReplicaManifest } from "@/services/sync/SyncLocalState";
import { useStatsBaseline } from "../useStatsBaseline";

const track = (overrides: Partial<TrackData>): TrackData => ({ rating: 0, energy: 0, bpm: null, tagIds: [], ...overrides });
const library = (tracks: Record<string, TrackData>): TagDataStructure => ({ ...defaultTagData, tracks });

beforeEach(async () => {
  indexedDBStorage.resetConnection(); localStorage.clear(); localStorage.setItem("tagify:sync:account-id", "stats-baseline");
  vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init();
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("useStatsBaseline", () => {
  it("saves each tagged track's last-updated date the first time Stats opens, then keeps it", async () => {
    const first = library({
      "spotify:track:a": track({ tagIds: ["tag"], dateCreated: 100, dateModified: 500 }),
      "spotify:track:b": track({ rating: 4, dateCreated: 200 }),
      "spotify:track:empty": track({ dateCreated: 300, dateModified: 300 }),
    });
    const { result, rerender } = renderHook(({ data, enabled }) => useStatsBaseline(data, enabled), { initialProps: { data: first, enabled: false } });
    expect(result.current).toBeUndefined();
    rerender({ data: first, enabled: true });
    await waitFor(() => expect(result.current).not.toBeUndefined());
    expect(result.current?.dates).toEqual({ "spotify:track:a": 500, "spotify:track:b": 200 });

    // Editing afterwards doesn't move the saved dates, even after Tagify restarts.
    const edited = library({ ...first.tracks, "spotify:track:a": track({ tagIds: ["tag"], dateCreated: 100, dateModified: 9_000 }) });
    const { result: reopened } = renderHook(() => useStatsBaseline(edited, true));
    await waitFor(() => expect(reopened.current).not.toBeUndefined());
    expect(reopened.current?.dates["spotify:track:a"]).toBe(500);
  });

  it("refreshes an open Stats view when reconciliation aligns its date history", async () => {
    const data = library({ "spotify:track:aaaaaaaaaaaaaaaaaaaaaa": track({ rating: 4, dateCreated: 100, dateModified: 500 }) });
    await indexedDBStorage.saveAll(data);
    const { result } = renderHook(() => useStatsBaseline(data, true));
    await waitFor(() => expect(result.current?.dates["spotify:track:aaaaaaaaaaaaaaaaaaaaaa"]).toBe(500));
    const manifest: ReplicaManifest = { key: "replica-manifest", accountId: "stats-baseline", libraryId: "library-a", protocolVersion: 2, storageSchemaVersion: data.schemaVersion,
      appliedCursor: 1, snapshotChecksum: null, appStateAppliedAt: null, initializedAt: "2026-10-12T12:00:00Z", updatedAt: "2026-10-12T12:00:00Z" };
    await indexedDBStorage.replaceCloudReplica(data, manifest, [], [], [], { annotationDates: "canonical" });
    await waitFor(() => expect(result.current?.dates).toEqual({}));
    expect((await indexedDBStorage.loadAllStrict()).tracks["spotify:track:aaaaaaaaaaaaaaaaaaaaaa"].dateModified).toBe(500);
  });

  it("waits for a library with tracks before saving anything", async () => {
    const { result } = renderHook(() => useStatsBaseline(library({}), true));
    await waitFor(() => expect(result.current).toBeNull());
    expect(await indexedDBStorage.getStatsBaseline()).toBeNull();
  });

  it("falls back to first-tagged dates if the saved dates can't be read", async () => {
    vi.spyOn(indexedDBStorage, "getStatsBaseline").mockRejectedValue(new Error("unreadable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useStatsBaseline(library({ "spotify:track:a": track({ tagIds: ["tag"], dateCreated: 1 }) }), true));
    await waitFor(() => expect(result.current).toBeNull());
  });
});
