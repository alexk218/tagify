import {
  planTastePackInstall,
  sameTagNameKey,
  TASTE_PACK_HOME,
  TASTE_PACK_SAMPLE_TAGS,
  TASTE_PACKS,
  type TastePackInstallPlan,
  type TastePackLibraryNode,
  type TastePackUpsert,
} from "@tagify/community-contracts";
import type { TagTaxonomy } from "@/types/tagData";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";

/**
 * Taste packs in a Tagify library: the shared planner (@tagify/community-contracts tastePacks.ts)
 * decides what adding packs changes, and these helpers read and write Tagify's own taxonomy for it,
 * so desktop and Community add the same folders and tags under the same IDs.
 */

const PACK_FOLDER_IDS = new Set(TASTE_PACKS.map((pack) => pack.folderId));

/** Whether a folder is a taste pack's folder (by its fixed ID), wherever the member keeps it. */
export function isTastePackFolderId(id: string): boolean {
  return PACK_FOLDER_IDS.has(id);
}

/** Every category, folder and tag as the planner reads them: each with its place among its parent's children. */
export function tastePackLibraryNodes(taxonomy: TagTaxonomy): TastePackLibraryNode[] {
  const normalized = normalizeTaxonomyTree(taxonomy);
  const nodes: TastePackLibraryNode[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, childIds: readonly string[]) => {
    childIds.forEach((id, position) => {
      if (seen.has(id)) return;
      const category = parentId === null ? normalized.categoriesById[id] : undefined;
      const folder = normalized.subcategoriesById[id];
      const tag = normalized.tagsById[id];
      if (category) nodes.push({ id, kind: "category", parentId: null, name: category.name, position });
      else if (folder) nodes.push({ id, kind: "folder", parentId, name: folder.name, position });
      else if (tag) nodes.push({ id, kind: "tag", parentId, name: tag.name, position });
      else return;
      seen.add(id);
      if (!tag) visit(id, normalized.childrenByParentId?.[id] || []);
    });
  };
  visit(null, [...normalized.categoryOrder, ...Object.keys(normalized.categoriesById).filter((id) => !normalized.categoryOrder.includes(id))]);
  // Nodes the tree can't reach still hold their IDs and names, so a pack never reuses either.
  const unreachable = (id: string) => !seen.has(id);
  for (const folder of Object.values(normalized.subcategoriesById)) {
    if (unreachable(folder.id)) nodes.push({ id: folder.id, kind: "folder", parentId: folder.parentId ?? null, name: folder.name, position: Number.MAX_SAFE_INTEGER });
  }
  for (const tag of Object.values(normalized.tagsById)) {
    if (unreachable(tag.id)) nodes.push({ id: tag.id, kind: "tag", parentId: tag.parentId ?? tag.subcategoryId ?? null, name: tag.name, position: Number.MAX_SAFE_INTEGER });
  }
  return nodes;
}

/**
 * Adds the planned nodes to a copy of the taxonomy, each at the end of its parent in the order
 * planned. Nothing already there is renamed, moved or removed.
 */
export function applyTastePackUpserts(current: TagTaxonomy, upserts: readonly TastePackUpsert[]): TagTaxonomy {
  if (upserts.length === 0) return current;
  const normalized = normalizeTaxonomyTree(current);
  const taxonomy: TagTaxonomy = JSON.parse(JSON.stringify(current));
  const children = (taxonomy.childrenByParentId ||= {});
  // A parent's children list starts from the order Tagify shows, so older lists stay in place.
  const started = new Set<string>();
  const childrenOf = (parentId: string) => {
    if (!started.has(parentId)) {
      started.add(parentId);
      children[parentId] = [...(normalized.childrenByParentId?.[parentId] || [])];
    }
    return children[parentId];
  };
  for (const node of upserts) {
    if (node.kind === "category") {
      taxonomy.categoryOrder = [...taxonomy.categoryOrder.filter((id) => id !== node.id), node.id];
      taxonomy.categoriesById[node.id] = { id: node.id, name: node.name, subcategoryIds: [], childIds: [] };
      started.add(node.id);
      children[node.id] = [];
      continue;
    }
    const parentId = node.parentId;
    if (!parentId) throw new Error(`A taste pack ${node.kind} needs a parent: ${node.id}`);
    const category = taxonomy.categoriesById[parentId];
    const parentFolder = taxonomy.subcategoriesById[parentId];
    if (!category && !parentFolder) throw new Error(`A taste pack ${node.kind} has no parent here: ${node.id}`);
    childrenOf(parentId).push(node.id);
    if (node.kind === "folder") {
      const folder = {
        id: node.id,
        name: node.name,
        parentId,
        categoryId: category ? parentId : normalized.subcategoriesById[parentId]?.categoryId || parentId,
        tagIds: [],
        childIds: [],
      };
      taxonomy.subcategoriesById[node.id] = folder;
      if (taxonomy.foldersById) taxonomy.foldersById[node.id] = { ...folder, tagIds: [], childIds: [] };
      started.add(node.id);
      children[node.id] = [];
      if (category) {
        category.subcategoryIds = [...category.subcategoryIds, node.id];
        category.childIds = [...(category.childIds || []), node.id];
      } else {
        parentFolder.childIds = [...(parentFolder.childIds || []), node.id];
      }
    } else {
      taxonomy.tagsById[node.id] = { id: node.id, name: node.name, parentId, subcategoryId: parentId, accentId: null };
      if (category) {
        category.childIds = [...(category.childIds || []), node.id];
      } else {
        parentFolder.tagIds = [...parentFolder.tagIds, node.id];
        parentFolder.childIds = [...(parentFolder.childIds || []), node.id];
        const listed = taxonomy.foldersById?.[parentId];
        if (listed && listed !== parentFolder) {
          listed.tagIds = [...(listed.tagIds || []), node.id];
          listed.childIds = [...(listed.childIds || []), node.id];
        }
      }
    }
  }
  return taxonomy;
}

/** What adding these packs to this taxonomy changes, and the taxonomy afterwards. */
export function planTastePacksForTaxonomy(taxonomy: TagTaxonomy, keys: readonly string[]): { plan: TastePackInstallPlan; taxonomy: TagTaxonomy } {
  const plan = planTastePackInstall(tastePackLibraryNodes(taxonomy), keys);
  return { plan, taxonomy: applyTastePackUpserts(taxonomy, plan.upserts) };
}

export interface TastePackChoice {
  key: string;
  name: string;
  /** The first few tags, most used first, to show what the pack is. */
  sampleTags: string[];
  /** How many tags adding it alone would add; 0 when the library has them all already. */
  newTagCount: number;
}

/** The packs to offer, in Tagify's order, with what each would add to this taxonomy. */
export function tastePackChoices(taxonomy: TagTaxonomy): TastePackChoice[] {
  const nodes = tastePackLibraryNodes(taxonomy);
  return TASTE_PACKS.map((pack) => ({
    key: pack.key,
    name: pack.name,
    sampleTags: pack.tags.slice(0, TASTE_PACK_SAMPLE_TAGS).map((tag) => tag.name),
    newTagCount: planTastePackInstall(nodes, [pack.key]).packs[0]?.added.length ?? 0,
  }));
}

/**
 * Pack folders exactly as adding their pack leaves them (the same rule as Community's
 * untouched_pack_folder, migration 9002): the pack's name, directly in Genre & Style, holding only
 * that pack's tags under their names, in the pack's order, without colors. Every pack tag the
 * library doesn't hold somewhere else (its ID, or a tag with the same name) is in it, so a tag
 * removed from the folder is a change, while one another pack's folder holds isn't. An empty
 * folder is a change too.
 */
export function untouchedTastePackFolderIds(taxonomy: TagTaxonomy): string[] {
  if (!TASTE_PACKS.some((pack) => taxonomy.subcategoriesById?.[pack.folderId] || taxonomy.foldersById?.[pack.folderId])) return [];
  const normalized = normalizeTaxonomyTree(taxonomy);
  if (!normalized.categoriesById[TASTE_PACK_HOME.id]) return [];
  const nodes = tastePackLibraryNodes(taxonomy);
  const untouched: string[] = [];
  for (const pack of TASTE_PACKS) {
    const folder = normalized.subcategoriesById[pack.folderId];
    if (!folder || folder.parentId !== TASTE_PACK_HOME.id || folder.name !== pack.name) continue;
    const inside = normalized.childrenByParentId?.[folder.id] || [];
    if (inside.length === 0) continue;
    if (inside.some((id) => !normalized.tagsById[id] || normalized.tagsById[id].accentId)) continue;
    const insideIds = new Set(inside);
    const elsewhere = nodes.filter((node) => node.id !== folder.id && !insideIds.has(node.id));
    const elsewhereIds = new Set(elsewhere.map((node) => node.id));
    const elsewhereNames = new Set(elsewhere.filter((node) => node.kind === "tag").map((node) => sameTagNameKey(node.name)));
    elsewhereNames.delete("");
    const expected = pack.tags
      .filter((tag) => !elsewhereIds.has(tag.id) && !elsewhereNames.has(sameTagNameKey(tag.name)))
      .map((tag) => `${tag.id}:${tag.name}`);
    const actual = inside.map((id) => `${id}:${normalized.tagsById[id].name}`);
    if (actual.length === expected.length && actual.every((entry, index) => entry === expected[index])) untouched.push(folder.id);
  }
  return untouched;
}

/**
 * The taxonomy without its untouched pack folders, so adding packs alone doesn't make starter tags
 * count as the library's own: Genre & Style goes too when it held nothing else (Community's
 * untouched_pack_home). Returns the same taxonomy when there's nothing to take out.
 */
export function withoutUntouchedTastePacks(taxonomy: TagTaxonomy): TagTaxonomy {
  const folderIds = untouchedTastePackFolderIds(taxonomy);
  if (folderIds.length === 0) return taxonomy;
  const normalized = normalizeTaxonomyTree(taxonomy);
  const removed = new Set<string>();
  for (const folderId of folderIds) {
    removed.add(folderId);
    for (const id of normalized.childrenByParentId?.[folderId] || []) removed.add(id);
  }
  const home = normalized.categoriesById[TASTE_PACK_HOME.id];
  const homeChildren = normalized.childrenByParentId?.[TASTE_PACK_HOME.id] || [];
  if (home && home.name === TASTE_PACK_HOME.name && homeChildren.length > 0 && homeChildren.every((id) => removed.has(id))) {
    removed.add(TASTE_PACK_HOME.id);
  }

  const next: TagTaxonomy = JSON.parse(JSON.stringify(taxonomy));
  const keep = (ids: string[] | undefined) => ids?.filter((id) => !removed.has(id));
  next.categoryOrder = keep(next.categoryOrder) || [];
  for (const id of removed) {
    delete next.categoriesById[id];
    delete next.subcategoriesById[id];
    delete next.tagsById[id];
    if (next.foldersById) delete next.foldersById[id];
    if (next.childrenByParentId) delete next.childrenByParentId[id];
  }
  for (const category of Object.values(next.categoriesById)) {
    category.subcategoryIds = keep(category.subcategoryIds) || [];
    if (category.childIds) category.childIds = keep(category.childIds);
  }
  for (const folders of [next.subcategoriesById, next.foldersById || {}]) {
    for (const folder of Object.values(folders)) {
      folder.tagIds = keep(folder.tagIds) || [];
      if (folder.childIds) folder.childIds = keep(folder.childIds);
    }
  }
  if (next.childrenByParentId) {
    for (const [parentId, ids] of Object.entries(next.childrenByParentId)) next.childrenByParentId[parentId] = keep(ids) || [];
  }
  return next;
}
