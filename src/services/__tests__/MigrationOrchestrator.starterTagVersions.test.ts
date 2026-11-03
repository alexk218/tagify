import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStarterTaxonomy, defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageMigrationService } from "@/services/storage/StorageMigrationService";
import { migrationOrchestrator } from "../MigrationOrchestrator";

vi.mock("@/services/sync/SyncInstallRecovery", () => ({
  restoreDesktopSyncConfiguration: vi.fn().mockResolvedValue(null),
}));

const downloads = vi.fn();
const tagNames = (taxonomy: typeof defaultTagData.taxonomy) => Object.values(taxonomy.tagsById).map((tag) => tag.name).sort();

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

describe("refreshed starter tags", () => {
  it("are what a brand-new install starts with", async () => {
    const result = await migrationOrchestrator.initialize();

    expect(result).toMatchObject({ success: true, isFreshInstall: true });
    expect(tagNames(result.data.taxonomy)).toEqual(tagNames(defaultTagData.taxonomy));
    expect(tagNames(result.data.taxonomy)).toContain("Japanese");
  });

  it("leave an install that started with the 73 earlier starter tags as it was, and still treat it as new", async () => {
    // Tagify 3.3.3 saved its starter tags when Spotify started, before the page opened.
    expect((await storageMigrationService.migrate()).success).toBe(true);
    expect(await indexedDBStorage.saveAll({ ...structuredClone(defaultTagData), taxonomy: buildStarterTaxonomy(1) }, "migration")).toBe(true);
    indexedDBStorage.resetConnection();

    const result = await migrationOrchestrator.initialize();

    expect(result).toMatchObject({ success: true, isFreshInstall: true, trackCount: 0 });
    expect(tagNames(result.data.taxonomy)).toEqual(tagNames(buildStarterTaxonomy(1)));
    expect(tagNames(result.data.taxonomy)).toContain("Vintage");
    expect(tagNames((await indexedDBStorage.loadAll())!.taxonomy)).toEqual(tagNames(buildStarterTaxonomy(1)));
    expect(downloads).not.toHaveBeenCalled();
  });
});
