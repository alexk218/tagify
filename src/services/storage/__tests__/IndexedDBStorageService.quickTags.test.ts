import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "../IndexedDBStorageService";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("tagify:sync:account-id", "quick-tag-tests");
  await indexedDBStorage.init();
  const taxonomy = createEmptyTaxonomy();
  taxonomy.categoryOrder = ["genre"];
  taxonomy.categoriesById.genre = { id: "genre", name: "Genre", subcategoryIds: [], childIds: [] };
  await indexedDBStorage.saveTaxonomy(taxonomy);
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.unstubAllGlobals(); });

it("keeps concurrent tag creations and reuses a duplicate in the same parent", async () => {
  const [first, second, duplicate] = await Promise.all([
    indexedDBStorage.createQuickTag("Deep house", "genre"),
    indexedDBStorage.createQuickTag("Ambient", "genre"),
    indexedDBStorage.createQuickTag(" deep HOUSE ", "genre"),
  ]);
  expect(duplicate.id).toBe(first.id);
  const tree = await indexedDBStorage.getTaxonomy();
  expect(Object.keys(tree.tagsById)).toEqual(expect.arrayContaining([first.id, second.id]));
  expect(tree.childrenByParentId?.genre).toHaveLength(2);
});

it("does not lose the tree or saved track dates after an invalid creation", async () => {
  await indexedDBStorage.saveTrack("spotify:track:old", { rating: 4, energy: 5, bpm: null, tagIds: [], dateModified: 123 });
  await expect(indexedDBStorage.createQuickTag("New tag", "removed-parent")).rejects.toThrow();
  expect((await indexedDBStorage.getTaxonomy()).categoryOrder).toEqual(["genre"]);
  expect((await indexedDBStorage.getTrack("spotify:track:old"))?.dateModified).toBe(123);
});
