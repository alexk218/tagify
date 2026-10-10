import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationSnapshotV1 } from "@tagify/sync-contracts";
import { indexedDBStorage, IndexedDBStorageService } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import type { TagTaxonomy } from "@/types/tagData";
import { addMissingTaxonomy, knownCloudTaxonomy, rebuildDeviceTaxonomy } from "../PreserveLocalTaxonomyMetadata";
import { setDesktopSyncConfiguration, TAGIFY_DATABASE_VERSION, type EntityReplaceIntent, type TaxonomyReplaceIntent } from "../SyncLocalState";
import { buildReplicaReconciliationPlan, syncPairingService } from "../SyncPairingService";
import { materializeEntity } from "../SyncRuntime";
import { flattenTaxonomy } from "../SyncTaxonomy";

const SONG = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const entity = { provider: "spotify" as const, kind: "track" as const, providerId: "4uLU6hMCjMI75M1A2tKUQC" };

function genre(tags: Array<[string, string]>): TagTaxonomy {
  const taxonomy = createEmptyTaxonomy();
  taxonomy.categoryOrder = ["genre"];
  taxonomy.categoriesById.genre = { id: "genre", name: "Genre", subcategoryIds: [], childIds: tags.map(([id]) => id) };
  taxonomy.childrenByParentId = { genre: tags.map(([id]) => id) };
  tags.forEach(([id, name]) => { taxonomy.tagsById[id] = { id, name, parentId: "genre", subcategoryId: "genre" }; });
  return taxonomy;
}

function cloudCopy(tags: Record<string, boolean>, rating: number | null = 2): AnnotationSnapshotV1 {
  return {
    entity,
    fields: { rating: { value: rating, revision: 1 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } },
    tagMemberships: Object.fromEntries(Object.entries(tags).map(([tagId, value]) => [tagId, { value, revision: 1 }])),
    entityRevision: 3, deleted: false,
  };
}

describe("reconnecting a device sends only what changed on it", () => {
  it("does not remove another device's tags or revert its rating", async () => {
    const preserved = { ...defaultTagData, taxonomy: genre([["house", "House"]]), tracks: { [SONG]: { rating: 2, energy: 0, bpm: null, camelotKey: null, tagIds: ["house"] } } };
    const localOnly = { ...preserved, tracks: { [SONG]: { ...preserved.tracks[SONG], energy: 6 } } };

    const plan = buildReplicaReconciliationPlan(localOnly, preserved);
    const intent = plan.entityIntents[0] as EntityReplaceIntent;
    // Meanwhile another device tagged the song and changed its rating.
    const operations = await materializeEntity(intent, cloudCopy({ house: true, vocal: true }, 4));

    expect(operations).toEqual([expect.objectContaining({ type: "annotation.patch", fields: { energy: 6 } })]);
  });

  it("sends only the taxonomy changes made while this device was disconnected", () => {
    const preserved = { ...defaultTagData, taxonomy: genre([["house", "House"]]) };
    const localOnly = { ...preserved, taxonomy: genre([["house", "House Music"]]) };

    const plan = buildReplicaReconciliationPlan(localOnly, preserved);

    expect((plan.taxonomyIntent as TaxonomyReplaceIntent).base).toEqual(preserved.taxonomy);
  });
});

describe("recovering an older unlinked copy only adds what is missing", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    setDesktopSyncConfiguration({
      accountId: "legacy-account", libraryId: "legacy-library", deviceId: "legacy-device", apiBaseUrl: "https://community.example",
      supabaseUrl: "https://supabase.example", supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    });
    expect(await storageService.switchAccountDatabase()).toBe(true);
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps tags from other devices and queues only the recovered additions", async () => {
    expect(await storageService.saveTaxonomy(genre([["house", "House"], ["techno", "Techno"]]), { captureSync: false })).toBe(true);
    expect(await indexedDBStorage.saveTrack(SONG, { rating: 4, energy: 0, bpm: null, camelotKey: null, tagIds: ["techno"], dateModified: 9_000 }, { captureSync: false })).toBe(true);
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tagify-db", TAGIFY_DATABASE_VERSION);
      request.onupgradeneeded = () => IndexedDBStorageService.createSchema(request.result, request.transaction ?? undefined);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = legacy.transaction(["categories", "metadata", "tracks"], "readwrite");
      transaction.objectStore("categories").put({ id: "taxonomy", data: genre([["house", "House"], ["trance", "Trance"]]) });
      transaction.objectStore("metadata").put({ key: "lastModified", value: Date.now() + 60_000 });
      // An older copy of a song changed more recently on this device.
      transaction.objectStore("tracks").put({ uri: SONG, rating: 1, energy: 0, bpm: null, camelotKey: null, tagIds: [], dateModified: 1_000 });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();

    await syncPairingService.recoverLegacyReplica("legacy-account");

    const taxonomy = await storageService.getTaxonomy();
    expect(Object.keys(taxonomy.tagsById).sort()).toEqual(["house", "techno", "trance"]);
    expect(await indexedDBStorage.getTrack(SONG)).toMatchObject({ rating: 4, tagIds: ["techno"] });
    const queued = await new Promise<TaxonomyReplaceIntent[]>((resolve, reject) => {
      const request = indexedDB.open("tagify-db:legacy-account");
      request.onsuccess = () => {
        const read = request.result.transaction("sync-outbox").objectStore("sync-outbox").getAll();
        read.onsuccess = () => { request.result.close(); resolve(read.result); };
        read.onerror = () => reject(read.error);
      };
      request.onerror = () => reject(request.error);
    });
    expect(queued).toHaveLength(1);
    expect(Object.keys(queued[0].base!.tagsById).sort()).toEqual(["house", "techno"]);
  });
});

describe("rebuilding the device taxonomy from the cloud copy", () => {
  it("keeps items the cloud never received and removes only items it deleted", () => {
    const device = genre([["house", "House"], ["trance", "Trance"], ["techno", "Techno"]]);
    device.customAccentsById["custom:new"] = { id: "custom:new", name: "New", color: "#123456" };
    device.colorThemesById.fresh = { id: "fresh", name: "Fresh", colorIds: ["custom:new"] };
    device.colorThemeOrder = ["fresh"];
    const cloud = genre([["house", "House"]]);
    const shadow = flattenTaxonomy(cloud);
    shadow.nodes.techno = { id: "techno", kind: "tag", parentId: "genre", name: "Techno", accentId: null, position: 1, nodeRevision: 2, parentListRevision: 2, deleted: true };

    const rebuilt = rebuildDeviceTaxonomy(cloud, device, knownCloudTaxonomy(shadow));

    expect(Object.keys(rebuilt.tagsById).sort()).toEqual(["house", "trance"]);
    expect(rebuilt.customAccentsById["custom:new"]?.name).toBe("New");
    expect(rebuilt.colorThemesById.fresh?.colorIds).toEqual(["custom:new"]);
  });

  it("keeps the device's own spelling of a name Community stores shortened", () => {
    const longName = `Late night ${"deep ".repeat(20)}house`;
    const device = genre([["house", longName]]);
    const cloud = genre([["house", flattenTaxonomy(device).nodes.house.name]]);

    expect(rebuildDeviceTaxonomy(cloud, device).tagsById.house.name).toBe(longName);
  });

  it("adds only what an older copy has and this one lacks", () => {
    const combined = addMissingTaxonomy(genre([["house", "House Music"], ["techno", "Techno"]]), genre([["house", "House"], ["trance", "Trance"]]));

    expect(Object.fromEntries(Object.values(combined.tagsById).map((tag) => [tag.id, tag.name]))).toEqual({ house: "House Music", techno: "Techno", trance: "Trance" });
  });
});
