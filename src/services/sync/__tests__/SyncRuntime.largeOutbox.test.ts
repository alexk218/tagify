import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import { getTagifyDatabaseName, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import { syncRuntime } from "../SyncRuntime";

const configuration: DesktopSyncConfiguration = {
  accountId: "large-library-account",
  libraryId: "large-library",
  deviceId: "large-library-device",
  apiBaseUrl: "https://community.example",
  supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "key",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: Date.now() + 60_000,
};

describe("large Community changes", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    setDesktopSyncConfiguration(configuration);
    expect(await indexedDBStorage.init()).toBe(true);
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts backing up a 600-tag edit without asking the user for a new backup", async () => {
    const taxonomy = buildTaxonomyFromCategoryTree([{
      id: "music", name: "Music", subcategories: [{
        id: "styles", name: "Styles",
        tags: Array.from({ length: 600 }, (_, index) => ({ id: `style-${index}`, name: `Style ${index}` })),
      }],
    }]);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(getTagifyDatabaseName());
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("sync-outbox", "readwrite");
      transaction.objectStore("sync-outbox").put({
        id: "large-taxonomy", batchId: "large-taxonomy-batch", createdAt: 1,
        type: "taxonomy.replace", taxonomy,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      changes: [], projection: { complete: true }, conflictIds: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await (syncRuntime as unknown as { push(configuration: DesktopSyncConfiguration): Promise<void> }).push(configuration);

    const body = JSON.parse(request.mock.calls[0][1]?.body as string) as {
      batchId: string;
      operations: Array<{ operationId: string; node: { id: string; parentId: string | null } }>;
    };
    expect(body.operations).toHaveLength(500);
    const remaining = await new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open(getTagifyDatabaseName());
      open.onsuccess = () => {
        const db = open.result;
        const query = db.transaction("sync-outbox").objectStore("sync-outbox").getAll();
        query.onsuccess = () => { db.close(); resolve(query.result); };
        query.onerror = () => reject(query.error);
      };
      open.onerror = () => reject(open.error);
    });
    expect(remaining).toHaveLength(1);

    // A pull applies the confirmed first batch before the queued edit is retried.
    // Recreate that canonical shadow without making 500 UI/storage writes in this test.
    const parentRevisions: Record<string, number> = {};
    for (const operation of body.operations) {
      const parent = operation.node.parentId || "__root__";
      parentRevisions[parent] = (parentRevisions[parent] || 0) + 1;
    }
    const shadowDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(getTagifyDatabaseName());
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = shadowDatabase.transaction("sync-state", "readwrite");
      transaction.objectStore("sync-state").put({
        key: "taxonomy-shadow",
        nodes: Object.fromEntries(body.operations.map((operation) => [operation.node.id, { ...operation.node, nodeRevision: 1 }])),
        parentRevisions,
        colors: {}, collections: {},
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    shadowDatabase.close();

    await (syncRuntime as unknown as { push(configuration: DesktopSyncConfiguration): Promise<void> }).push(configuration);
    const second = JSON.parse(request.mock.calls[1][1]?.body as string) as typeof body;
    expect(second.operations).toHaveLength(102);
    expect(second.batchId).not.toBe(body.batchId);
    expect(new Set([...body.operations, ...second.operations].map((operation) => operation.operationId)).size).toBe(602);
    // The edit stays queued until Community's confirmed copy holds all of it.
    expect(await new Promise<number>((resolve, reject) => {
      const open = indexedDB.open(getTagifyDatabaseName());
      open.onsuccess = () => {
        const query = open.result.transaction("sync-outbox").objectStore("sync-outbox").count();
        query.onsuccess = () => { open.result.close(); resolve(query.result); };
        query.onerror = () => reject(query.error);
      };
    })).toBe(1);
    for (const operation of second.operations) {
      const parent = operation.node.parentId || "__root__";
      parentRevisions[parent] = (parentRevisions[parent] || 0) + 1;
    }
    const confirmedDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(getTagifyDatabaseName());
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = confirmedDatabase.transaction("sync-state", "readwrite");
      transaction.objectStore("sync-state").put({
        key: "taxonomy-shadow",
        nodes: Object.fromEntries([...body.operations, ...second.operations].map((operation) => [operation.node.id, { ...operation.node, nodeRevision: 1 }])),
        parentRevisions,
        colors: {}, collections: {},
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    confirmedDatabase.close();
    await (syncRuntime as unknown as { push(configuration: DesktopSyncConfiguration): Promise<void> }).push(configuration);
    expect(request).toHaveBeenCalledTimes(2);
    const finalDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(getTagifyDatabaseName());
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const finalCount = await new Promise<number>((resolve, reject) => {
      const query = finalDatabase.transaction("sync-outbox").objectStore("sync-outbox").count();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    });
    finalDatabase.close();
    expect(finalCount).toBe(0);
  }, 60_000);

  // Community answers this when a different batch already uses the name.
  // The change stays queued and goes out again under a new name.
  it("sends a change again under a new name when Community already holds that batch name", async () => {
    const uri = `spotify:track:${"r".repeat(22)}`;
    expect(await indexedDBStorage.saveTracks(new Map([[uri, { rating: 4, energy: 0, bpm: null, tagIds: [] }]]))).toBe(true);
    const request = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "batch_id_reused", message: "This batch name was used for different changes." } }), { status: 409, headers: { "content-type": "application/json" } }))
      .mockResolvedValue(new Response(JSON.stringify({ changes: [], projection: { complete: true }, conflictIds: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const runtime = syncRuntime as unknown as { push(configuration: DesktopSyncConfiguration): Promise<{ accepted: number }> };

    expect((await runtime.push(configuration)).accepted).toBe(0);
    await runtime.push(configuration);

    const batchIds = request.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { batchId: string }).batchId);
    expect(batchIds).toHaveLength(2);
    expect(batchIds[0]).not.toBe(batchIds[1]);
  });

  // Community can save a change under its own batch name. When that batch
  // comes back, it is still this device's change, not one from elsewhere.
  it("recognizes its own change saved under Community's batch name", async () => {
    const uri = `spotify:track:${"q".repeat(22)}`;
    expect(await indexedDBStorage.saveTracks(new Map([[uri, { rating: 3, energy: 0, bpm: null, tagIds: [] }]]))).toBe(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      batchId: "community-batch", changes: [], projection: { complete: true }, conflictIds: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const runtime = syncRuntime as unknown as { push(configuration: DesktopSyncConfiguration): Promise<unknown>; ownBatchIds: Set<string> };

    await runtime.push(configuration);

    expect(runtime.ownBatchIds.has("community-batch")).toBe(true);
  });

  // A first backup into a Community library that already holds something
  // (such as colors) combines the two libraries instead of failing.
  it("combines libraries when Community says a first backup needs a merge", async () => {
    const uri = `spotify:track:${"p".repeat(22)}`;
    expect(await indexedDBStorage.saveTracks(new Map([[uri, { rating: 3, energy: 0, bpm: null, tagIds: [] }]]))).toBe(true);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).includes("/sync/bootstrap")
      ? new Response(JSON.stringify({ error: { code: "merge_required", message: "Community already has a library." } }), { status: 409, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ library: { counts: { annotations: 0, taxonomy: 0 } } }), { status: 200, headers: { "content-type": "application/json" } }));
    const runtime = syncRuntime as unknown as Record<string, unknown> & { bootstrap(configuration: DesktopSyncConfiguration, intentId: string, batchId: string, queuedAt: number): Promise<void> };
    const reconcile = vi.spyOn(runtime as never, "reconcileInitialLibraries").mockResolvedValue(true as never);
    vi.spyOn(storageService, "isReady").mockReturnValue(true);

    const linked = { ...configuration, libraryId: "6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b" };
    await runtime.bootstrap(linked, "snapshot-intent", "snapshot-batch", 1);

    expect(reconcile).toHaveBeenCalledWith(linked);
  });
});
