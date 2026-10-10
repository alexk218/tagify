import type { TagTaxonomy } from "@/types/tagData";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import { flattenTaxonomy } from "./SyncTaxonomy";
import { normalizeSyncName } from "./SyncLocalState";

/** A device name that Community stores shortened or with safe characters stays as typed. */
function deviceName(incoming: string, previous: string | undefined, fallback: string): string {
  return previous !== undefined && normalizeSyncName(previous, fallback) === incoming ? previous : incoming;
}

/**
 * Cloud taxonomy nodes carry structure, names, and colors only. Keep the
 * device-only details of nodes that still exist after a cloud rebuild:
 * Community provenance on tags and the timestamps behind Created/Updated
 * color and collection sorting.
 */
export function preserveLocalTaxonomyMetadata(incoming: TagTaxonomy, previous: TagTaxonomy | null | undefined): TagTaxonomy {
  const next: TagTaxonomy = {
    ...incoming,
    categoriesById: { ...incoming.categoriesById },
    subcategoriesById: { ...incoming.subcategoriesById },
    ...(incoming.foldersById ? { foldersById: { ...incoming.foldersById } } : {}),
    tagsById: { ...incoming.tagsById },
    customAccentsById: { ...incoming.customAccentsById },
    colorThemesById: { ...incoming.colorThemesById },
  };
  for (const [id, category] of Object.entries(next.categoriesById)) {
    const name = deviceName(category.name, previous?.categoriesById?.[id]?.name, "Untitled category");
    if (name !== category.name) next.categoriesById[id] = { ...category, name };
  }
  for (const [id, folder] of Object.entries(next.subcategoriesById)) {
    const name = deviceName(folder.name, previous?.subcategoriesById?.[id]?.name, "Untitled folder");
    if (name === folder.name) continue;
    next.subcategoriesById[id] = { ...folder, name };
    if (next.foldersById?.[id]) next.foldersById[id] = next.subcategoriesById[id];
  }
  for (const [id, tag] of Object.entries(next.tagsById)) {
    const before = previous?.tagsById?.[id];
    const name = deviceName(tag.name, before?.name, "Untitled tag");
    const source = !tag.source && before?.source ? { source: before.source } : {};
    if (name !== tag.name || "source" in source) next.tagsById[id] = { ...tag, name, ...source };
  }
  const collectionByColorId = new Map<string, string>();
  for (const [id, collection] of Object.entries(next.colorThemesById)) {
    const before = previous?.colorThemesById?.[id];
    next.colorThemesById[id] = {
      ...collection,
      name: deviceName(collection.name, before?.name, "Untitled collection"),
      ...(collection.createdAt === undefined && typeof before?.createdAt === "number" ? { createdAt: before.createdAt } : {}),
      ...(collection.updatedAt === undefined && typeof before?.updatedAt === "number" ? { updatedAt: before.updatedAt } : {}),
    };
    collection.colorIds.forEach((colorId) => collectionByColorId.set(colorId, id));
  }
  for (const [id, color] of Object.entries(next.customAccentsById)) {
    const before = previous?.customAccentsById?.[id];
    next.customAccentsById[id] = {
      ...color,
      name: deviceName(color.name, before?.name, "Untitled color"),
      themeId: collectionByColorId.get(id) ?? null,
      ...(color.createdAt === undefined && typeof before?.createdAt === "number" ? { createdAt: before.createdAt } : {}),
      ...(color.updatedAt === undefined && typeof before?.updatedAt === "number" ? { updatedAt: before.updatedAt } : {}),
    };
  }
  return next;
}

/** Every taxonomy identity the cloud copy has held, including ones it deleted. */
export interface KnownCloudTaxonomy {
  nodes: ReadonlySet<string>;
  colors: ReadonlySet<string>;
  collections: ReadonlySet<string>;
}

export function knownCloudTaxonomy(...copies: Array<{ nodes: Record<string, unknown>; colors: Record<string, unknown>; collections: Record<string, unknown> } | null | undefined>): KnownCloudTaxonomy {
  const ids = (key: "nodes" | "colors" | "collections") => new Set(copies.flatMap((copy) => Object.keys(copy?.[key] ?? {})));
  return { nodes: ids("nodes"), colors: ids("colors"), collections: ids("collections") };
}

/**
 * Keeps device items that are absent from the cloud copy without having been
 * removed there: nodes whose identity Community cannot store (and nodes under
 * them), and, when `known` lists what the cloud copy has ever held, items it
 * has never received (for example a new tag whose backup is still waiting).
 * They stay under their original parent when it survives.
 */
export function preserveUnsyncableTaxonomy(incoming: TagTaxonomy, previous: TagTaxonomy | null | undefined, known?: KnownCloudTaxonomy): TagTaxonomy {
  if (!previous) return incoming;
  const old = normalizeTaxonomyTree(previous);
  const synced = new Set(Object.keys(flattenTaxonomy(old).nodes));
  const syncedColors = flattenTaxonomy(old).colors;
  const kept = addMissingTaxonomyItems(
    incoming, old,
    (id) => !synced.has(id) || Boolean(known && !known.nodes.has(id)),
    (id) => !syncedColors[id] || Boolean(known && !known.colors.has(id)),
  );
  return known ? addMissingCollections(kept, old, (id) => !known.collections.has(id)) : kept;
}

/**
 * Adds every category, folder, tag, color, and collection of `source` that
 * `target` lacks, under its original parent when that parent exists. Nothing
 * in `target` is renamed, moved, or removed.
 */
export function addMissingTaxonomy(target: TagTaxonomy, source: TagTaxonomy): TagTaxonomy {
  const old = normalizeTaxonomyTree(source);
  return addMissingCollections(addMissingTaxonomyItems(target, old, () => true, () => true), old, () => true);
}

function addMissingCollections(incoming: TagTaxonomy, old: TagTaxonomy, include: (id: string) => boolean): TagTaxonomy {
  const next = { ...incoming, colorThemesById: { ...incoming.colorThemesById }, colorThemeOrder: [...(incoming.colorThemeOrder ?? [])], customAccentsById: { ...incoming.customAccentsById } };
  for (const id of new Set([...(old.colorThemeOrder ?? []), ...Object.keys(old.colorThemesById)])) {
    const collection = old.colorThemesById[id];
    if (!collection || next.colorThemesById[id] || !include(id)) continue;
    const colorIds = collection.colorIds.filter((colorId) => next.customAccentsById[colorId]);
    next.colorThemesById[id] = { ...collection, colorIds };
    next.colorThemeOrder.push(id);
    for (const colorId of colorIds) next.customAccentsById[colorId] = { ...next.customAccentsById[colorId], themeId: next.customAccentsById[colorId].themeId ?? id };
    next.ungroupedColorIds = next.ungroupedColorIds.filter((colorId) => !colorIds.includes(colorId));
  }
  return normalizeTaxonomyTree(next);
}

function addMissingTaxonomyItems(incoming: TagTaxonomy, old: TagTaxonomy, includeNode: (id: string) => boolean, includeColor: (id: string) => boolean): TagTaxonomy {
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
      if (includeNode(id) && !exists) {
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
  for (const [id, color] of Object.entries(old.customAccentsById)) {
    if (includeColor(id) && !next.customAccentsById[id]) {
      next.customAccentsById[id] = { ...color, themeId: null };
      next.ungroupedColorIds = [...next.ungroupedColorIds, id as `custom:${string}`];
    }
  }
  return normalizeTaxonomyTree(next);
}

/**
 * Rebuilds the device taxonomy from the cloud copy without losing device-only
 * details. Pass `known` (see knownCloudTaxonomy) so device items the cloud has
 * never received are kept; only items the cloud removed disappear.
 */
export function rebuildDeviceTaxonomy(incoming: TagTaxonomy, previous: TagTaxonomy | null | undefined, known?: KnownCloudTaxonomy): TagTaxonomy {
  return preserveLocalTaxonomyMetadata(preserveUnsyncableTaxonomy(incoming, previous, known), previous);
}
