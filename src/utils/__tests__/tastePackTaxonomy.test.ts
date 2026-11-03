import { describe, expect, it } from "vitest";
import installCases from "@tagify/community-contracts/fixtures/taste-pack-install-cases.json";
import { findTastePack, TASTE_PACK_HOME, TASTE_PACKS, type TastePackLibraryNode } from "@tagify/community-contracts";
import { buildStarterTaxonomy, KNOWN_STARTER_TAXONOMIES } from "@/constants/defaultTagData";
import { hasCustomTaxonomy } from "@/features/tag-data/utils/tagData.schema";
import { classifyLocalReplica } from "@/services/sync/SyncLocalState";
import type { TagTaxonomy } from "@/types/tagData";
import { buildCategoryTree, createEmptyTaxonomy, normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import {
  applyTastePackUpserts,
  planTastePacksForTaxonomy,
  tastePackChoices,
  tastePackLibraryNodes,
  untouchedTastePackFolderIds,
  withoutUntouchedTastePacks,
} from "../tastePackTaxonomy";

type NodeRow = [id: string, kind: TastePackLibraryNode["kind"], parentId: string | null, name: string, position: number, deleted?: boolean];

const ALL_PACKS = TASTE_PACKS.map((pack) => pack.key);
const emptyLibrary = { tracks: {}, playlists: {}, artists: {} };
const withPacks = (taxonomy: TagTaxonomy, keys: string[]) => planTastePacksForTaxonomy(taxonomy, keys).taxonomy;
const childrenOf = (taxonomy: TagTaxonomy, parentId: string | null) => {
  const normalized = normalizeTaxonomyTree(taxonomy);
  return parentId === null ? normalized.categoryOrder : normalized.childrenByParentId?.[parentId] ?? [];
};
const clone = (taxonomy: TagTaxonomy): TagTaxonomy => JSON.parse(JSON.stringify(taxonomy));

/** A Tagify taxonomy holding these live nodes, each in its place among its parent's children. */
function taxonomyFromRows(rows: NodeRow[]): TagTaxonomy {
  const taxonomy = createEmptyTaxonomy();
  const live = rows.filter((row) => row[5] !== true).sort((left, right) => left[4] - right[4]);
  const upserts = live.map(([id, kind, parentId, name, position]) => ({ id, kind: kind === "subcategory" ? "folder" as const : kind, parentId, name, position }));
  // Parents before their children, so every node has somewhere to go.
  const placed = new Set<string>();
  const ordered: typeof upserts = [];
  while (ordered.length < upserts.length) {
    const before = ordered.length;
    for (const node of upserts) {
      if (placed.has(node.id) || (node.parentId && !placed.has(node.parentId))) continue;
      ordered.push(node);
      placed.add(node.id);
    }
    if (ordered.length === before) throw new Error("A case node has no parent");
  }
  return applyTastePackUpserts(taxonomy, ordered);
}

describe("taste packs in a Tagify library", () => {
  it.each(installCases.cases.map((entry) => [entry.case, entry] as const))("%s", (_, entry) => {
    const rows = entry.nodes as NodeRow[];
    const before = taxonomyFromRows(rows);
    const { plan, taxonomy } = planTastePacksForTaxonomy(before, entry.keys);

    // The same nodes as Community's plan; positions differ only where a deleted node left a gap.
    const expected = entry.upserts as NodeRow[];
    expect(plan.upserts.map(({ id, kind, parentId, name }) => [id, kind, parentId, name]))
      .toEqual(expected.map(([id, kind, parentId, name]) => [id, kind, parentId, name]));
    if ("skipped" in entry) expect(plan.packs.flatMap((pack) => pack.skipped.map(({ id, reason }) => [id, reason]))).toEqual(entry.skipped);

    // Each new node goes at the end of its parent, in the planned order, and nothing else moves.
    const parents = new Set(expected.map((row) => row[2]));
    for (const parentId of parents) {
      const added = [...expected].filter((row) => row[2] === parentId).sort((left, right) => left[4] - right[4]).map((row) => row[0]);
      const kept = childrenOf(before, parentId).filter((id) => !added.includes(id));
      expect(childrenOf(taxonomy, parentId), String(parentId)).toEqual([...kept, ...added]);
    }
    for (const [id, kind, parentId, name] of expected) {
      if (kind === "category") expect(taxonomy.categoriesById[id]?.name).toBe(name);
      else if (kind === "folder") expect(taxonomy.subcategoriesById[id]).toMatchObject({ name, parentId });
      else expect(taxonomy.tagsById[id]).toMatchObject({ name, parentId, subcategoryId: parentId, accentId: null });
    }
  });

  it("adds the packs at the end of Genre & Style in Tagify's order, and adding them again changes nothing", () => {
    const starter = buildStarterTaxonomy(2);
    const taxonomy = withPacks(starter, ["rock", "metal"]);
    expect(childrenOf(taxonomy, TASTE_PACK_HOME.id)).toEqual([...childrenOf(starter, TASTE_PACK_HOME.id), findTastePack("metal")!.folderId, findTastePack("rock")!.folderId]);
    // Hard Rock is in both packs; it goes in the first pack's folder only.
    const hardRock = findTastePack("metal")!.tags.find((tag) => tag.name === "Hard Rock")!;
    expect(taxonomy.tagsById[hardRock.id].parentId).toBe(findTastePack("metal")!.folderId);
    expect(childrenOf(taxonomy, findTastePack("rock")!.folderId)).not.toContain(hardRock.id);
    expect(buildCategoryTree(taxonomy).find((category) => category.id === TASTE_PACK_HOME.id)!.subcategories.map((folder) => folder.name))
      .toEqual(["Primary Genres", "Sub-genres", "Era & Decade", "Metal & Heavy", "Rock & Punk"]);

    const again = planTastePacksForTaxonomy(taxonomy, ["rock", "metal"]);
    expect(again.plan.upserts).toEqual([]);
    expect(again.taxonomy).toBe(taxonomy);
  });

  it("offers each pack with its first tags and what it would add", () => {
    const starter = buildStarterTaxonomy(2);
    const choices = tastePackChoices(starter);
    expect(choices.map((choice) => choice.name)).toEqual(TASTE_PACKS.map((pack) => pack.name));
    expect(choices[0]).toEqual({ key: "metal", name: "Metal & Heavy", sampleTags: ["Nu Metal", "Hard Rock", "Doom Metal", "Metalcore"], newTagCount: 11 });
    // Version 1 starter tags already have Lo-fi.
    expect(tastePackChoices(buildStarterTaxonomy(1)).find((choice) => choice.key === "chill")!.newTagCount).toBe(7);
    // A pack already added has nothing new.
    const added = tastePackChoices(withPacks(starter, ["metal"]));
    expect(added.find((choice) => choice.key === "metal")!.newTagCount).toBe(0);
    expect(added.find((choice) => choice.key === "rock")!.newTagCount).toBe(11);
  });

  it("reads tags the tree can't reach, so a pack never reuses their IDs or names", () => {
    const taxonomy = buildStarterTaxonomy(2);
    taxonomy.tagsById.tag_lost = { id: "tag_lost", name: "Djent", parentId: "sub_gone", subcategoryId: "sub_gone" };
    expect(tastePackLibraryNodes(taxonomy)).toContainEqual(expect.objectContaining({ id: "tag_lost", name: "Djent" }));
    const plan = planTastePacksForTaxonomy(taxonomy, ["metal"]).plan;
    expect(plan.packs[0].skipped).toEqual([{ id: findTastePack("metal")!.tags.find((tag) => tag.name === "Djent")!.id, name: "Djent", reason: "same-name" }]);
  });
});

describe("freshness checks with taste packs", () => {
  it.each([1, 2] as const)("count version %i starter tags with packs added as untouched", (version) => {
    const starter = buildStarterTaxonomy(version);
    const taxonomy = withPacks(starter, ALL_PACKS);
    expect(untouchedTastePackFolderIds(taxonomy)).toHaveLength(TASTE_PACKS.length);
    expect(withoutUntouchedTastePacks(taxonomy)).toEqual(starter);
    expect(hasCustomTaxonomy(taxonomy)).toBe(false);
    expect(classifyLocalReplica({ ...emptyLibrary, taxonomy }, KNOWN_STARTER_TAXONOMIES, null)).toBe("fresh-default");
  });

  it("count packs added one at a time, and packs that share tags, as untouched", () => {
    const taxonomy = withPacks(withPacks(withPacks(buildStarterTaxonomy(2), ["rock"]), ["metal"]), ["pop", "electronic"]);
    expect(hasCustomTaxonomy(taxonomy)).toBe(false);
    expect(classifyLocalReplica({ ...emptyLibrary, taxonomy }, KNOWN_STARTER_TAXONOMIES, null)).toBe("fresh-default");
  });

  it("count Genre & Style holding only packs as no tags of the library's own", () => {
    const taxonomy = withPacks(createEmptyTaxonomy(), ["metal"]);
    expect(taxonomy.categoryOrder).toEqual([TASTE_PACK_HOME.id]);
    expect(withoutUntouchedTastePacks(taxonomy).categoryOrder).toEqual([]);
    expect(hasCustomTaxonomy(taxonomy)).toBe(false);
    expect(classifyLocalReplica({ ...emptyLibrary, taxonomy }, KNOWN_STARTER_TAXONOMIES, null)).toBe("fresh-default");
  });

  const metal = findTastePack("metal")!;
  const changes: Array<[string, (taxonomy: TagTaxonomy) => void]> = [
    ["a pack tag renamed", (taxonomy) => { taxonomy.tagsById[metal.tags[0].id].name = "Nu-Metal Classics"; }],
    ["a pack tag given a color", (taxonomy) => { taxonomy.tagsById[metal.tags[0].id].accentId = "rose"; }],
    ["a pack tag removed from its folder", (taxonomy) => {
      const id = metal.tags[2].id;
      delete taxonomy.tagsById[id];
      for (const list of [taxonomy.subcategoriesById[metal.folderId].tagIds, taxonomy.subcategoriesById[metal.folderId].childIds!, taxonomy.childrenByParentId![metal.folderId], taxonomy.foldersById![metal.folderId].tagIds, taxonomy.foldersById![metal.folderId].childIds!]) {
        list.splice(list.indexOf(id), 1);
      }
    }],
    ["the pack folder renamed", (taxonomy) => { taxonomy.subcategoriesById[metal.folderId].name = "Heavy"; taxonomy.foldersById![metal.folderId].name = "Heavy"; }],
    ["a tag of the person's own added to the pack folder", (taxonomy) => {
      Object.assign(taxonomy, applyTastePackUpserts(taxonomy, [{ id: "tag_mine", kind: "tag", parentId: metal.folderId, name: "Sludge", position: 99 }]));
    }],
    ["the pack's tags reordered", (taxonomy) => {
      const list = taxonomy.childrenByParentId![metal.folderId];
      [list[0], list[1]] = [list[1], list[0]];
    }],
  ];

  it.each(changes)("count %s as the library's own tags", (_, change) => {
    const taxonomy = clone(withPacks(buildStarterTaxonomy(2), ["metal"]));
    change(taxonomy);
    expect(untouchedTastePackFolderIds(taxonomy)).toEqual([]);
    expect(hasCustomTaxonomy(taxonomy)).toBe(true);
    expect(classifyLocalReplica({ ...emptyLibrary, taxonomy }, KNOWN_STARTER_TAXONOMIES, null)).toBe("meaningful-unlinked");
  });

  it("still count a changed starter tag next to untouched packs as the library's own", () => {
    const taxonomy = clone(withPacks(buildStarterTaxonomy(2), ["metal"]));
    const rock = Object.values(taxonomy.tagsById).find((tag) => tag.name === "Rock")!;
    taxonomy.tagsById[rock.id].name = "Rock music";
    expect(hasCustomTaxonomy(taxonomy)).toBe(true);
  });

  it("leave a taxonomy without packs exactly as it is", () => {
    const starter = buildStarterTaxonomy(2);
    expect(withoutUntouchedTastePacks(starter)).toBe(starter);
    expect(withoutUntouchedTastePacks(createEmptyTaxonomy()).categoryOrder).toEqual([]);
  });
});
