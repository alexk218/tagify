import { act, createRef } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { flushLocalPersistence, setLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { useTagDataPersistence } from "../useTagDataPersistence";
import { isAutomaticFileBackupDue } from "../../utils/tagData.backup";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";

const { persistTagDataDiffMock } = vi.hoisted(() => ({
  persistTagDataDiffMock: vi.fn(),
}));

vi.mock("../../utils/tagData.persistence", () => ({
  persistTagDataDiff: persistTagDataDiffMock,
}));

vi.mock("../../utils/tagData.backup", () => ({
  isAutomaticFileBackupDue: vi.fn(() => true),
  maybeDownloadAutomaticTagDataFileBackup: vi.fn(() => ({ status: "skipped" })),
}));

vi.mock("../../utils/tagData.backupContents", () => ({ readCompleteBackupContents: vi.fn().mockResolvedValue({}) }));

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

  // Reading and packing the whole library made every tag click lag; it only
  // runs when a backup file is actually due.
  it("does not read the library for a backup file after each save unless one is due", async () => {
    vi.mocked(isAutomaticFileBackupDue).mockReturnValue(false);
    const latestTagDataRef = { current: defaultTagData };
    const changed = { ...defaultTagData, tracks: { first: { rating: 4, energy: 0, bpm: null, tagIds: [] } } };
    renderHook(() => useTagDataPersistence({ tagData: defaultTagData, isLoading: false, initRef: { current: true }, latestTagDataRef, setTagData: vi.fn(), setLastSaved: vi.fn(), saveTimeoutRef: { current: null }, pendingSaveRef: { current: null }, skipNextAutoSaveRef: { current: false }, persistedDataRef: { current: defaultTagData } }));
    latestTagDataRef.current = changed;
    await act(async () => { await flushLocalPersistence(); });
    expect(persistTagDataDiffMock).toHaveBeenCalledTimes(1);
    expect(indexedDBStorage.loadAll).not.toHaveBeenCalled();
    vi.mocked(isAutomaticFileBackupDue).mockReturnValue(true);
  });

  // When the saved library couldn't be opened, edits can't be saved. The user
  // is told instead of the change silently disappearing later.
  it("says an edit wasn't saved while the library can't be opened", async () => {
    const changed = { ...defaultTagData, tracks: { first: { rating: 4, energy: 0, bpm: null, tagIds: [] } } };
    const options = { isLoading: false, initRef: { current: true }, latestTagDataRef: { current: defaultTagData }, setTagData: vi.fn(), setLastSaved: vi.fn(), saveTimeoutRef: { current: null }, pendingSaveRef: { current: null }, skipNextAutoSaveRef: { current: false }, persistedDataRef: { current: null } };
    const { rerender } = renderHook(({ data }) => useTagDataPersistence({ ...options, tagData: data }), { initialProps: { data: defaultTagData } });
    expect(Spicetify.showNotification).not.toHaveBeenCalled();
    rerender({ data: changed });
    expect(Spicetify.showNotification).toHaveBeenCalledWith(expect.stringContaining("that change wasn't saved"), true);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(persistTagDataDiffMock).not.toHaveBeenCalled();
  });

  it("flushes the latest optimistic edit before React schedules its persistence effect", async () => {
    const latestTagDataRef = { current: defaultTagData };
    const changed = { ...defaultTagData, tracks: { first: { rating: 4, energy: 0, bpm: null, tagIds: [] } } };
    const persistedDataRef = { current: defaultTagData };
    renderHook(() => useTagDataPersistence({ tagData: defaultTagData, isLoading: false, initRef: { current: true }, latestTagDataRef, setTagData: vi.fn(), setLastSaved: vi.fn(), saveTimeoutRef: { current: null }, pendingSaveRef: { current: null }, skipNextAutoSaveRef: { current: false }, persistedDataRef }));
    latestTagDataRef.current = changed;
    await act(async () => { await flushLocalPersistence(); });
    expect(persistTagDataDiffMock).toHaveBeenCalledTimes(1);
    expect(persistTagDataDiffMock).toHaveBeenCalledWith(defaultTagData, changed);
    expect(persistedDataRef.current).toBe(changed);
  });

  it("persists an edit batched with a refreshed taxonomy snapshot", async () => {
    const changed = { ...defaultTagData, tracks: { "spotify:track:new": { rating: 0, energy: 0, bpm: null, tagIds: ["created-tag"] } } };
    const persistedDataRef = { current: defaultTagData };
    renderHook(() => useTagDataPersistence({
      tagData: changed, isLoading: false, initRef: { current: true },
      latestTagDataRef: { current: changed }, setTagData: vi.fn(), setLastSaved: vi.fn(),
      saveTimeoutRef: { current: null }, pendingSaveRef: { current: null },
      skipNextAutoSaveRef: { current: true }, persistedDataRef,
    }));
    await act(async () => { await flushLocalPersistence(); });
    expect(persistTagDataDiffMock).toHaveBeenCalledWith(defaultTagData, changed);
  });

  it("does not replace a newer optimistic edit with an older render's pending snapshot", async () => {
    const latestTagDataRef = { current: defaultTagData };
    const older = { ...defaultTagData, tracks: { first: { rating: 4, energy: 0, bpm: null, tagIds: [] } } };
    const newest = { ...older, tracks: { first: { ...older.tracks.first, energy: 7 } } };
    const persistedDataRef = { current: defaultTagData };
    const options = { isLoading: false, initRef: { current: true }, latestTagDataRef, setTagData: vi.fn(), setLastSaved: vi.fn(), saveTimeoutRef: { current: null }, pendingSaveRef: { current: null }, skipNextAutoSaveRef: { current: false }, persistedDataRef };
    const { rerender } = renderHook(({ data }) => useTagDataPersistence({ ...options, tagData: data }), { initialProps: { data: defaultTagData } });
    latestTagDataRef.current = newest;
    rerender({ data: older });
    await act(async () => { await flushLocalPersistence(); });
    expect(persistTagDataDiffMock).toHaveBeenCalledTimes(1);
    expect(persistTagDataDiffMock).toHaveBeenCalledWith(defaultTagData, newest);
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
