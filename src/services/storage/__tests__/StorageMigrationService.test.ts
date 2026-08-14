import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";

const { indexedDBStorageMock } = vi.hoisted(() => ({
  indexedDBStorageMock: {
    init: vi.fn(),
    saveAll: vi.fn(),
    getTrackCount: vi.fn(),
    getTaxonomy: vi.fn(),
  },
}));

vi.mock("@/services/storage/IndexedDBStorageService", () => ({
  indexedDBStorage: indexedDBStorageMock,
}));

import { storageMigrationService } from "../StorageMigrationService";

describe("StorageMigrationService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("adopts existing IndexedDB data instead of overwriting it with defaults", async () => {
    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(42);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue({
      ...createEmptyTaxonomy(),
      categoryOrder: ["genre-style"],
    });

    const result = await storageMigrationService.migrate();

    expect(result.success).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.tracksMigrated).toBe(42);
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();

    expect(
      JSON.parse(
        window.localStorage.getItem("tagify:idb-migration-status") || "{}",
      ),
    ).toMatchObject({
      status: "completed",
      trackCount: 42,
      categoryCount: 1,
    });
  });

  it("fails safely when IndexedDB was previously migrated but is now empty", async () => {
    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({
        migrations: {
          storageToIndexedDB: true,
        },
      }),
    );

    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue(createEmptyTaxonomy());

    const result = await storageMigrationService.migrate();

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("did not overwrite the database with defaults");
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
  });
});
