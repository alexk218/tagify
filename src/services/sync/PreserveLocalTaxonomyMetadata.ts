import type { TagTaxonomy } from "@/types/tagData";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import { flattenTaxonomy } from "./SyncTaxonomy";

/**
 * Cloud taxonomy nodes carry structure, names, and colors only. Keep the
 * device-only details of nodes that still exist after a cloud rebuild:
 * Community provenance on tags and the timestamps behind Created/Updated
 * color and collection sorting.
 */
export function preserveLocalTaxonomyMetadata(incoming: TagTaxonomy, previous: TagTaxonomy | null | undefined): TagTaxonomy {
  const next: TagTaxonomy = {
    ...incoming,
    tagsById: { ...incoming.tagsById },
    customAccentsById: { ...incoming.customAccentsById },
    colorThemesById: { ...incoming.colorThemesById },
  };
  for (const [id, tag] of Object.entries(next.tagsById)) {
    const source = previous?.tagsById?.[id]?.source;
    if (!tag.source && source) next.tagsById[id] = { ...tag, source };
  }
  const collectionByColorId = new Map<string, string>();
  for (const [id, collection] of Object.entries(next.colorThemesById)) {
    const before = previous?.colorThemesById?.[id];
    next.colorThemesById[id] = {
      ...collection,
      ...(collection.createdAt === undefined && typeof before?.createdAt === "number" ? { createdAt: before.createdAt } : {}),
      ...(collection.updatedAt === undefined && typeof before?.updatedAt === "number" ? { updatedAt: before.updatedAt } : {}),
    };
    collection.colorIds.forEach((colorId) => collectionByColorId.set(colorId, id));
  }
  for (const [id, color] of Object.entries(next.customAccentsById)) {
    const before = previous?.customAccentsById?.[id];
    next.customAccentsById[id] = {
      ...color,
      themeId: collectionByColorId.get(id) ?? null,
      ...(color.createdAt === undefined && typeof before?.createdAt === "number" ? { createdAt: before.createdAt } : {}),
      ...(color.updatedAt === undefined && typeof before?.updatedAt === "number" ? { updatedAt: before.updatedAt } : {}),
    };
  }
  return next;
}

/**
 * Nodes whose identity Community cannot store (or that sit under such a node)
 * never reach the cloud copy. Keep them on the device when the taxonomy is
 * rebuilt from the cloud copy, under their original parent when it survives.
 */
export function preserveUnsyncableTaxonomy(incoming: TagTaxonomy, previous: TagTaxonomy | null | undefined): TagTaxonomy {
  if (!previous) return incoming;
  const old = normalizeTaxonomyTree(previous);
  const synced = new Set(Object.keys(flattenTaxonomy(old).nodes));
  const next = normalizeTaxonomyTree(JSON.parse(JSON.stringify(incoming)) as TagTaxonomy);
  const attach = (parent: string, child: string) => {
    const children = next.childrenByParentId![parent] ?? [];
    if (!children.includes(child)) next.childrenByParentId![parent] = [...children, child];
  };
  const visit = (parentId: string | null, childIds: string[]) => {
    for (const id of childIds) {
      const category = old.categoriesById[id];
      const folder = old.subcategoriesById[id];
      const tag = old.tagsById[id];
      const exists = Boolean(next.categoriesById[id] || next.subcategoriesById[id] || next.tagsById[id]);
      if (!synced.has(id) && !exists) {
        if (category) {
          next.categoriesById[id] = { ...category, subcategoryIds: [], childIds: [] };
          next.categoryOrder.push(id);
          next.childrenByParentId![id] = [];
        } else if (parentId && (next.categoriesById[parentId] || next.subcategoriesById[parentId])) {
          if (folder) {
            next.subcategoriesById[id] = { ...folder, tagIds: [], childIds: [] };
            next.foldersById![id] = next.subcategoriesById[id];
            next.childrenByParentId![id] = [];
          } else if (tag) {
            next.tagsById[id] = { ...tag };
          } else continue;
          attach(parentId, id);
        } else continue;
      }
      if (!tag) visit(id, old.childrenByParentId?.[id] ?? []);
    }
  };
  visit(null, old.categoryOrder);
  const syncedColors = flattenTaxonomy(old).colors;
  for (const [id, color] of Object.entries(old.customAccentsById)) {
    if (!syncedColors[id] && !next.customAccentsById[id]) {
      next.customAccentsById[id] = { ...color, themeId: null };
      next.ungroupedColorIds = [...next.ungroupedColorIds, id as `custom:${string}`];
    }
  }
  return normalizeTaxonomyTree(next);
}

/** Rebuilds the device taxonomy from the cloud copy without losing device-only details. */
export function rebuildDeviceTaxonomy(incoming: TagTaxonomy, previous: TagTaxonomy | null | undefined): TagTaxonomy {
  return preserveLocalTaxonomyMetadata(preserveUnsyncableTaxonomy(incoming, previous), previous);
}
