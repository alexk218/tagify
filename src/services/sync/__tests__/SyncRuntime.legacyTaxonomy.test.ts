import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { getTagifyDatabaseName, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import { syncRuntime } from "../SyncRuntime";

const configuration: DesktopSyncConfiguration = {
  accountId: "legacy-taxonomy-account", libraryId: "legacy-taxonomy-library", deviceId: "legacy-taxonomy-device",
  apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
};

async function put(store: string, value: unknown) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(getTagifyDatabaseName());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    if (store === "categories") transaction.objectStore(store).clear();
    transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  setDesktopSyncConfiguration(configuration);
  expect(await storageService.switchAccountDatabase()).toBe(true);
});

afterEach(() => {
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Libraries saved by older Tagify versions keep tags in an older format.
// Showing another device's tags must keep this device's own tags.
it("keeps device-only tags when an older-format library shows tags from the cloud copy", async () => {
  await put("categories", { id: "categories", data: [{ id: "genre", name: "Genre", subcategories: [{ id: "main", name: "Main", tags: [{ id: "house", name: "House" }, { id: "bad id!", name: "Device only" }] }] }] });
  const node = (id: string, kind: string, parentId: string | null, name: string, position: number) => ({ id, kind, parentId, name, accentId: null, position, nodeRevision: 1, parentListRevision: 0, deleted: false });
  await put("sync-state", {
    key: "taxonomy-shadow", colors: {}, collections: {}, parentRevisions: {},
    nodes: { genre: node("genre", "category", null, "Genre", 0), main: node("main", "folder", "genre", "Main", 0), house: node("house", "tag", "main", "House", 0), techno: node("techno", "tag", "main", "Techno", 1) },
  });
  (syncRuntime as unknown as { taxonomyRefreshRequested: boolean }).taxonomyRefreshRequested = true;
  await (syncRuntime as unknown as { refreshDeviceTaxonomyAfterBackup(): Promise<void> }).refreshDeviceTaxonomyAfterBackup();

  const names = Object.values((await storageService.getTaxonomy()).tagsById).map((tag) => tag.name);
  expect(names).toEqual(expect.arrayContaining(["Techno", "Device only"]));
});
