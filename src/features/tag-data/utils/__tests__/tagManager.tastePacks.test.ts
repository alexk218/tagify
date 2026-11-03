import { beforeEach, describe, expect, it, vi } from "vitest";
import { findTastePack, TASTE_PACK_HOME } from "@tagify/community-contracts";
import { defaultTagData } from "@/constants/defaultTagData";
import { createEmptyTaxonomy, normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import { tastePackChoices } from "@/utils/tastePackTaxonomy";
import { addTastePacksToDraft, recordSavedTastePacks } from "../tagManager.tastePacks";

const { flushLocalPersistence, getTaxonomy, recordTastePacksAdded } = vi.hoisted(() => ({
  flushLocalPersistence: vi.fn(), getTaxonomy: vi.fn(), recordTastePacksAdded: vi.fn(),
}));
vi.mock("@/services/sync/SyncLocalState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sync/SyncLocalState")>()),
  flushLocalPersistence,
}));
vi.mock("@/services/storage/IndexedDBStorageService", () => ({ indexedDBStorage: { getTaxonomy } }));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordTastePacksAdded }));

const metal = findTastePack("metal")!;

describe("Add a pack in Tag Manager", () => {
  it("adds the pack's folder to Genre & Style and points at it", () => {
    const result = addTastePacksToDraft(defaultTagData.taxonomy, ["metal"]);

    const tree = normalizeTaxonomyTree(result.taxonomy);
    expect(tree.childrenByParentId?.[TASTE_PACK_HOME.id]).toContain(metal.folderId);
    expect(tree.childrenByParentId?.[metal.folderId]?.map((id) => tree.tagsById[id].name)).toEqual(metal.tags.map((tag) => tag.name));
    expect(result.packs).toEqual([expect.objectContaining({ key: "metal", folderId: metal.folderId })]);
    expect(result.reveal).toEqual({ categoryId: TASTE_PACK_HOME.id, folderId: metal.folderId });
    // The saved tags aren't touched; only the draft copy changes.
    expect(defaultTagData.taxonomy.subcategoriesById[metal.folderId]).toBeUndefined();
  });

  it("changes nothing when the pack is already there", () => {
    const once = addTastePacksToDraft(defaultTagData.taxonomy, ["metal"]).taxonomy;
    const twice = addTastePacksToDraft(once, ["metal"]);

    expect(twice.taxonomy).toBe(once);
    expect(twice.reveal).toBeNull();
    expect(twice.packs[0].added).toEqual([]);
    expect(tastePackChoices(once).find((choice) => choice.key === "metal")?.newTagCount).toBe(0);
  });

  it("adds a shared tag once when a second pack holds it too", () => {
    const withMetal = addTastePacksToDraft(defaultTagData.taxonomy, ["metal"]).taxonomy;
    const withRock = addTastePacksToDraft(withMetal, ["rock"]).taxonomy;
    const hardRock = Object.values(withRock.tagsById).filter((tag) => tag.name === "Hard Rock");

    expect(hardRock).toHaveLength(1);
  });

  it("brings back Genre & Style when the person has removed it", () => {
    const result = addTastePacksToDraft(createEmptyTaxonomy(), ["pop"]);

    expect(result.taxonomy.categoryOrder).toEqual([TASTE_PACK_HOME.id]);
    expect(result.reveal?.categoryId).toBe(TASTE_PACK_HOME.id);
  });
});

describe("counting packs added in Tag Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flushLocalPersistence.mockResolvedValue(undefined);
  });

  it("counts each pack once its tags are saved", async () => {
    const { taxonomy, packs } = addTastePacksToDraft(defaultTagData.taxonomy, ["metal", "pop"]);
    getTaxonomy.mockResolvedValue(taxonomy);

    await recordSavedTastePacks(packs);

    expect(flushLocalPersistence).toHaveBeenCalled();
    expect(recordTastePacksAdded).toHaveBeenCalledWith(["metal", "pop"], "tag_manager");
  });

  it("counts nothing when the save fails", async () => {
    const { packs } = addTastePacksToDraft(defaultTagData.taxonomy, ["metal"]);
    flushLocalPersistence.mockRejectedValue(new Error("save failed"));

    await recordSavedTastePacks(packs);

    expect(recordTastePacksAdded).not.toHaveBeenCalled();
  });

  it("counts nothing when the pack's tags aren't in the saved tags", async () => {
    const { packs } = addTastePacksToDraft(defaultTagData.taxonomy, ["metal"]);
    getTaxonomy.mockResolvedValue(defaultTagData.taxonomy);

    await recordSavedTastePacks(packs);

    expect(recordTastePacksAdded).not.toHaveBeenCalled();
  });

  it("does nothing when no pack was added", async () => {
    await recordSavedTastePacks([]);

    expect(flushLocalPersistence).not.toHaveBeenCalled();
    expect(recordTastePacksAdded).not.toHaveBeenCalled();
  });
});
