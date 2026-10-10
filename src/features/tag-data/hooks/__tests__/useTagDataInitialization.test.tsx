import { act, useRef, useState } from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { OrchestratorResult } from "@/services/MigrationOrchestrator";
import { flushLocalPersistence } from "@/services/sync/SyncLocalState";
import type { TagDataStructure } from "@/types/tagData";
import { useTagDataInitialization } from "../useTagDataInitialization";
import { useTagDataPersistence } from "../useTagDataPersistence";

const { orchestrator, persistTagDataDiffMock, stopTrailingBackups } = vi.hoisted(() => ({
  orchestrator: { initialize: vi.fn(), retryIndexedDBMigration: vi.fn() },
  persistTagDataDiffMock: vi.fn(),
  stopTrailingBackups: vi.fn(),
}));

vi.mock("@/services/MigrationOrchestrator", () => ({ migrationOrchestrator: orchestrator }));
vi.mock("@/features/metadata-backfill", () => ({ runMetadataBackfillOnce: vi.fn().mockResolvedValue(0) }));
vi.mock("../../utils/tagData.persistence", () => ({ persistTagDataDiff: persistTagDataDiffMock }));
vi.mock("../../utils/tagData.backup", () => ({
  isAutomaticFileBackupDue: vi.fn(() => false),
  maybeDownloadAutomaticTagDataFileBackup: vi.fn(() => ({ status: "skipped", reason: "too-soon" })),
}));
vi.mock("../../utils/tagData.backupContents", () => ({
  readCompleteBackupContents: vi.fn().mockResolvedValue({}),
  startTrailingFileBackups: vi.fn(() => stopTrailingBackups),
}));
vi.mock("@/services/storage/IndexedDBStorageService", () => ({
  indexedDBStorage: { loadAll: vi.fn().mockResolvedValue(null) },
}));

const olderCopy: TagDataStructure = {
  ...defaultTagData,
  tracks: { "spotify:track:older": { rating: 2, energy: 0, bpm: null, tagIds: [], dateModified: 1 } },
};
const unavailable: OrchestratorResult = {
  success: false, fallbackMode: true, dataSource: "indexedDB", isFreshInstall: false,
  data: olderCopy, migrationsRun: [], trackCount: 1, error: "Tagify couldn't open your saved library.",
};

/** The page's startup and saving, wired the way useTagData wires them. */
function usePage() {
  const [tagData, setTagData] = useState<TagDataStructure>(defaultTagData);
  const [isLoading, setIsLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [orchestratorResult, setOrchestratorResult] = useState<OrchestratorResult | null>(null);
  const refs = {
    initRef: useRef(false),
    latestTagDataRef: useRef<TagDataStructure>(defaultTagData),
    saveTimeoutRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    pendingSaveRef: useRef<TagDataStructure | null>(null),
    skipNextAutoSaveRef: useRef(false),
    persistedDataRef: useRef<TagDataStructure | null>(null),
  };
  const { applyPersistedSnapshot } = useTagDataPersistence({
    tagData, isLoading, setTagData, setLastSaved: vi.fn(), ...refs,
  });
  const initialization = useTagDataInitialization({
    initRef: refs.initRef, setIsLoading, setStorageError, setMigrationProgress: vi.fn(), setOrchestratorResult,
    applyPersistedSnapshot, refreshPersistedTagData: vi.fn().mockResolvedValue(undefined),
  });
  const edit = (next: TagDataStructure) => {
    refs.latestTagDataRef.current = next;
    setTagData(next);
  };
  return { ...initialization, edit, tagData, storageError, orchestratorResult, persistedDataRef: refs.persistedDataRef };
}

describe("opening the library on the Tagify page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistTagDataDiffMock.mockResolvedValue(true);
  });

  it.each([
    ["reported as a failure", unavailable],
    // Earlier versions reported this as a success with an older copy as data.
    ["reported as working with limits", { ...unavailable, success: true }],
  ])("saves nothing while the saved library couldn't be opened (%s)", async (_name, opened) => {
    orchestrator.initialize.mockResolvedValue(opened);
    const { result } = renderHook(() => usePage());

    await act(async () => { await result.current.loadTagData(); });

    expect(result.current.persistedDataRef.current).toBeNull();
    expect(result.current.tagData.tracks).toEqual({});
    expect(result.current.orchestratorResult?.fallbackMode).toBe(true);

    const edited = { ...defaultTagData, tracks: { "spotify:track:new": { rating: 5, energy: 0, bpm: null, tagIds: [] } } };
    act(() => result.current.edit(edited));
    await act(async () => { await flushLocalPersistence(); });

    expect(persistTagDataDiffMock).not.toHaveBeenCalled();
  });

  it("passes the user's answer about an older copy on and shows the restored library", async () => {
    orchestrator.initialize.mockResolvedValue({ ...unavailable, olderCopy: { trackCount: 1 } });
    const restored: OrchestratorResult = {
      success: true, fallbackMode: false, dataSource: "indexedDB", isFreshInstall: false, data: olderCopy,
      migrationsRun: ["restoredOlderCopy"], trackCount: 1, restoredOlderCopy: true,
    };
    orchestrator.retryIndexedDBMigration.mockResolvedValue(restored);
    const { result } = renderHook(() => usePage());
    await act(async () => { await result.current.loadTagData(); });

    await act(async () => { await result.current.retryMigration({ olderCopy: "restore" }); });

    expect(orchestrator.retryIndexedDBMigration).toHaveBeenCalledWith(expect.any(Function), { olderCopy: "restore" });
    expect(result.current.persistedDataRef.current).toBe(olderCopy);
    expect(result.current.tagData).toBe(olderCopy);
    expect(result.current.storageError).toBeNull();
  });

  it("shows a plain message when opening fails outside of read-only mode", async () => {
    orchestrator.initialize.mockResolvedValue({ ...unavailable, fallbackMode: false, error: "Tagify couldn't find your saved library on this device." });
    const { result } = renderHook(() => usePage());

    await act(async () => { await result.current.loadTagData(); });

    expect(result.current.storageError).toBe("Tagify couldn't find your saved library on this device.");
    expect(result.current.persistedDataRef.current).toBeNull();
  });

  it("stops watching for trailing backups when the page closes", () => {
    const { unmount } = renderHook(() => usePage());
    unmount();
    expect(stopTrailingBackups).toHaveBeenCalledTimes(1);
  });
});
