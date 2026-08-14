import {
  CustomTagAccent,
  Tag,
  TagCategory,
  TagSubcategory,
  TagTaxonomy,
  TaxonomyCategory,
  TaxonomySubcategory,
  TaxonomyTag,
  TrackData,
} from "@/types/tagData";
import {
  normalizeCustomTagAccents,
  normalizeTagAccentId,
} from "@/features/tag-data/utils/tagAccent";

export const TAG_DATA_SCHEMA_VERSION = 8;

type OpaquePrefix = "cat" | "sub" | "tag";

export interface ResolvedTagNode {
  id: string;
  name: string;
  tag: TaxonomyTag;
  subcategory: TaxonomySubcategory;
  category: TaxonomyCategory;
  categoryName: string;
  subcategoryName: string;
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
    };

    category.subcategories.forEach((subcategory) => {
      const nextSubcategoryId = isOpaqueId(subcategory.id, "sub")
        ? subcategory.id
        : createLegacySubcategoryIdentityId(category.id, subcategory.id);

      taxonomy.categoriesById[nextCategoryId].subcategoryIds.push(nextSubcategoryId);
      taxonomy.subcategoriesById[nextSubcategoryId] = {
        id: nextSubcategoryId,
        name: subcategory.name,
        categoryId: nextCategoryId,
        tagIds: [],
      };

      subcategory.tags.forEach((tag) => {
        const nextTagId = isOpaqueId(tag.id, "tag")
          ? tag.id
          : createLegacyTagIdentityId(category.id, subcategory.id, tag.id);

        taxonomy.subcategoriesById[nextSubcategoryId].tagIds.push(nextTagId);
        taxonomy.tagsById[nextTagId] = {
          id: nextTagId,
          name: tag.name,
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
  return {
    id: subcategory.id,
    name: subcategory.name,
    tags: subcategory.tagIds
      .map((tagId) => taxonomy.tagsById[tagId])
      .filter((tag): tag is TaxonomyTag => Boolean(tag))
      .map((tag) => buildTagNode(tag, taxonomy.customAccentsById)),
  };
}

export function buildCategoryTree(taxonomy: TagTaxonomy): TagCategory[] {
  return taxonomy.categoryOrder
    .map((categoryId) => taxonomy.categoriesById[categoryId])
    .filter((category): category is TaxonomyCategory => Boolean(category))
    .map((category) => ({
      id: category.id,
      name: category.name,
      subcategories: category.subcategoryIds
        .map((subcategoryId) => taxonomy.subcategoriesById[subcategoryId])
        .filter((subcategory): subcategory is TaxonomySubcategory => Boolean(subcategory))
        .map((subcategory) => buildSubcategoryNode(taxonomy, subcategory)),
    }));
}

export function buildResolvedTagLookup(
  taxonomy: TagTaxonomy,
): Map<string, ResolvedTagNode> {
  const resolvedTagLookup = new Map<string, ResolvedTagNode>();

  taxonomy.categoryOrder.forEach((categoryId, categoryOrder) => {
    const category = taxonomy.categoriesById[categoryId];
    if (!category) {
      return;
    }

    category.subcategoryIds.forEach((subcategoryId, subcategoryOrder) => {
      const subcategory = taxonomy.subcategoriesById[subcategoryId];
      if (!subcategory) {
        return;
      }

      subcategory.tagIds.forEach((tagId, tagOrder) => {
        const tag = taxonomy.tagsById[tagId];
        if (!tag) {
          return;
        }

        resolvedTagLookup.set(tagId, {
          id: tag.id,
          name: tag.name,
          tag,
          subcategory,
          category,
          categoryName: category.name,
          subcategoryName: subcategory.name,
          displayPath: `${category.name} > ${subcategory.name} > ${tag.name}`,
          categoryOrder,
          subcategoryOrder,
          tagOrder,
        });
      });
    });
  });

  return resolvedTagLookup;
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

  return `${resolvedTag.name} (${resolvedTag.subcategoryName} / ${resolvedTag.categoryName})`;
}

export function collectTagIdsForSubcategory(
  taxonomy: TagTaxonomy,
  subcategoryId: string,
): string[] {
  return [...(taxonomy.subcategoriesById[subcategoryId]?.tagIds || [])];
}

export function collectTagIdsForCategory(
  taxonomy: TagTaxonomy,
  categoryId: string,
): string[] {
  const category = taxonomy.categoriesById[categoryId];
  if (!category) {
    return [];
  }

  return category.subcategoryIds.flatMap((subcategoryId) =>
    collectTagIdsForSubcategory(taxonomy, subcategoryId),
  );
}

export function migrateLegacyFilterTagId(tagId: string): string {
  const parts = tagId.split(":");
  if (parts.length !== 3) {
    return tagId;
  }

  return createLegacyTagIdentityId(parts[0], parts[1], parts[2]);
}
