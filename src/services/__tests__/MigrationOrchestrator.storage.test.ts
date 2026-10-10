import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageMigrationService } from "@/services/storage/StorageMigrationService";
import { migrationOrchestrator } from "../MigrationOrchestrator";
import { getTagifyDatabaseName, TAGIFY_DATABASE_VERSION } from "@/services/sync/SyncLocalState";

// Recovering a linked device waits for Spotify sign-in; these devices are unlinked.
vi.mock("@/services/sync/SyncInstallRecovery", () => ({
  restoreDesktopSyncConfiguration: vi.fn().mockResolvedValue(null),
}));

const saved = `spotify:track:${"s".repeat(22)}`;
const older = `spotify:track:${"o".repeat(22)}`;
const track = (rating: number, dateModified: number): TrackData => ({ rating, energy: 0, bpm: 120, camelotKey: "8A", tagIds: [], name: "Song", artists: "Artist", dateModified });
const savedLibrary: TagDataStructure = { ...defaultTagData, tracks: { [saved]: track(5, 2_000) }, smartPlaylists: [] };
const olderCopy: TagDataStructure = { ...defaultTagData, tracks: { [older]: track(2, 1_000) }, smartPlaylists: [] };
const allMigrationsDone = {
  cleanupEmptyTracks: true, cleanupInlineEditorEmptyTracks: true, addTrackMetadata: true, removeTrackInfoCache: true, storageToIndexedDB: true,
};

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll(savedLibrary)).toBe(true);
  indexedDBStorage.resetConnection();
  // Nearly every install still keeps the copy from before the library moved.
  localStorage.setItem("tagify:tagData", JSON.stringify(olderCopy));
});

afterEach(() => {
  vi.restoreAllMocks();
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function savedTracks(): Promise<string[]> {
  return Object.keys((await indexedDBStorage.loadAllStrict()).tracks);
}

describe.each([
  ["after the library moved", { version: "3.0.0", migrations: allMigrationsDone }],
  ["when the record of the move was lost", null],
])("opening the saved library %s", (_name, migrationState) => {
  beforeEach(() => {
    if (migrationState) localStorage.setItem("tagify:migrations", JSON.stringify(migrationState));
  });

  it("never replaces it with the older copy when the first open fails", async () => {
    vi.spyOn(indexedDBStorage, "init").mockResolvedValueOnce(false);

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(true);
    expect(Object.keys(result.data.tracks)).toEqual([saved]);
    expect(await savedTracks()).toEqual([saved]);
    expect((await indexedDBStorage.loadAllStrict()).tracks[saved].dateModified).toBe(2_000);
  });

  it("stays unsaved while it can't be opened, then opens it unchanged", async () => {
    const init = vi.spyOn(indexedDBStorage, "init").mockResolvedValue(false);

    const unavailable = await migrationOrchestrator.initialize();

    expect(unavailable).toMatchObject({ success: false, fallbackMode: true });
    expect(unavailable.data.tracks).toEqual({});
    init.mockRestore();
    expect(await savedTracks()).toEqual([saved]);

    const retried = await migrationOrchestrator.retryIndexedDBMigration();

    expect(retried).toMatchObject({ success: true, fallbackMode: false });
    expect(Object.keys(retried.data.tracks)).toEqual([saved]);
    expect(await savedTracks()).toEqual([saved]);
  });
});

describe("the background start of an older copy", () => {
  it("never moves an older copy over a library it couldn't read at first", async () => {
    vi.spyOn(indexedDBStorage, "init").mockResolvedValueOnce(false);

    const result = await storageMigrationService.migrate();

    expect(result.success).toBe(false);
    expect(await savedTracks()).toEqual([saved]);
  });

  it("never moves an older copy over a library after an earlier attempt failed", async () => {
    localStorage.setItem("tagify:idb-migration-status", JSON.stringify({ status: "failed", error: "earlier failure" }));

    const result = await storageMigrationService.migrate();

    expect(result).toMatchObject({ success: true, status: "completed", tracksMigrated: 1 });
    expect(await savedTracks()).toEqual([saved]);
  });

  it("finishes moving an older-format copy into an empty library", async () => {
    expect(await indexedDBStorage.clearAll()).toBe(true);
    localStorage.setItem("tagify:tagData", JSON.stringify({
      categories: [{ id: "genre", name: "Genre", subcategories: [{ id: "electronic", name: "Electronic", tags: [{ id: "house", name: "House" }] }] }],
      tracks: { [older]: { rating: 3, energy: 0, bpm: null, tags: [], dateModified: 1_000 } },
    }));

    const result = await storageMigrationService.migrate();

    expect(result).toMatchObject({ success: true, status: "completed", tracksMigrated: 1, categoriesMigrated: 1 });
    expect(JSON.parse(localStorage.getItem("tagify:idb-migration-status") || "{}").status).toBe("completed");
    expect((await indexedDBStorage.loadAllStrict()).tracks[older]).toMatchObject({ rating: 3, dateModified: 1_000 });
  });
});

// While Tagify asks about an older copy, edits in Spotify's views wait. If a
// change still lands first, choosing Restore keeps it and says so.
describe("choosing to restore an older copy into an empty library", () => {
  beforeEach(async () => {
    localStorage.setItem("tagify:migrations", JSON.stringify({ version: "3.0.0", migrations: allMigrationsDone }));
    // A Spotify update cleared the saved library; only the older copy is left.
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("holds edits from Spotify's views until the user answers", async () => {
    const { saveTrackEdits } = await import("@/extensions/extensionEdits");
    const asked = await migrationOrchestrator.initialize();
    expect(asked.olderCopy).toEqual({ trackCount: 1 });
    await expect(saveTrackEdits([saved], { rating: 4 })).rejects.toThrow("Choose how to open your library in Tagify first, then try that again.");

    const restored = await migrationOrchestrator.initialize(undefined, { olderCopy: "restore" });
    expect(restored.restoredOlderCopy).toBe(true);
    expect(await savedTracks()).toEqual([older]);
    expect(localStorage.getItem("tagify:libraryChoicePending")).toBeNull();
  });

  it("keeps changes saved before the answer and reports that the older copy wasn't restored", async () => {
    expect((await migrationOrchestrator.initialize()).olderCopy).toEqual({ trackCount: 1 });
    expect(await indexedDBStorage.init()).toBe(true);
    expect(await indexedDBStorage.saveTracks(new Map([[saved, track(4, 3_000)]]))).toBe(true);
    indexedDBStorage.resetConnection();

    const result = await migrationOrchestrator.initialize(undefined, { olderCopy: "restore" });

    expect(result).toMatchObject({ success: true, olderCopyNotRestored: true, restoredOlderCopy: false });
    expect(await savedTracks()).toEqual([saved]);
  });
});

describe("opening a library saved by a newer Tagify", () => {
  it("reports it at once and leaves the library and the older copy untouched", async () => {
    // A newer Tagify upgraded the database; older code asks for a lower version.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(getTagifyDatabaseName(), TAGIFY_DATABASE_VERSION + 1);
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const init = vi.spyOn(indexedDBStorage, "init");
    localStorage.setItem("tagify:migrations", JSON.stringify({ version: "3.0.0", migrations: allMigrationsDone }));

    const result = await migrationOrchestrator.initialize();

    expect(result.fallbackMode).toBe(true);
    expect(result.fallbackReason).toBe("VersionError");
    expect(init).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("tagify:tagData")!)).toEqual(olderCopy);
  });
});
