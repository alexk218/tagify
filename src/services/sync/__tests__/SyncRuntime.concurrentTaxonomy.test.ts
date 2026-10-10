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
    (syncRuntime as unknown as { taxonomyRefreshRequested: boolean }).taxonomyRefreshRequested = false;
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

  // A tag deleted on another device is only marked deleted in this device's
  // cloud copy until its own edit backs up. It must not be created again.
  it("never re-creates a tag another device deleted while this device renames a different tag", async () => {
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"], ["techno", "Techno"]]), { captureSync: false })).toBe(true);
    await putShadow([node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0), node("techno", "tag", "genre", "Techno", 1)]);
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House Music"], ["techno", "Techno"]]))).toBe(true);
    await putShadow([
      node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0),
      { ...node("techno", "tag", "genre", "Techno", 1), nodeRevision: 2, deleted: true },
    ]);

    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify({ changes: [], projection: { complete: true }, conflictIds: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await (syncRuntime as unknown as Runtime).push(configuration);
    const call = request.mock.calls.find(([input]) => String(input).includes("/sync/push"));
    const body = JSON.parse(call?.[1]?.body as string) as { operations: Array<{ type: string; node: { id: string } }> };
    expect(body.operations.map((operation) => `${operation.type}:${operation.node.id}`)).toEqual(["taxonomy.upsert:house"]);
  });

  // Another device's tag can reach this device's cloud copy before the tag
  // list on screen is refreshed. Renaming a different tag must not delete it.
  it("never deletes a tag from another device that this device has not shown yet", async () => {
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"]]), { captureSync: false })).toBe(true);
    await putShadow([
      node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0), node("techno", "tag", "genre", "Techno", 1),
    ]);
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House Music"]]))).toBe(true);

    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(
      JSON.stringify({ changes: [], projection: { complete: true }, conflictIds: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await (syncRuntime as unknown as Runtime).push(configuration);
    const body = JSON.parse(request.mock.calls[0][1]?.body as string) as { operations: Array<{ type: string; node: { id: string } }> };
    expect(body.operations.map((operation) => `${operation.type}:${operation.node.id}`)).toEqual(["taxonomy.upsert:house"]);
  });

  it("keeps a rejected new tag on this device and in the queue, and sends it again with the next edit", async () => {
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"]]), { captureSync: false })).toBe(true);
    await putShadow([node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0)]);
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"], ["trance", "Trance"]]))).toBe(true);
    // An earlier backup asked to show other devices' taxonomy changes.
    (syncRuntime as unknown as { taxonomyRefreshRequested: boolean }).taxonomyRefreshRequested = true;

    const request = rejectingCommunity();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    await expect((syncRuntime as unknown as Runtime).settleLocalAndPublicSync(configuration)).rejects.toThrow(/sync_waiting/);
    expect((await storageService.getTaxonomy()).tagsById.trance?.name).toBe("Trance");
    expect(await queuedTaxonomyEdits()).toBe(1);

    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House Music"], ["trance", "Trance"]]))).toBe(true);
    request.mockClear();
    await (syncRuntime as unknown as Runtime).push(configuration);
    const body = JSON.parse(request.mock.calls.find((call) => String(call[0]).includes("/sync/push"))?.[1]?.body as string) as { operations: Array<{ type: string; node: { id: string } }> };
    expect(body.operations.map((operation) => operation.node.id).sort()).toEqual(["house", "trance"]);
  });

  it("keeps a tag Community has never received when the taxonomy is rebuilt from the cloud copy", async () => {
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"], ["trance", "Trance"]]), { captureSync: false })).toBe(true);
    await putShadow([node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0), { ...node("techno", "tag", "genre", "Techno", 1), deleted: true }]);
    expect(await storageService.saveTaxonomy(genreTaxonomy([["house", "House"], ["trance", "Trance"], ["techno", "Techno"]]), { captureSync: false })).toBe(true);
    (syncRuntime as unknown as { taxonomyRefreshRequested: boolean }).taxonomyRefreshRequested = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).includes("/sync/pull") ? { batches: [], headCursor: 0, conflicts: [] } : {},
    ), { status: 200, headers: { "content-type": "application/json" } }));

    await (syncRuntime as unknown as { refreshDeviceTaxonomyAfterBackup(): Promise<void> }).refreshDeviceTaxonomyAfterBackup();

    const saved = await storageService.getTaxonomy();
    expect(saved.tagsById.trance?.name).toBe("Trance");
    expect(saved.tagsById.techno).toBeUndefined();
  });
});

function rejectingCommunity() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes("/sync/pull")
      ? { batches: [], headCursor: 0, conflicts: [] }
      : String(input).includes("/sync/snapshot")
        ? { snapshot: {
          protocolVersion: 2, sourceStorageSchemaVersion: 9, libraryId: "123e4567-e89b-42d3-a456-426614174004", headCursor: 0,
          generatedAt: new Date().toISOString(), colors: [], collections: [], annotations: [], appState: [],
          taxonomy: [node("genre", "category", null, "Genre", 0), node("house", "tag", "genre", "House", 0)].map((item) => ({ ...item, parentListRevision: 1 })),
        } }
        : { changes: [], projection: { complete: true }, conflictIds: ["rejected-trance"] },
  ), { status: 200, headers: { "content-type": "application/json" } }));
}

async function queuedTaxonomyEdits(): Promise<number> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(getTagifyDatabaseName());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const intents = await new Promise<Array<{ type: string }>>((resolve, reject) => {
    const request = database.transaction("sync-outbox").objectStore("sync-outbox").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return intents.filter((intent) => intent.type === "taxonomy.replace").length;
}
