import { TagAccentId, TagTaxonomy, TrackTag } from "@/types/tagData";
import { buildResolvedTagLookup } from "@/utils/tagTaxonomy";

interface GroupedTag {
  id: string;
  name: string;
  order: number;
  accentId: TagAccentId | null;
}

interface GroupedSubcategory {
  subcategoryName: string;
  subcategoryOrder: number;
  tags: GroupedTag[];
}

interface GroupedCategory {
  categoryName: string;
  categoryOrder: number;
  subcategories: Record<string, GroupedSubcategory>;
}

export type GroupedTagsByCategory = Record<string, GroupedCategory>;

export function organizeTrackTagsByCategory(
  taxonomy: TagTaxonomy,
  trackTagIds: TrackTag[],
): GroupedTagsByCategory {
  const groupedTags: GroupedTagsByCategory = {};
  const resolvedTagLookup = buildResolvedTagLookup(taxonomy);

  taxonomy.categoryOrder.forEach((categoryId, categoryIndex) => {
    const category = taxonomy.categoriesById[categoryId];
    if (!category) {
      return;
    }

    groupedTags[category.id] = {
      categoryName: category.name,
      categoryOrder: categoryIndex,
      subcategories: {},
    };

    category.subcategoryIds.forEach((subcategoryId, subcategoryIndex) => {
      const subcategory = taxonomy.subcategoriesById[subcategoryId];
      if (!subcategory) {
        return;
      }

      groupedTags[category.id].subcategories[subcategory.id] = {
        subcategoryName: subcategory.name,
        subcategoryOrder: subcategoryIndex,
        tags: [],
      };
    });
  });

  trackTagIds.forEach((tagId) => {
    const resolvedTag = resolvedTagLookup.get(tagId);
    if (!resolvedTag) {
      return;
    }

    groupedTags[resolvedTag.category.id].subcategories[
      resolvedTag.subcategory.id
    ].tags.push({
      id: resolvedTag.tag.id,
      name: resolvedTag.tag.name,
      order: resolvedTag.tagOrder,
      accentId: resolvedTag.tag.accentId ?? null,
    });
  });

  Object.values(groupedTags).forEach((category) => {
    Object.values(category.subcategories).forEach((subcategory) => {
      subcategory.tags.sort((left, right) => left.order - right.order);
    });
  });

  return groupedTags;
}

export function hasAnyGroupedTags(groupedTags: GroupedTagsByCategory): boolean {
  return Object.values(groupedTags).some((category) =>
    Object.values(category.subcategories).some(
      (subcategory) => subcategory.tags.length > 0,
    ),
  );
}
