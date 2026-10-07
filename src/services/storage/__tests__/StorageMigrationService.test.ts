import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";

const { indexedDBStorageMock } = vi.hoisted(() => ({
  indexedDBStorageMock: {
    init: vi.fn(),
    saveAll: vi.fn(),
    getTrackCount: vi.fn(),
    getPlaylistCount: vi.fn(),
    getArtistCount: vi.fn(),
    getAllSmartPlaylists: vi.fn(),
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
    indexedDBStorageMock.getPlaylistCount.mockResolvedValue(0);
    indexedDBStorageMock.getArtistCount.mockResolvedValue(0);
    indexedDBStorageMock.getAllSmartPlaylists.mockResolvedValue([]);
  });

  it("does not replace existing smart-playlist rules with an old browser backup", async () => {
    window.localStorage.setItem("tagify:tagData", JSON.stringify({
      tracks: { "spotify:track:old": { tagIds: ["old"] } },
    }));
    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    indexedDBStorageMock.getAllSmartPlaylists.mockResolvedValue([{ id: "alt", isActive: true }]);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue(createEmptyTaxonomy());

    const result = await storageMigrationService.migrate();

    expect(result.success).toBe(true);
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
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

  it("leaves a paired wiped replica empty instead of migrating stale localStorage", async () => {
    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({ migrations: { storageToIndexedDB: true } }),
    );
    window.localStorage.setItem(
      "tagify:sync:configuration",
      JSON.stringify({
        accountId: "account-a",
        libraryId: "library-a",
        deviceId: "device-a",
        apiBaseUrl: "https://community.example.test",
      }),
    );
    window.localStorage.setItem(
      "tagify:tagData",
      JSON.stringify({
        tracks: { "spotify:track:stale": { tagIds: ["legacy"] } },
      }),
    );
    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue(createEmptyTaxonomy());

    const result = await storageMigrationService.migrate();

    expect(result.success).toBe(true);
    expect(result.tracksMigrated).toBe(0);
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
  });
});
