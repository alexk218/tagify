import { isSameTagName } from "@tagify/community-contracts";
import type { TagTaxonomy, TaxonomyTag } from "@/types/tagData";
import { addQuickTag } from "@/features/tag-data/utils/quickTag";
import { createEntityId } from "@/utils/tagTaxonomy";

/** Where a member's tag goes when none of their categories matches where other people keep it. */
export const COMMUNITY_TAGS_CATEGORY = "From Community";

/**
 * The category or folder that matches the most of "Category / Folder / … / Tag", by name, or null
 * when no category does.
 */
export function matchingTagParent(taxonomy: TagTaxonomy, path: string): string | null {
  const places = path.split(" / ").map((part) => part.trim()).filter(Boolean).slice(0, -1);
  if (!places.length) return null;
  const categoryId = taxonomy.categoryOrder.find((id) => isSameTagName(taxonomy.categoriesById[id]?.name ?? "", places[0]));
  if (!categoryId) return null;
  let parentId = categoryId;
  for (const name of places.slice(1)) {
    const folder = Object.values(taxonomy.subcategoriesById).find((candidate) =>
      (candidate.parentId ?? candidate.categoryId) === parentId && isSameTagName(candidate.name, name));
    if (!folder) break;
    parentId = folder.id;
  }
  return parentId;
}

/**
 * Where `placeCommunityTag` would file a new tag, as "Category / Folder", so the member can see it
 * before adding: the deepest matching place people keep it, or "From Community".
 */
export function communityTagDestination(taxonomy: TagTaxonomy, paths: readonly string[]): string {
  const parentId = paths.map((path) => matchingTagParent(taxonomy, path)).find(Boolean);
  if (!parentId) return COMMUNITY_TAGS_CATEGORY;
  const names: string[] = [];
  let id: string | undefined = parentId;
  // Folders nest only a few levels; the limit only guards against a malformed taxonomy.
  for (let depth = 0; id && depth < 20; depth += 1) {
    const folder: TagTaxonomy["subcategoriesById"][string] | undefined = taxonomy.subcategoriesById[id];
    if (!folder) {
      const category = taxonomy.categoriesById[id];
      if (category) names.unshift(category.name);
      break;
    }
    names.unshift(folder.name);
    id = folder.parentId ?? folder.categoryId;
  }
  return names.join(" / ") || COMMUNITY_TAGS_CATEGORY;
}

/**
 * Adds another member's tag to this library: the member's own tag of that name when they have
 * one, otherwise a new tag in the first place people keep it that this library also has, or in
 * "From Community".
 */
export function placeCommunityTag(current: TagTaxonomy, name: string, paths: readonly string[]): { taxonomy: TagTaxonomy; tag: TaxonomyTag } {
  const existing = Object.values(current.tagsById).find((tag) => isSameTagName(tag.name, name));
  if (existing) return { taxonomy: current, tag: existing };

  const matched = paths.map((path) => matchingTagParent(current, path)).find(Boolean);
  if (matched) return addQuickTag(current, name, matched);

  const ownCategoryId = current.categoryOrder.find((id) => isSameTagName(current.categoriesById[id]?.name ?? "", COMMUNITY_TAGS_CATEGORY));
  if (ownCategoryId) return addQuickTag(current, name, ownCategoryId);

  const taxonomy: TagTaxonomy = JSON.parse(JSON.stringify(current));
  const categoryId = createEntityId("cat");
  taxonomy.categoryOrder.push(categoryId);
  taxonomy.categoriesById[categoryId] = { id: categoryId, name: COMMUNITY_TAGS_CATEGORY, subcategoryIds: [], childIds: [] };
  return addQuickTag(taxonomy, name, categoryId);
}
