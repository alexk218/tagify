import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
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
  });
});
