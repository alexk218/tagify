import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findTastePack, TASTE_PACK_HOME } from "@tagify/community-contracts";
import { buildStarterTaxonomy, defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageMigrationService } from "@/services/storage/StorageMigrationService";
import { getTagifyDatabaseName, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { TAG_DATA_UPDATED_EVENT } from "@/features/tag-data/utils/tagData.events";
import { buildCategoryTree } from "@/utils/tagTaxonomy";
import { planTastePacksForTaxonomy } from "@/utils/tastePackTaxonomy";
import { addTastePacks } from "../tastePacks";
import { isTastePackStepOffered, markTastePacksAnswered, markTastePacksOffered, shouldOfferTastePacks } from "../tastePackStep";

vi.mock("@/services/sync/SyncInstallRecovery", () => ({
  restoreDesktopSyncConfiguration: vi.fn().mockResolvedValue(null),
}));

const STEP_KEY = "tagify:taste-packs:v1";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("who is asked what they listen to", () => {
  it("is a fresh install: the install that saves the starter tags into an empty library offers the step", async () => {
    expect((await storageMigrationService.migrate()).success).toBe(true);
    expect(localStorage.getItem(STEP_KEY)).toBe("offered");
    expect(isTastePackStepOffered()).toBe(true);
  });

  it("is never a library that was already there when Tagify updated", async () => {
    await indexedDBStorage.init();
    await indexedDBStorage.saveTrack("spotify:track:existing", { rating: 4, energy: 0, bpm: null, tagIds: [], dateModified: 1 });
    expect((await storageMigrationService.migrate()).success).toBe(true);
    expect(localStorage.getItem(STEP_KEY)).toBeNull();
  });

  it("is never an untouched library from an earlier version, whose install finished before", async () => {
    localStorage.setItem("tagify:idb-migration-status", JSON.stringify({ status: "completed", completedAt: 1 }));
    expect((await storageMigrationService.migrate()).success).toBe(true);
    expect(localStorage.getItem(STEP_KEY)).toBeNull();
  });

  it("keeps an answer: a later fresh start doesn't ask again", () => {
    markTastePacksOffered();
    markTastePacksAnswered("skipped");
    markTastePacksOffered();
    expect(localStorage.getItem(STEP_KEY)).toBe("skipped");
    expect(isTastePackStepOffered()).toBe(false);
  });

  const fresh = { offered: true, isLoading: false, taggedTrackCount: 0, restoreOnOffer: false, taxonomy: defaultTagData.taxonomy };
  it("shows the step only while every condition holds", () => {
    expect(shouldOfferTastePacks(fresh)).toBe(true);
    expect(shouldOfferTastePacks({ ...fresh, offered: false })).toBe(false);
    expect(shouldOfferTastePacks({ ...fresh, isLoading: true })).toBe(false);
    expect(shouldOfferTastePacks({ ...fresh, taggedTrackCount: 1 })).toBe(false);
    expect(shouldOfferTastePacks({ ...fresh, restoreOnOffer: true })).toBe(false);
    const ownTags = buildStarterTaxonomy(2);
    Object.values(ownTags.tagsById)[0].name = "My own tag";
    expect(shouldOfferTastePacks({ ...fresh, taxonomy: ownTags })).toBe(false);
    // Packs added as they come still leave the starter tags untouched.
    expect(shouldOfferTastePacks({ ...fresh, taxonomy: planTastePacksForTaxonomy(defaultTagData.taxonomy, ["metal"]).taxonomy })).toBe(true);
    // An earlier version's starter tags count as untouched too.
    expect(shouldOfferTastePacks({ ...fresh, taxonomy: buildStarterTaxonomy(1) })).toBe(true);
  });
});

describe("adding taste packs", () => {
  it("saves the packs into the library's tags and tells the extension", async () => {
    await storageMigrationService.migrate();
    const announced = vi.fn();
    window.addEventListener(TAG_DATA_UPDATED_EVENT, announced);

    const results = await addTastePacks(["pop", "metal"]);
    window.removeEventListener(TAG_DATA_UPDATED_EVENT, announced);

    const metal = findTastePack("metal")!;
    const pop = findTastePack("pop")!;
    expect(results.map((result) => [result.key, result.added.length])).toEqual([["metal", 11], ["pop", 10]]);
    const saved = await indexedDBStorage.getTaxonomy();
    const genre = buildCategoryTree(saved).find((category) => category.id === TASTE_PACK_HOME.id)!;
    expect(genre.subcategories.slice(-2).map((folder) => [folder.id, folder.name, folder.tags.length])).toEqual([[metal.folderId, "Metal & Heavy", 11], [pop.folderId, "Pop", 10]]);
    expect(announced).toHaveBeenCalledTimes(1);
  });

  it("queues the change for Community like any edit to the tags", async () => {
    setDesktopSyncConfiguration({
      accountId: "taste-pack-tests", deviceId: "device", libraryId: "library", apiBaseUrl: "https://community.example",
      accessToken: "test", refreshToken: "test", expiresAt: Math.floor(Date.now() / 1000) + 3600,
    } as DesktopSyncConfiguration);
    await indexedDBStorage.init();
    await indexedDBStorage.saveTaxonomy(defaultTagData.taxonomy, { captureSync: false });

    await addTastePacks(["metal"]);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(getTagifyDatabaseName());
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const intents = await new Promise<Array<{ type: string; taxonomy?: { tagsById: Record<string, unknown> } }>>((resolve, reject) => {
      const request = database.transaction("sync-outbox").objectStore("sync-outbox").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const edits = intents.filter((intent) => intent.type === "taxonomy.replace");
    expect(edits).toHaveLength(1);
    expect(edits[0].taxonomy?.tagsById[findTastePack("metal")!.tags[0].id]).toBeDefined();
  });

  it("refuses to save when the account changed after the step opened", async () => {
    await storageMigrationService.migrate();
    await expect(addTastePacks(["metal"], "tagify-db:someone-else")).rejects.toThrow("Your tags couldn't be added");
    expect((await indexedDBStorage.getTaxonomy()).subcategoriesById[findTastePack("metal")!.folderId]).toBeUndefined();
  });
});
