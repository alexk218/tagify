import {
  CustomTagAccent,
  Tag,
  TagCategory,
  TagSubcategory,
  TagTaxonomy,
  TaxonomyCategory,
  TaxonomyFolder,
  TaxonomySubcategory,
  TaxonomyTag,
  TrackData,
} from "@/types/tagData";
import {
  normalizeCustomTagAccents,
  normalizeTagAccentId,
} from "@/features/tag-data/utils/tagAccent";

export const TAG_DATA_SCHEMA_VERSION = 9;

type OpaquePrefix = "cat" | "sub" | "tag";

export interface ResolvedTagNode {
  id: string;
  name: string;
  tag: TaxonomyTag;
  subcategory: TaxonomySubcategory | null;
  parent: TaxonomyCategory | TaxonomyFolder;
  category: TaxonomyCategory;
  categoryName: string;
  subcategoryName: string;
  folderPath: string[];
  displayPath: string;
  categoryOrder: number;
  subcategoryOrder: number;
  tagOrder: number;
}

export function compareResolvedTagsByTaxonomyOrder(
  left: ResolvedTagNode,
  right: ResolvedTagNode,
): number {
  return (
    left.categoryOrder - right.categoryOrder ||
    left.subcategoryOrder - right.subcategoryOrder ||
    left.tagOrder - right.tagOrder ||
    left.displayPath.localeCompare(right.displayPath)
  );
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

function createDeterministicOpaqueId(prefix: OpaquePrefix, seed: string): string {
  return `${prefix}_${hashString(seed)}`;
}

export function createLegacyCategoryIdentityId(categoryId: string): string {
  return createDeterministicOpaqueId("cat", `legacy:category:${categoryId}`);
}

export function createLegacySubcategoryIdentityId(
  categoryId: string,
  subcategoryId: string,
): string {
  return createDeterministicOpaqueId(
    "sub",
    `legacy:subcategory:${categoryId}:${subcategoryId}`,
  );
}

export function createLegacyTagIdentityId(
  categoryId: string,
  subcategoryId: string,
  tagId: string,
): string {
  return createDeterministicOpaqueId(
    "tag",
    `legacy:tag:${categoryId}:${subcategoryId}:${tagId}`,
  );
}

function isOpaqueId(id: string, prefix: OpaquePrefix): boolean {
  return id.startsWith(`${prefix}_`);
}

export function createEntityId(prefix: OpaquePrefix): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyTaxonomy(): TagTaxonomy {
  return {
    categoryOrder: [],
    categoriesById: {},
    foldersById: {},
    childrenByParentId: {},
    subcategoriesById: {},
    tagsById: {},
    customAccentsById: {},
    colorThemesById: {},
    colorThemeOrder: [],
    ungroupedColorIds: [],
  };
}

export function buildTaxonomyFromCategoryTree(categories: TagCategory[]): TagTaxonomy {
  const taxonomy = createEmptyTaxonomy();

  categories.forEach((category) => {
    const nextCategoryId = isOpaqueId(category.id, "cat")
      ? category.id
      : createLegacyCategoryIdentityId(category.id);

    taxonomy.categoryOrder.push(nextCategoryId);
    taxonomy.categoriesById[nextCategoryId] = {
      id: nextCategoryId,
      name: category.name,
      subcategoryIds: [],
      childIds: [],
    };
    taxonomy.childrenByParentId![nextCategoryId] = [];

    category.subcategories.forEach((subcategory) => {
      const nextSubcategoryId = isOpaqueId(subcategory.id, "sub")
        ? subcategory.id
        : createLegacySubcategoryIdentityId(category.id, subcategory.id);

      taxonomy.categoriesById[nextCategoryId].subcategoryIds.push(nextSubcategoryId);
      taxonomy.categoriesById[nextCategoryId].childIds!.push(nextSubcategoryId);
      taxonomy.childrenByParentId![nextCategoryId].push(nextSubcategoryId);
      taxonomy.subcategoriesById[nextSubcategoryId] = {
        id: nextSubcategoryId,
        name: subcategory.name,
        parentId: nextCategoryId,
        categoryId: nextCategoryId,
        tagIds: [],
        childIds: [],
      };
      taxonomy.foldersById![nextSubcategoryId] = taxonomy.subcategoriesById[nextSubcategoryId];
      taxonomy.childrenByParentId![nextSubcategoryId] = [];

      subcategory.tags.forEach((tag) => {
        const nextTagId = isOpaqueId(tag.id, "tag")
          ? tag.id
          : createLegacyTagIdentityId(category.id, subcategory.id, tag.id);

        taxonomy.subcategoriesById[nextSubcategoryId].tagIds.push(nextTagId);
        taxonomy.subcategoriesById[nextSubcategoryId].childIds!.push(nextTagId);
        taxonomy.childrenByParentId![nextSubcategoryId].push(nextTagId);
        taxonomy.tagsById[nextTagId] = {
          id: nextTagId,
          name: tag.name,
          parentId: nextSubcategoryId,
          subcategoryId: nextSubcategoryId,
          accentId: normalizeTagAccentId(tag.accentId),
        };
      });
    });
  });

  return taxonomy;
}

function buildTagNode(
  tag: TaxonomyTag,
  customAccentsById: Record<string, CustomTagAccent>,
): Tag {
  return {
    id: tag.id,
    name: tag.name,
    accentId: normalizeTagAccentId(tag.accentId, customAccentsById),
  };
}

export function normalizeTaxonomyCustomAccents(
  taxonomy: Partial<TagTaxonomy> | null | undefined,
): Record<string, CustomTagAccent> {
  return normalizeCustomTagAccents(taxonomy?.customAccentsById);
}

function buildSubcategoryNode(
  taxonomy: TagTaxonomy,
  subcategory: TaxonomySubcategory,
): TagSubcategory {
  const childIds = taxonomy.childrenByParentId?.[subcategory.id] || subcategory.childIds || subcategory.tagIds;
  return {
    id: subcategory.id,
    name: subcategory.name,
    tags: childIds
      .map((tagId) => taxonomy.tagsById[tagId])
      .filter((tag): tag is TaxonomyTag => Boolean(tag))
      .map((tag) => buildTagNode(tag, taxonomy.customAccentsById)),
    subcategories: childIds
      .map((folderId) => taxonomy.subcategoriesById[folderId])
      .filter((folder): folder is TaxonomySubcategory => Boolean(folder))
      .map((folder) => buildSubcategoryNode(taxonomy, folder)),
  };
}

export function buildCategoryTree(taxonomy: TagTaxonomy): TagCategory[] {
  const normalized = normalizeTaxonomyTree(taxonomy);
  return normalized.categoryOrder
    .map((categoryId) => normalized.categoriesById[categoryId])
    .filter((category): category is TaxonomyCategory => Boolean(category))
    .map((category) => ({
      id: category.id,
      name: category.name,
      tags: (normalized.childrenByParentId?.[category.id] || [])
        .map((childId) => normalized.tagsById[childId])
        .filter((tag): tag is TaxonomyTag => Boolean(tag))
        .map((tag) => buildTagNode(tag, normalized.customAccentsById)),
      subcategories: (normalized.childrenByParentId?.[category.id] || category.subcategoryIds)
        .map((subcategoryId) => normalized.subcategoriesById[subcategoryId])
        .filter((subcategory): subcategory is TaxonomySubcategory => Boolean(subcategory))
        .map((subcategory) => buildSubcategoryNode(normalized, subcategory)),
    }));
}

export function buildResolvedTagLookup(
  taxonomy: TagTaxonomy,
): Map<string, ResolvedTagNode> {
  const normalized = normalizeTaxonomyTree(taxonomy);
  const resolvedTagLookup = new Map<string, ResolvedTagNode>();

  normalized.categoryOrder.forEach((categoryId, categoryOrder) => {
    const category = normalized.categoriesById[categoryId];
    if (!category) {
      return;
    }
    visitTaxonomyChildren(normalized, category.id, [category.name], category, categoryOrder, resolvedTagLookup);
  });

  return resolvedTagLookup;
}

function visitTaxonomyChildren(
  taxonomy: TagTaxonomy,
  parentId: string,
  path: string[],
  category: TaxonomyCategory,
  categoryOrder: number,
  resolvedTagLookup: Map<string, ResolvedTagNode>,
) {
  (taxonomy.childrenByParentId?.[parentId] || []).forEach((childId, index) => {
    const folder = taxonomy.subcategoriesById[childId];
    if (folder) {
      visitTaxonomyChildren(taxonomy, folder.id, [...path, folder.name], category, categoryOrder, resolvedTagLookup);
      return;
    }
    const tag = taxonomy.tagsById[childId];
    if (!tag) return;
    const parent = taxonomy.subcategoriesById[parentId] || taxonomy.categoriesById[parentId];
    if (!parent) return;
    const folderPath = path.slice(1);
    resolvedTagLookup.set(tagIdOf(tag), {
      id: tag.id,
      name: tag.name,
      tag,
      subcategory: taxonomy.subcategoriesById[tag.subcategoryId] || null,
      parent,
      category,
      categoryName: category.name,
      subcategoryName: folderPath.at(-1) || category.name,
      folderPath,
      displayPath: [...path, tag.name].join(" > "),
      categoryOrder,
      subcategoryOrder: index,
      tagOrder: index,
    });
  });
}

function tagIdOf(tag: TaxonomyTag) {
  return tag.id;
}

export function resolveTagId(
  taxonomy: TagTaxonomy,
  tagId: string,
): ResolvedTagNode | null {
  return buildResolvedTagLookup(taxonomy).get(tagId) ?? null;
}

export function buildValidTagIdSet(taxonomy: TagTaxonomy): Set<string> {
  return new Set(Object.keys(taxonomy.tagsById));
}

export function keepTracksWithValidTagIds(
  tracks: Record<string, TrackData>,
  validTagIds: Set<string>,
): Record<string, TrackData> {
  const nextTracks: Record<string, TrackData> = {};

  Object.entries(tracks).forEach(([trackUri, trackData]) => {
    const nextTagIds = trackData.tagIds.filter((tagId) => validTagIds.has(tagId));
    const nextTrackData: TrackData = {
      ...trackData,
      tagIds: nextTagIds,
    };

    if (
      nextTrackData.rating !== 0 ||
      nextTrackData.energy !== 0 ||
      nextTrackData.tagIds.length > 0
    ) {
      nextTracks[trackUri] = nextTrackData;
    }
  });

  return nextTracks;
}

export function findTagNameInTaxonomy(
  taxonomy: TagTaxonomy,
  tagId: string,
): string {
  return taxonomy.tagsById[tagId]?.name || "";
}

export function findTagAccentId(
  taxonomy: TagTaxonomy,
  tagId: string,
) {
  return normalizeTagAccentId(taxonomy.tagsById[tagId]?.accentId);
}

export function buildDuplicateTagNameSet(taxonomy: TagTaxonomy): Set<string> {
  const usageCounts = new Map<string, number>();

  Object.values(taxonomy.tagsById).forEach((tag) => {
    usageCounts.set(tag.name.toLowerCase(), (usageCounts.get(tag.name.toLowerCase()) || 0) + 1);
  });

  return new Set(
    Array.from(usageCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
}

export function findDisplayTagName(
  taxonomy: TagTaxonomy,
  tagId: string,
  options: { disambiguate?: boolean } = {},
): string {
  const resolvedTag = resolveTagId(taxonomy, tagId);
  if (!resolvedTag) {
    return tagId;
  }

  const { disambiguate = false } = options;
  if (!disambiguate) {
    return resolvedTag.name;
  }

  const duplicateNames = buildDuplicateTagNameSet(taxonomy);
  if (!duplicateNames.has(resolvedTag.name.toLowerCase())) {
    return resolvedTag.name;
  }

  return `${resolvedTag.name} (${[resolvedTag.categoryName, ...resolvedTag.folderPath].filter(Boolean).join(" / ")})`;
}

export function collectTagIdsForSubcategory(
  taxonomy: TagTaxonomy,
  subcategoryId: string,
): string[] {
  const normalized = normalizeTaxonomyTree(taxonomy);
  return collectTagIdsForParent(normalized, subcategoryId);
}

export function collectTagIdsForCategory(
  taxonomy: TagTaxonomy,
  categoryId: string,
): string[] {
  const category = taxonomy.categoriesById[categoryId];
  if (!category) {
    return [];
  }

  return collectTagIdsForParent(normalizeTaxonomyTree(taxonomy), categoryId);
}

export function collectTagIdsForParent(taxonomy: TagTaxonomy, parentId: string): string[] {
  const normalized = normalizeTaxonomyTree(taxonomy);
  return (normalized.childrenByParentId?.[parentId] || []).flatMap((childId) => (
    normalized.tagsById[childId] ? [childId] : collectTagIdsForParent(normalized, childId)
  ));
}

export function normalizeTaxonomyTree(taxonomy: TagTaxonomy): TagTaxonomy {
  const next = JSON.parse(JSON.stringify(taxonomy)) as TagTaxonomy;
  next.foldersById = { ...(next.foldersById || {}), ...next.subcategoriesById };
  next.childrenByParentId = { ...(next.childrenByParentId || {}) };
  const appendChild = (parentId: string, childId: string) => {
    const children = next.childrenByParentId![parentId] || [];
    next.childrenByParentId![parentId] = children.includes(childId) ? children : [...children, childId];
  };
  next.categoryOrder.forEach((categoryId) => {
    const category = next.categoriesById[categoryId];
    if (!category) return;
    const childIds = [...new Set([...(category.childIds || []), ...(category.subcategoryIds || [])])];
    category.childIds = childIds;
    next.childrenByParentId![categoryId] = [...new Set([...(next.childrenByParentId![categoryId] || []), ...childIds])];
  });
  Object.values(next.foldersById).forEach((folder) => {
    const parentId = folder.parentId || folder.categoryId;
    if (!parentId) return;
    folder.parentId = parentId;
    folder.categoryId ||= rootCategoryId(next, parentId) || parentId;
    folder.childIds = [...new Set([...(folder.childIds || []), ...(folder.tagIds || [])])];
    next.subcategoriesById[folder.id] = folder;
    next.childrenByParentId![folder.id] = [...new Set([...(next.childrenByParentId![folder.id] || []), ...folder.childIds])];
    appendChild(parentId, folder.id);
    const parentCategory = next.categoriesById[parentId];
    if (parentCategory && !parentCategory.subcategoryIds.includes(folder.id)) parentCategory.subcategoryIds.push(folder.id);
    if (parentCategory && !parentCategory.childIds?.includes(folder.id)) parentCategory.childIds = [...(parentCategory.childIds || []), folder.id];
  });
  Object.values(next.tagsById).forEach((tag) => {
    const parentId = tag.parentId || tag.subcategoryId;
    tag.parentId = parentId;
    tag.subcategoryId = parentId;
    appendChild(parentId, tag.id);
    const parentFolder = next.subcategoriesById[parentId];
    if (parentFolder && !parentFolder.tagIds.includes(tag.id)) parentFolder.tagIds.push(tag.id);
    if (parentFolder && !parentFolder.childIds?.includes(tag.id)) parentFolder.childIds = [...(parentFolder.childIds || []), tag.id];
    const parentCategory = next.categoriesById[parentId];
    if (parentCategory && !parentCategory.childIds?.includes(tag.id)) parentCategory.childIds = [...(parentCategory.childIds || []), tag.id];
  });
  return next;
}

function rootCategoryId(taxonomy: TagTaxonomy, nodeId: string): string | null {
  if (taxonomy.categoriesById[nodeId]) return nodeId;
  let cursor = taxonomy.foldersById?.[nodeId] || taxonomy.subcategoriesById[nodeId];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const parentId = cursor.parentId || cursor.categoryId;
    if (!parentId) return null;
    if (taxonomy.categoriesById[parentId]) return parentId;
    cursor = taxonomy.foldersById?.[parentId] || taxonomy.subcategoriesById[parentId];
  }
  return null;
}

export function migrateLegacyFilterTagId(tagId: string): string {
  const parts = tagId.split(":");
  if (parts.length !== 3) {
    return tagId;
  }

  return createLegacyTagIdentityId(parts[0], parts[1], parts[2]);
}
