import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibrarySnapshotV2 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { isLocalPersistencePaused, isSyncCaptureEnabled, registerLocalPersistenceFlusher, setDesktopSyncConfiguration, setLocalPersistencePaused, type DesktopSyncConfiguration } from "../SyncLocalState";
import { sameInitialMergeDeviceContent, syncRuntime, type SyncStatus } from "../SyncRuntime";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";

function setSyncStatus(status: SyncStatus): void {
  (syncRuntime as unknown as { setStatus(status: SyncStatus): void }).setStatus(status);
}

describe("Community sync persistence safety", () => {
  afterEach(() => {
    setLocalPersistencePaused(false);
    setSyncStatus("unlinked");
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps device saves enabled when cloud backup requires a snapshot", () => {
    setLocalPersistencePaused(false);

    setSyncStatus("snapshot-required");

    expect(isLocalPersistencePaused()).toBe(false);
  });

  it("keeps device saves enabled while a Community recovery choice is pending", () => {
    setSyncStatus("recovery-available");
    expect(isLocalPersistencePaused()).toBe(false);

    setSyncStatus("snapshot-required");

    expect(isLocalPersistencePaused()).toBe(false);
  });

  it("keeps device saves enabled while a library-merge choice is pending", () => {
    setLocalPersistencePaused(false);
    setDesktopSyncConfiguration({
      accountId: "account", libraryId: "library", deviceId: "device", apiBaseUrl: "https://community.example",
      supabaseUrl: "https://supabase.example", supabasePublishableKey: "key", accessToken: "token",
      refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    });

    setSyncStatus("merge-required");

    expect(isLocalPersistencePaused()).toBe(false);
    expect(isSyncCaptureEnabled()).toBe(true);
  });

  it("resumes device saves after a cloud-restore failure", () => {
    setSyncStatus("restoring");
    expect(isLocalPersistencePaused()).toBe(true);
    setSyncStatus("restore-failed");
    expect(isLocalPersistencePaused()).toBe(false);
  });

  it("saves a pending device edit before applying a Community update", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const configuration: DesktopSyncConfiguration = {
      accountId: "persistence-account", libraryId: "persistence-library", deviceId: "persistence-device",
      apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    };
    setDesktopSyncConfiguration(configuration);
    expect(await storageService.switchAccountDatabase()).toBe(true);
    const order: string[] = [];
    const unregister = registerLocalPersistenceFlusher(async () => { order.push("device-save"); });
    const onRemoteUpdate = (event: Event) => {
      if ((event as CustomEvent<{ origin?: string }>).detail?.origin === "remote") order.push("community-update");
    };
    window.addEventListener("tagify:dataUpdated", onRemoteUpdate);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull")
        ? { batches: [{ cursor: 1, batchId: "remote-batch", operations: [], committedAt: new Date().toISOString() }], headCursor: 1, conflicts: [] }
        : {},
    ), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await (syncRuntime as unknown as { pull(configuration: DesktopSyncConfiguration): Promise<boolean> }).pull(configuration);
      expect(order).toEqual(["device-save", "community-update"]);
    } finally {
      unregister();
      window.removeEventListener("tagify:dataUpdated", onRemoteUpdate);
    }
  });

  it("keeps a locally changed rating visible while pulling an older Community rating", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const configuration: DesktopSyncConfiguration = {
      accountId: "dirty-track-account", libraryId: "dirty-track-library", deviceId: "dirty-track-device",
      apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    };
    setDesktopSyncConfiguration(configuration);
    expect(await storageService.switchAccountDatabase()).toBe(true);
    const uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
    expect(await indexedDBStorage.saveTrack(uri, {
      rating: 5, energy: 0, bpm: null, camelotKey: null, tagIds: ["tag_dreamy"], dateModified: 1_000,
    })).toBe(true);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull")
        ? {
          batches: [{ cursor: 1, batchId: "older-rating", committedAt: new Date().toISOString(), operations: [{
            type: "annotation.patch", operationId: crypto.randomUUID(), origin: "desktop",
            entity: { provider: "spotify", kind: "track", providerId: "4uLU6hMCjMI75M1A2tKUQC" },
            fields: { rating: 1 }, expectedRevisions: { rating: 0 },
          }, {
            type: "annotation.tag-membership", operationId: crypto.randomUUID(), origin: "desktop",
            entity: { provider: "spotify", kind: "track", providerId: "4uLU6hMCjMI75M1A2tKUQC" },
            tagId: "tag_dreamy", present: false, expectedRevision: 0,
          }] }], headCursor: 1, conflicts: [],
        }
        : {},
    ), { status: 200, headers: { "content-type": "application/json" } }));

    await (syncRuntime as unknown as { pull(configuration: DesktopSyncConfiguration): Promise<boolean> }).pull(configuration);

    expect((await indexedDBStorage.getTrack(uri))?.rating).toBe(5);
    expect((await indexedDBStorage.getTrack(uri))?.tagIds).toEqual(["tag_dreamy"]);
    expect((await indexedDBStorage.getTrack(uri))?.dateModified).toBe(1_000);
  });

  it("does not disable device-save capture while applying a Community update", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const configuration: DesktopSyncConfiguration = {
      accountId: "concurrent-save-account", libraryId: "concurrent-save-library", deviceId: "concurrent-save-device",
      apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    };
    setDesktopSyncConfiguration(configuration);
    expect(await storageService.switchAccountDatabase()).toBe(true);
    const originalSave = storageService.saveTrack.bind(storageService);
    const captureStates: boolean[] = [];
    vi.spyOn(storageService, "saveTrack").mockImplementation(async (uri, data, options) => {
      if (options?.captureSync === false) captureStates.push(isSyncCaptureEnabled());
      return originalSave(uri, data, options);
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull")
        ? {
          batches: [{ cursor: 1, batchId: "community-rating", committedAt: new Date().toISOString(), operations: [{
            type: "annotation.patch", operationId: crypto.randomUUID(), origin: "desktop",
            entity: { provider: "spotify", kind: "track", providerId: "4uLU6hMCjMI75M1A2tKUQC" },
            fields: { rating: 1 }, expectedRevisions: { rating: 0 },
          }] }], headCursor: 1, conflicts: [],
        }
        : {},
    ), { status: 200, headers: { "content-type": "application/json" } }));

    await (syncRuntime as unknown as { pull(configuration: DesktopSyncConfiguration): Promise<boolean> }).pull(configuration);

    expect(captureStates).toEqual([true]);
    expect((await indexedDBStorage.getTrack("spotify:track:4uLU6hMCjMI75M1A2tKUQC"))?.rating).toBe(1);
  });

  it("keeps tag provenance and color dates when another device renames a category", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const configuration: DesktopSyncConfiguration = {
      accountId: "taxonomy-metadata-account", libraryId: "taxonomy-metadata-library", deviceId: "taxonomy-metadata-device",
      apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    };
    setDesktopSyncConfiguration(configuration);
    expect(await storageService.switchAccountDatabase()).toBe(true);
    const taxonomy = createEmptyTaxonomy();
    taxonomy.categoryOrder = ["genre"];
    taxonomy.categoriesById.genre = { id: "genre", name: "Genre", subcategoryIds: [], childIds: ["house"] };
    taxonomy.childrenByParentId = { genre: ["house"] };
    taxonomy.tagsById.house = {
      id: "house", name: "House", parentId: "genre", subcategoryId: "genre", accentId: "custom:warm",
      source: { type: "community", publicTagKey: "house-key", publicTagName: "House", importedAt: "2026-01-01T00:00:00.000Z" },
    };
    taxonomy.customAccentsById["custom:warm"] = { id: "custom:warm", name: "Warm", color: "#ff8800", themeId: "sunset", createdAt: 11, updatedAt: 22 };
    taxonomy.colorThemesById.sunset = { id: "sunset", name: "Sunset", colorIds: ["custom:warm"], createdAt: 33, updatedAt: 44 };
    taxonomy.colorThemeOrder = ["sunset"];
    expect(await storageService.saveTaxonomy(taxonomy, { captureSync: false })).toBe(true);
    const node = (id: string, kind: "category" | "tag", parentId: string | null, name: string, accentId: string | null) =>
      ({ id, kind, parentId, name, accentId, position: 0, nodeRevision: 1, parentListRevision: 0, deleted: false });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`tagify-db:${configuration.accountId}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("sync-state", "readwrite");
      transaction.objectStore("sync-state").put({
        key: "taxonomy-shadow",
        nodes: { genre: node("genre", "category", null, "Genre", null), house: node("house", "tag", "genre", "House", "custom:warm") },
        colors: { "custom:warm": { id: "custom:warm", name: "Warm", color: "#ff8800", revision: 1, deleted: false } },
        collections: { sunset: { id: "sunset", name: "Sunset", colorIds: ["custom:warm"], position: 0, revision: 1, deleted: false } },
        parentRevisions: { __root__: 1, genre: 1 },
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull")
        ? {
          batches: [{ cursor: 1, batchId: "rename-category", committedAt: new Date().toISOString(), operations: [{
            type: "taxonomy.upsert", operationId: crypto.randomUUID(), origin: "web",
            node: { id: "genre", kind: "category", parentId: null, name: "Genres", accentId: null, position: 0 },
            expectedNodeRevision: 1, expectedParentListRevision: 1,
          }] }], headCursor: 1, conflicts: [],
        }
        : {},
    ), { status: 200, headers: { "content-type": "application/json" } }));

    await (syncRuntime as unknown as { pull(configuration: DesktopSyncConfiguration): Promise<boolean> }).pull(configuration);

    const saved = await storageService.getTaxonomy();
    expect(saved.categoriesById.genre.name).toBe("Genres");
    expect(saved.tagsById.house.source?.publicTagKey).toBe("house-key");
    expect(saved.customAccentsById["custom:warm"]).toMatchObject({ themeId: "sunset", createdAt: 11, updatedAt: 22 });
    expect(saved.colorThemesById.sunset).toMatchObject({ createdAt: 33, updatedAt: 44 });
  });

  it("keeps an unsent edit when Community requires a fresh copy after its history expired", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const configuration: DesktopSyncConfiguration = {
      accountId: "expired-history-account", libraryId: "123e4567-e89b-42d3-a456-426614174004", deviceId: "expired-history-device",
      apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    };
    setDesktopSyncConfiguration(configuration);
    expect(await storageService.switchAccountDatabase()).toBe(true);
    const edited = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
    const other = "spotify:track:0VjIjW4GlUZAMYd2vXMi3b";
    expect(await indexedDBStorage.saveTrack(edited, { rating: 5, energy: 0, bpm: null, camelotKey: null, tagIds: [], dateModified: 2_000 })).toBe(true);
    const annotation = (providerId: string, rating: number) => ({
      entity: { provider: "spotify", kind: "track", providerId },
      fields: { rating: { value: rating, revision: 1 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } },
      tagMemberships: {}, entityRevision: 1, deleted: false,
    });
    const snapshot: LibrarySnapshotV2 = {
      protocolVersion: 2, sourceStorageSchemaVersion: 2, libraryId: configuration.libraryId, headCursor: 900,
      generatedAt: new Date().toISOString(), taxonomy: [], colors: [], collections: [], appState: [],
      annotations: [annotation("4uLU6hMCjMI75M1A2tKUQC", 2), annotation("0VjIjW4GlUZAMYd2vXMi3b", 4)] as LibrarySnapshotV2["annotations"],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull") ? { snapshotRequired: true, batches: [], headCursor: 900, conflicts: [] }
        : String(input).includes("/sync/snapshot") ? { snapshot }
          : {},
    ), { status: 200, headers: { "content-type": "application/json" } }));

    await (syncRuntime as unknown as { pull(configuration: DesktopSyncConfiguration): Promise<boolean> }).pull(configuration);

    expect((await indexedDBStorage.getTrack(edited))?.rating).toBe(5);
    expect((await indexedDBStorage.getTrack(other))?.rating).toBe(4);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`tagify-db:${configuration.accountId}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const queued = await new Promise<Array<{ type: string; desired?: { rating: number } }>>((resolve, reject) => {
      const request = database.transaction("sync-outbox").objectStore("sync-outbox").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    expect(queued).toEqual([expect.objectContaining({ type: "entity.replace", desired: expect.objectContaining({ rating: 5 }) })]);
  });

  it("refreshes a merge review only when actual library content changes", () => {
    const snapshot = {
      libraryId: "library", sourceStorageSchemaVersion: 9, taxonomy: [], colors: [], collections: [],
      annotations: [], appState: [{ domain: "preferences", value: { sort: "recent" }, revision: 0, updatedAt: "old" }],
    } as unknown as LibrarySnapshotV2;
    expect(sameInitialMergeDeviceContent(snapshot, {
      ...snapshot, generatedAt: "later", appState: [{ ...snapshot.appState[0], updatedAt: "later" }],
    })).toBe(true);
    expect(sameInitialMergeDeviceContent(snapshot, {
      ...snapshot, appState: [{ ...snapshot.appState[0], value: { sort: "title" } }],
    })).toBe(false);
  });
});
