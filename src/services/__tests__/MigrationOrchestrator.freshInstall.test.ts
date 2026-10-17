import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageMigrationService } from "@/services/storage/StorageMigrationService";
import { migrationOrchestrator } from "../MigrationOrchestrator";

vi.mock("@/services/sync/SyncInstallRecovery", () => ({
  restoreDesktopSyncConfiguration: vi.fn().mockResolvedValue(null),
}));

const downloads = vi.fn();

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  downloads.mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(downloads);
});

afterEach(() => {
  vi.restoreAllMocks();
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("a brand-new install", () => {
  it("opens without library-upgrade news or a backup when Spotify's background start saved the starting tags first", async () => {
    // The extension starts with Spotify, before the Tagify page is opened.
    expect((await storageMigrationService.migrate()).success).toBe(true);
    indexedDBStorage.resetConnection();

    const result = await migrationOrchestrator.initialize();

    expect(result).toMatchObject({ success: true, isFreshInstall: true, trackCount: 0 });
    expect(result.data.taxonomy.categoryOrder.length).toBeGreaterThan(0);
    expect(downloads).not.toHaveBeenCalled();
    expect(migrationOrchestrator.needsMigrations()).toBe(false);
  });

  it("opens without library-upgrade news or a backup when the page opens first", async () => {
    const result = await migrationOrchestrator.initialize();

    expect(result).toMatchObject({ success: true, isFreshInstall: true });
    expect(downloads).not.toHaveBeenCalled();
  });

  it("opens fresh when an earlier start stopped after keeping only the starting tags on this device", async () => {
    // A first start that stopped before the library moved left only defaults behind.
    await migrationOrchestrator.initialize();
    indexedDBStorage.resetConnection();
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.removeItem("tagify:migrations");
    downloads.mockClear();

    const result = await migrationOrchestrator.initialize();

    expect(result).toMatchObject({ success: true, isFreshInstall: true });
    expect(downloads).not.toHaveBeenCalled();
  });
});
