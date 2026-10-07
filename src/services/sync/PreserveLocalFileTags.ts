import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";

/** Keep names and parent paths for local-file tags absent from a cloud snapshot. */
export function preserveLocalFileTags(incoming: TagTaxonomy, previous: TagTaxonomy, tracks: Record<string, TrackData>): TagTaxonomy {
  const next = normalizeTaxonomyTree(JSON.parse(JSON.stringify(incoming)));
  const old = normalizeTaxonomyTree(previous);
  const visiting = new Set<string>();
  const attach = (parent: string, child: string) => {
    const children = next.childrenByParentId![parent] ?? [];
    if (!children.includes(child)) next.childrenByParentId![parent] = [...children, child];
  };
  const preserveParent = (id: string): void => {
    if (next.categoriesById[id] || next.subcategoriesById[id] || visiting.has(id)) return;
    visiting.add(id);
    const category = old.categoriesById[id];
    if (category) {
      next.categoriesById[id] = { ...category, subcategoryIds: [], childIds: [] };
      next.categoryOrder.push(id);
      next.childrenByParentId![id] = [];
      return;
    }
    const folder = old.subcategoriesById[id];
    const parent = folder?.parentId ?? folder?.categoryId;
    if (!folder || !parent) return;
    preserveParent(parent);
    next.subcategoriesById[id] = { ...folder, tagIds: [], childIds: [] };
    next.foldersById![id] = next.subcategoriesById[id];
    next.childrenByParentId![id] = [];
    attach(parent, id);
  };
  for (const id of new Set(Object.values(tracks).flatMap((track) => track.tagIds))) {
    if (next.tagsById[id]) continue;
    const tag = old.tagsById[id];
    if (!tag) continue;
    const parent = tag.parentId ?? tag.subcategoryId;
    preserveParent(parent);
    next.tagsById[id] = { ...tag };
    if (tag.accentId?.startsWith("custom:") && old.customAccentsById[tag.accentId as `custom:${string}`]) {
      const accentId = tag.accentId as `custom:${string}`;
      next.customAccentsById[accentId] = old.customAccentsById[accentId];
    }
    attach(parent, id);
  }
  return normalizeTaxonomyTree(next);
}
