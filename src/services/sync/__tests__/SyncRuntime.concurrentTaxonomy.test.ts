import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import type { TagTaxonomy } from "@/types/tagData";
import { getTagifyDatabaseName, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import { syncRuntime } from "../SyncRuntime";

const configuration: DesktopSyncConfiguration = {
  accountId: "concurrent-taxonomy-account", libraryId: "concurrent-taxonomy-library", deviceId: "concurrent-taxonomy-device",
  apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
};

type Runtime = {
  push(configuration: DesktopSyncConfiguration): Promise<void>;
  pull(configuration: DesktopSyncConfiguration): Promise<boolean>;
  settleLocalAndPublicSync(configuration: DesktopSyncConfiguration): Promise<void>;
};

function node(id: string, kind: "category" | "tag", parentId: string | null, name: string, position: number) {
  return { id, kind, parentId, name, accentId: null, position, nodeRevision: 1, parentListRevision: 0, deleted: false };
}

function genreTaxonomy(tags: Array<[string, string]>, extra?: (taxonomy: TagTaxonomy) => void): TagTaxonomy {
  const taxonomy = createEmptyTaxonomy();
  taxonomy.categoryOrder = ["genre"];
  taxonomy.categoriesById.genre = { id: "genre", name: "Genre", subcategoryIds: [], childIds: tags.map(([id]) => id) };
  taxonomy.childrenByParentId = { genre: tags.map(([id]) => id) };
  tags.forEach(([id, name]) => { taxonomy.tagsById[id] = { id, name, parentId: "genre", subcategoryId: "genre" }; });
  extra?.(taxonomy);
  return taxonomy;
}

async function putShadow(nodes: ReturnType<typeof node>[]) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(getTagifyDatabaseName());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("sync-state", "readwrite");
    transaction.objectStore("sync-state").put({
      key: "taxonomy-shadow", nodes: Object.fromEntries(nodes.map((item) => [item.id, item])),
      colors: {}, collections: {}, parentRevisions: { __root__: 1, genre: nodes.length - 1 },
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

describe("taxonomy edits from more than one device", () => {
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

  it("sends only this device's rename and keeps a tag another device created meanwhile", async () => {
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"]]), { captureSync: false })).toBe(true);
    await putShadow([node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0)]);

    // This device renames a tag while offline.
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House Music"]]))).toBe(true);
    // Meanwhile another device created a tag; the pull records it in the shadow
    // because this device still has an unsent taxonomy edit.
    await putShadow([
      node("genre", "category", null, "Genre", 0),
      node("house", "tag", "genre", "House", 0),
      node("techno", "tag", "genre", "Techno", 1),
    ]);

    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      changes: [], projection: { complete: true }, conflictIds: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await (syncRuntime as unknown as Runtime).push(configuration);

    const body = JSON.parse(request.mock.calls[0][1]?.body as string) as { operations: Array<{ type: string; node: { id: string; name: string } }> };
    expect(body.operations).toEqual([expect.objectContaining({ type: "taxonomy.upsert", node: expect.objectContaining({ id: "house", name: "House Music" }) })]);
  });

  it("shows another device's new tag on this device once its own edit has backed up", async () => {
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"]]), { captureSync: false })).toBe(true);
    await putShadow([node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0)]);
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House Music"]]))).toBe(true);
    await putShadow([
      node("genre", "category", null, "Genre", 0),
      { ...node("house", "tag", "genre", "House Music", 0), nodeRevision: 2 },
      node("techno", "tag", "genre", "Techno", 1),
    ]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull")
        ? { batches: [], headCursor: 0, conflicts: [] }
        : { changes: [], projection: { complete: true }, conflictIds: [] },
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await (syncRuntime as unknown as Runtime).settleLocalAndPublicSync(configuration);

    const saved = await storageService.getTaxonomy();
    expect(saved.tagsById.house.name).toBe("House Music");
    expect(saved.tagsById.techno?.name).toBe("Techno");
  });

  it("keeps a rejected new tag on this device and sends it again with the next edit", async () => {
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"]]), { captureSync: false })).toBe(true);
    await putShadow([node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0)]);
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"], ["trance", "Trance"]]))).toBe(true);

    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull")
        ? { batches: [], headCursor: 0, conflicts: [] }
        : { changes: [], projection: { complete: true }, conflictIds: ["rejected-trance"] },
    ), { status: 200, headers: { "content-type": "application/json" } }));
    await (syncRuntime as unknown as Runtime).settleLocalAndPublicSync(configuration);
    expect((await storageService.getTaxonomy()).tagsById.trance?.name).toBe("Trance");

    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House Music"], ["trance", "Trance"]]))).toBe(true);
    request.mockClear();
    await (syncRuntime as unknown as Runtime).push(configuration);
    const body = JSON.parse(request.mock.calls[0][1]?.body as string) as { operations: Array<{ type: string; node: { id: string } }> };
    expect(body.operations.map((operation) => operation.node.id).sort()).toEqual(["house", "trance"]);
  });
});

