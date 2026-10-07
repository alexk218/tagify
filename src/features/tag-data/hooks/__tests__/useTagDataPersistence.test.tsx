import { act, createRef } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { flushLocalPersistence, setLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { useTagDataPersistence } from "../useTagDataPersistence";

const { persistTagDataDiffMock } = vi.hoisted(() => ({
  persistTagDataDiffMock: vi.fn(),
}));

vi.mock("../../utils/tagData.persistence", () => ({
  persistTagDataDiff: persistTagDataDiffMock,
}));

vi.mock("../../utils/tagData.backup", () => ({
  maybeDownloadAutomaticTagDataFileBackup: vi.fn(() => ({ status: "skipped" })),
}));

vi.mock("@/services/storage/IndexedDBStorageService", () => ({
  indexedDBStorage: { loadAll: vi.fn().mockResolvedValue(null) },
}));

describe("useTagDataPersistence recovery gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    persistTagDataDiffMock.mockResolvedValue(true);
    setLocalPersistencePaused(false);
  });

  afterEach(() => {
    setLocalPersistencePaused(false);
    (syncRuntime as unknown as { setStatus(status: "unlinked"): void }).setStatus("unlinked");
    vi.useRealTimers();
  });

  it("saves a new tag after Community connects but waits for a library choice", async () => {
    const initRef = { current: true };
    const latestTagDataRef = { current: defaultTagData };
    const saveTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
    const pendingSaveRef = { current: null as typeof defaultTagData | null };
    const skipNextAutoSaveRef = { current: true };
    const persistedDataRef = { current: defaultTagData };
    const changed = {
      ...defaultTagData,
      tracks: { "spotify:track:4uLU6hMCjMI75M1A2tKUQC": { rating: 5, energy: 0, bpm: null, camelotKey: null, tagIds: [] } },
    };
    const { rerender, unmount } = renderHook(
      ({ data }) => useTagDataPersistence({
        tagData: data, isLoading: false, initRef, latestTagDataRef,
        setTagData: vi.fn(), setLastSaved: vi.fn(), saveTimeoutRef, pendingSaveRef,
        skipNextAutoSaveRef, persistedDataRef,
      }),
      { initialProps: { data: defaultTagData } },
    );

    (syncRuntime as unknown as { setStatus(status: "recovery-available"): void }).setStatus("recovery-available");
    rerender({ data: changed });
    await act(async () => { unmount(); });

    expect(persistTagDataDiffMock).toHaveBeenCalledWith(defaultTagData, changed);
    expect(persistedDataRef.current).toBe(changed);
  });

  it("does not discard an edit during an atomic restore and saves it when storage resumes", async () => {
    const initRef = { current: true };
    const latestTagDataRef = { current: defaultTagData };
    const saveTimeoutRef = createRef<ReturnType<typeof setTimeout>>();
    saveTimeoutRef.current = null;
    const pendingSaveRef = { current: null };
    const skipNextAutoSaveRef = { current: true };
    const persistedDataRef = { current: defaultTagData };
    const changedOnce = { ...defaultTagData, tracks: { "spotify:track:blocked": { rating: 5, energy: 0, bpm: null, camelotKey: null, tagIds: [] } } };
    const changedTwice = { ...changedOnce, tracks: { ...changedOnce.tracks, "spotify:track:allowed": { rating: 4, energy: 0, bpm: null, camelotKey: null, tagIds: [] } } };

    const { rerender } = renderHook(
      ({ data }) => useTagDataPersistence({
        tagData: data,
        isLoading: false,
        initRef,
        latestTagDataRef,
        setTagData: vi.fn(),
        setLastSaved: vi.fn(),
        saveTimeoutRef,
        pendingSaveRef,
        skipNextAutoSaveRef,
        persistedDataRef,
      }),
      { initialProps: { data: defaultTagData } },
    );

    setLocalPersistencePaused(true);
    rerender({ data: changedOnce });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(persistTagDataDiffMock).not.toHaveBeenCalled();
    expect(pendingSaveRef.current).toBe(changedOnce);

    await act(async () => { setLocalPersistencePaused(false); await Promise.resolve(); });
    expect(persistTagDataDiffMock).toHaveBeenCalledWith(defaultTagData, changedOnce);
    rerender({ data: changedTwice });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(persistTagDataDiffMock).toHaveBeenCalledWith(changedOnce, changedTwice);
  });

  it("flushes a debounced edit before Sync Now reads the outbox", async () => {
    const initRef = { current: true };
    const latestTagDataRef = { current: defaultTagData };
    const saveTimeoutRef = createRef<ReturnType<typeof setTimeout>>();
    saveTimeoutRef.current = null;
    const pendingSaveRef = { current: null };
    const skipNextAutoSaveRef = { current: true };
    const persistedDataRef = { current: defaultTagData };
    const changed = {
      ...defaultTagData,
      tracks: { "spotify:track:4uLU6hMCjMI75M1A2tKUQC": { rating: 0, energy: 0, bpm: null, camelotKey: null, tagIds: ["tag_recovery3"] } },
    };

    const { rerender } = renderHook(
      ({ data }) => useTagDataPersistence({
        tagData: data,
        isLoading: false,
        initRef,
        latestTagDataRef,
        setTagData: vi.fn(),
        setLastSaved: vi.fn(),
        saveTimeoutRef,
        pendingSaveRef,
        skipNextAutoSaveRef,
        persistedDataRef,
      }),
      { initialProps: { data: defaultTagData } },
    );

    rerender({ data: changed });
    expect(persistTagDataDiffMock).not.toHaveBeenCalled();

    await act(async () => { await flushLocalPersistence(); });

    expect(persistTagDataDiffMock).toHaveBeenCalledWith(defaultTagData, changed);
    expect(persistedDataRef.current).toBe(changed);
  });

  it("saves a recent edit when Spotify navigates away from Tagify", async () => {
    const initRef = { current: true };
    const latestTagDataRef = { current: defaultTagData };
    const saveTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
    const pendingSaveRef = { current: null as typeof defaultTagData | null };
    const skipNextAutoSaveRef = { current: true };
    const persistedDataRef = { current: defaultTagData };
    const changed = {
      ...defaultTagData,
      tracks: { "spotify:track:4uLU6hMCjMI75M1A2tKUQC": { rating: 5, energy: 0, bpm: null, camelotKey: null, tagIds: [] } },
    };
    const { rerender, unmount } = renderHook(
      ({ data }) => useTagDataPersistence({
        tagData: data,
        isLoading: false,
        initRef,
        latestTagDataRef,
        setTagData: vi.fn(),
        setLastSaved: vi.fn(),
        saveTimeoutRef,
        pendingSaveRef,
        skipNextAutoSaveRef,
        persistedDataRef,
      }),
      { initialProps: { data: defaultTagData } },
    );

    rerender({ data: changed });
    expect(persistTagDataDiffMock).not.toHaveBeenCalled();

    await act(async () => { unmount(); });

    expect(persistTagDataDiffMock).toHaveBeenCalledWith(defaultTagData, changed);
  });

  it("rejects the persistence barrier when a pending edit cannot be saved", async () => {
    persistTagDataDiffMock.mockResolvedValueOnce(false);
    const initRef = { current: true };
    const latestTagDataRef = { current: defaultTagData };
    const saveTimeoutRef = createRef<ReturnType<typeof setTimeout>>();
    saveTimeoutRef.current = null;
    const pendingSaveRef = { current: null };
    const skipNextAutoSaveRef = { current: true };
    const persistedDataRef = { current: defaultTagData };
    const changed = { ...defaultTagData, tracks: { "spotify:track:4uLU6hMCjMI75M1A2tKUQC": { rating: 5, energy: 0, bpm: null, camelotKey: null, tagIds: [] } } };

    const { rerender } = renderHook(
      ({ data }) => useTagDataPersistence({
        tagData: data,
        isLoading: false,
        initRef,
        latestTagDataRef,
        setTagData: vi.fn(),
        setLastSaved: vi.fn(),
        saveTimeoutRef,
        pendingSaveRef,
        skipNextAutoSaveRef,
        persistedDataRef,
      }),
      { initialProps: { data: defaultTagData } },
    );

    rerender({ data: changed });

    await expect(act(async () => { await flushLocalPersistence(); })).rejects.toThrow("Failed to save pending changes");
    expect(persistedDataRef.current).toBe(defaultTagData);
    expect(pendingSaveRef.current).toBe(changed);
  });
});
