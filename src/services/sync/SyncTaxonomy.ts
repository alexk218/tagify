import type {
  CollectionSnapshotV1,
  CustomColorSnapshotV1,
  LibrarySnapshotV1,
  TaxonomyNodeSnapshotV1,
} from "@tagify/sync-contracts";
import type { TagTaxonomy } from "@/types/tagData";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import { isSyncSafeId, normalizeSyncName } from "./SyncLocalState";

export function expandSyncTaxonomy(snapshot: Pick<LibrarySnapshotV1, "taxonomy" | "colors" | "collections">): TagTaxonomy {
  const taxonomy: TagTaxonomy = { categoryOrder: [], categoriesById: {}, foldersById: {}, childrenByParentId: {}, subcategoriesById: {}, tagsById: {}, customAccentsById: {}, colorThemesById: {}, colorThemeOrder: [], ungroupedColorIds: [] };
  for (const node of [...snapshot.taxonomy].sort((left, right) => left.position - right.position)) {
    if (node.kind === "category") {
      taxonomy.categoryOrder.push(node.id);
      taxonomy.categoriesById[node.id] = { id: node.id, name: node.name, subcategoryIds: [], childIds: [] };
      taxonomy.childrenByParentId![node.id] ||= [];
    } else if ((node.kind === "folder" || node.kind === "subcategory") && node.parentId) {
      const folder = { id: node.id, name: node.name, parentId: node.parentId, categoryId: node.parentId, tagIds: [], childIds: [] };
      taxonomy.foldersById![node.id] = folder;
      taxonomy.subcategoriesById[node.id] = folder;
      taxonomy.childrenByParentId![node.id] ||= [];
      taxonomy.childrenByParentId![node.parentId] = [...(taxonomy.childrenByParentId![node.parentId] || []), node.id];
      if (taxonomy.categoriesById[node.parentId]) taxonomy.categoriesById[node.parentId].subcategoryIds.push(node.id);
      if (taxonomy.categoriesById[node.parentId]) taxonomy.categoriesById[node.parentId].childIds!.push(node.id);
      taxonomy.subcategoriesById[node.parentId]?.childIds?.push(node.id);
    } else if (node.kind === "tag" && node.parentId) {
      taxonomy.tagsById[node.id] = { id: node.id, name: node.name, parentId: node.parentId, subcategoryId: node.parentId, accentId: node.accentId as TagTaxonomy["tagsById"][string]["accentId"] };
      taxonomy.childrenByParentId![node.parentId] = [...(taxonomy.childrenByParentId![node.parentId] || []), node.id];
      taxonomy.subcategoriesById[node.parentId]?.tagIds.push(node.id);
      taxonomy.subcategoriesById[node.parentId]?.childIds?.push(node.id);
      taxonomy.categoriesById[node.parentId]?.childIds?.push(node.id);
    }
  }
  for (const color of snapshot.colors) taxonomy.customAccentsById[color.id] = { id: color.id as `custom:${string}`, name: color.name, color: color.color };
  for (const collection of [...snapshot.collections].sort((left, right) => left.position - right.position)) { taxonomy.colorThemeOrder?.push(collection.id); taxonomy.colorThemesById[collection.id] = { id: collection.id, name: collection.name, colorIds: collection.colorIds as `custom:${string}`[] }; }
  const grouped = new Set(snapshot.collections.flatMap((collection) => collection.colorIds));
  taxonomy.ungroupedColorIds = snapshot.colors.map((color) => color.id).filter((id) => !grouped.has(id)) as `custom:${string}`[];
  return taxonomy;
}

export function flattenTaxonomy(taxonomy: TagTaxonomy) {
  const nodes: Record<string, TaxonomyNodeSnapshotV1> = {};
  const normalized = normalizeTaxonomyTree(taxonomy);
  const visited = new Set<string>();
  // Only Community-safe identities and spellings leave the device; the local
  // library keeps its original names.
  const visit = (parentId: string | null, childIds: string[]) => {
    childIds.forEach((id, position) => {
      if (visited.has(id) || !isSyncSafeId(id)) return;
      visited.add(id);
      const category = normalized.categoriesById[id];
      const folder = normalized.subcategoriesById[id];
      const tag = normalized.tagsById[id];
      if (category) nodes[id] = { id, kind: "category", parentId: null, name: normalizeSyncName(category.name, "Untitled category"), accentId: null, position, nodeRevision: 0, parentListRevision: 0, deleted: false };
      else if (folder) nodes[id] = { id, kind: "folder", parentId, name: normalizeSyncName(folder.name, "Untitled folder"), accentId: null, position, nodeRevision: 0, parentListRevision: 0, deleted: false };
      else if (tag) nodes[id] = { id, kind: "tag", parentId, name: normalizeSyncName(tag.name, "Untitled tag"), accentId: isSyncSafeId(tag.accentId) ? tag.accentId : null, position, nodeRevision: 0, parentListRevision: 0, deleted: false };
      if (!tag) visit(id, normalized.childrenByParentId?.[id] || []);
    });
  };
  const categoryOrder = [...normalized.categoryOrder, ...Object.keys(normalized.categoriesById).filter((id) => !normalized.categoryOrder.includes(id))];
  visit(null, categoryOrder);
  const colors = Object.fromEntries(Object.values(taxonomy.customAccentsById)
    .filter((color) => isSyncSafeId(color.id) && /^#[0-9a-f]{6}$/i.test(color.color))
    .map((color) => [color.id, { id: color.id, name: normalizeSyncName(color.name, "Untitled color"), color: color.color, revision: 0, deleted: false } as CustomColorSnapshotV1]));
  const order = [...new Set([...(taxonomy.colorThemeOrder || []), ...Object.keys(taxonomy.colorThemesById)])].filter((id) => taxonomy.colorThemesById[id]);
  const collections = Object.fromEntries(order.filter(isSyncSafeId).map((id, position) => {
    const item = taxonomy.colorThemesById[id];
    return [id, { id, name: normalizeSyncName(item.name, "Untitled collection"), colorIds: item.colorIds.filter(isSyncSafeId), position, revision: 0, deleted: false } as CollectionSnapshotV1];
  }));
  return { nodes, colors, collections };
}

export interface TaxonomyShadowRecord {
  key: "taxonomy-shadow";
  nodes: Record<string, TaxonomyNodeSnapshotV1>;
  colors: Record<string, CustomColorSnapshotV1>;
  collections: Record<string, CollectionSnapshotV1>;
  parentRevisions: Record<string, number>;
}

/** The taxonomy as this device last knew it in Community. */
export function taxonomyFromShadowRecord(shadow: Pick<TaxonomyShadowRecord, "nodes" | "colors" | "collections">): TagTaxonomy {
  return expandSyncTaxonomy({
    taxonomy: Object.values(shadow.nodes).filter((node) => !node.deleted),
    colors: Object.values(shadow.colors).filter((color) => !color.deleted),
    collections: Object.values(shadow.collections).filter((collection) => !collection.deleted),
  });
}
