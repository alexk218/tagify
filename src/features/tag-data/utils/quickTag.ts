import { isSameTagName } from "@tagify/community-contracts";
import type { TagCategory, TagSubcategory, TagTaxonomy } from "@/types/tagData";
import { createEntityId } from "@/utils/tagTaxonomy";

export function getQuickTagTargets(categories: TagCategory[]) {
  const targets: { id: string; name: string }[] = [];
  const visit = (folder: TagSubcategory, path: string) => {
    const name = `${path} / ${folder.name}`;
    targets.push({ id: folder.id, name });
    folder.subcategories?.forEach((child) => visit(child, name));
  };
  categories.forEach((category) => {
    targets.push({ id: category.id, name: category.name });
    category.subcategories.forEach((folder) => visit(folder, category.name));
  });
  return targets;
}

/** Every tag once, in the order the categories and folders show them. */
export function getQuickTagTags(categories: TagCategory[]) {
  const tags = new Map<string, { id: string; name: string }>();
  const visit = (node: TagCategory | TagSubcategory) => {
    node.tags?.forEach((tag) => tags.set(tag.id, tag));
    node.subcategories?.forEach(visit);
  };
  categories.forEach(visit);
  return [...tags.values()];
}

export function getQuickTagMatches(categories: TagCategory[], query: string) {
  const text = query.trim().toLocaleLowerCase();
  return text ? getQuickTagTags(categories).filter((tag) => tag.name.toLocaleLowerCase().includes(text)) : [];
}

export function getQuickTagNameError(name: string): string | null {
  if (!name.trim()) return "Enter a tag name.";
  if (name.trim().length > 30) return "Tag names can have up to 30 characters.";
  if (/[<>]/.test(name)) return "Tag names can't include < or >.";
  return null;
}

/** Add against the current saved tree, leaving existing IDs and ordering intact. */
export function addQuickTag(current: TagTaxonomy, rawName: string, requestedParent: string) {
  const name = rawName.trim();
  const error = getQuickTagNameError(name);
  if (error) throw new Error(error);
  const taxonomy: TagTaxonomy = JSON.parse(JSON.stringify(current));
  taxonomy.childrenByParentId ||= {};
  let parentId = requestedParent;
  if (!parentId && !taxonomy.categoryOrder.length) {
    parentId = createEntityId("cat");
    taxonomy.categoryOrder.push(parentId);
    taxonomy.categoriesById[parentId] = { id: parentId, name: "Quick tags", subcategoryIds: [], childIds: [] };
  }
  const parent = taxonomy.categoriesById[parentId] || taxonomy.subcategoriesById[parentId];
  if (!parent) throw new Error("Choose a category or folder for your new tag.");
  const existing = Object.values(taxonomy.tagsById).find((tag) =>
    (tag.parentId || tag.subcategoryId) === parentId && isSameTagName(tag.name, name),
  );
  if (existing) return { taxonomy: current, tag: existing };
  const id = createEntityId("tag");
  const tag = { id, name, parentId, subcategoryId: parentId, accentId: null };
  taxonomy.tagsById[id] = tag;
  taxonomy.childrenByParentId[parentId] = [...(taxonomy.childrenByParentId[parentId] || parent.childIds || []), id];
  parent.childIds = [...(parent.childIds || []), id];
  if (taxonomy.subcategoriesById[parentId]) taxonomy.subcategoriesById[parentId].tagIds.push(id);
  return { taxonomy, tag };
}
