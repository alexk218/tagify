import { TagTaxonomy } from "@/types/tagData";

export type TaxonomyMoveReason =
  | "same-position"
  | "duplicate-subcategory-name"
  | "duplicate-tag-name"
  | "missing-source"
  | "missing-target";

export type RelativeDropPlacement = "before" | "after";

export type TaxonomyMoveResult =
  | {
      status: "applied";
      taxonomy: TagTaxonomy;
    }
  | {
      status: "noop" | "blocked";
      reason: TaxonomyMoveReason;
      taxonomy: TagTaxonomy;
    };

export function cloneTaxonomy(taxonomy: TagTaxonomy): TagTaxonomy {
  return JSON.parse(JSON.stringify(taxonomy)) as TagTaxonomy;
}

function removeAndReturn<T>(items: T[], index: number): { items: T[]; value: T } {
  const nextItems = [...items];
  const [value] = nextItems.splice(index, 1);
  return { items: nextItems, value };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, length));
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function getRelativeInsertIndex(
  itemIds: string[],
  overId: string,
  placement: RelativeDropPlacement,
): number | null {
  const overIndex = itemIds.indexOf(overId);

  if (overIndex < 0) {
    return null;
  }

  return overIndex + (placement === "after" ? 1 : 0);
}

export function getSortableReorderTargetIndex(
  itemIds: string[],
  activeId: string,
  overId: string,
): number | null {
  const activeIndex = itemIds.indexOf(activeId);
  const overIndex = itemIds.indexOf(overId);

  if (activeIndex < 0 || overIndex < 0) {
    return null;
  }

  return activeIndex < overIndex ? overIndex + 1 : overIndex;
}

export function moveCategory(
  taxonomy: TagTaxonomy,
  sourceIndex: number,
  targetIndex: number,
): TaxonomyMoveResult {
  const categoryIds = taxonomy.categoryOrder;

  if (
    sourceIndex < 0 ||
    sourceIndex >= categoryIds.length ||
    targetIndex < 0 ||
    targetIndex > categoryIds.length
  ) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  const adjustedTargetIndex =
    sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;

  if (sourceIndex === adjustedTargetIndex) {
    return {
      status: "noop",
      reason: "same-position",
      taxonomy,
    };
  }

  const { items: remainingCategoryIds, value: movedCategoryId } = removeAndReturn(
    categoryIds,
    sourceIndex,
  );
  remainingCategoryIds.splice(clampIndex(adjustedTargetIndex, remainingCategoryIds.length), 0, movedCategoryId);

  return {
    status: "applied",
    taxonomy: {
      ...taxonomy,
      categoryOrder: remainingCategoryIds,
    },
  };
}

export function moveSubcategory(
  taxonomy: TagTaxonomy,
  subcategoryId: string,
  targetCategoryId: string,
  targetIndex: number,
): TaxonomyMoveResult {
  const subcategory = taxonomy.subcategoriesById[subcategoryId];
  const targetCategory = taxonomy.categoriesById[targetCategoryId];

  if (!subcategory) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (!targetCategory) {
    return {
      status: "blocked",
      reason: "missing-target",
      taxonomy,
    };
  }

  const sourceCategory = taxonomy.categoriesById[subcategory.categoryId];
  if (!sourceCategory) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (subcategory.categoryId !== targetCategoryId) {
    const hasSiblingConflict = targetCategory.subcategoryIds
      .filter((candidateId) => candidateId !== subcategoryId)
      .some(
        (candidateId) =>
          normalizeName(taxonomy.subcategoriesById[candidateId]?.name || "") ===
          normalizeName(subcategory.name),
      );

    if (hasSiblingConflict) {
      return {
        status: "blocked",
        reason: "duplicate-subcategory-name",
        taxonomy,
      };
    }
  }

  const sourceIndex = sourceCategory.subcategoryIds.indexOf(subcategoryId);
  if (sourceIndex < 0) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  const adjustedTargetIndex =
    sourceCategory.id === targetCategoryId && sourceIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  const normalizedTargetIndex = clampIndex(
    adjustedTargetIndex,
    sourceCategory.id === targetCategoryId
      ? targetCategory.subcategoryIds.length - 1
      : targetCategory.subcategoryIds.length,
  );

  if (
    sourceCategory.id === targetCategoryId &&
    sourceIndex === normalizedTargetIndex
  ) {
    return {
      status: "noop",
      reason: "same-position",
      taxonomy,
    };
  }

  const nextTaxonomy = cloneTaxonomy(taxonomy);
  const nextSourceCategory = nextTaxonomy.categoriesById[sourceCategory.id];
  const nextTargetCategory = nextTaxonomy.categoriesById[targetCategoryId];
  const nextSubcategory = nextTaxonomy.subcategoriesById[subcategoryId];

  nextSourceCategory.subcategoryIds = nextSourceCategory.subcategoryIds.filter(
    (candidateId) => candidateId !== subcategoryId,
  );
  nextTargetCategory.subcategoryIds.splice(
    clampIndex(normalizedTargetIndex, nextTargetCategory.subcategoryIds.length),
    0,
    subcategoryId,
  );
  nextSubcategory.categoryId = targetCategoryId;

  return {
    status: "applied",
    taxonomy: nextTaxonomy,
  };
}

export function moveTag(
  taxonomy: TagTaxonomy,
  tagId: string,
  targetSubcategoryId: string,
  targetIndex: number,
): TaxonomyMoveResult {
  const tag = taxonomy.tagsById[tagId];
  const targetSubcategory = taxonomy.subcategoriesById[targetSubcategoryId];

  if (!tag) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (!targetSubcategory) {
    return {
      status: "blocked",
      reason: "missing-target",
      taxonomy,
    };
  }

  const sourceSubcategory = taxonomy.subcategoriesById[tag.subcategoryId];
  if (!sourceSubcategory) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (tag.subcategoryId !== targetSubcategoryId) {
    const hasSiblingConflict = targetSubcategory.tagIds
      .filter((candidateId) => candidateId !== tagId)
      .some(
        (candidateId) =>
          normalizeName(taxonomy.tagsById[candidateId]?.name || "") ===
          normalizeName(tag.name),
      );

    if (hasSiblingConflict) {
      return {
        status: "blocked",
        reason: "duplicate-tag-name",
        taxonomy,
      };
    }
  }

  const sourceIndex = sourceSubcategory.tagIds.indexOf(tagId);
  if (sourceIndex < 0) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  const adjustedTargetIndex =
    sourceSubcategory.id === targetSubcategoryId && sourceIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  const normalizedTargetIndex = clampIndex(
    adjustedTargetIndex,
    sourceSubcategory.id === targetSubcategoryId
      ? targetSubcategory.tagIds.length - 1
      : targetSubcategory.tagIds.length,
  );

  if (
    sourceSubcategory.id === targetSubcategoryId &&
    sourceIndex === normalizedTargetIndex
  ) {
    return {
      status: "noop",
      reason: "same-position",
      taxonomy,
    };
  }

  const nextTaxonomy = cloneTaxonomy(taxonomy);
  const nextSourceSubcategory = nextTaxonomy.subcategoriesById[sourceSubcategory.id];
  const nextTargetSubcategory = nextTaxonomy.subcategoriesById[targetSubcategoryId];
  const nextTag = nextTaxonomy.tagsById[tagId];

  nextSourceSubcategory.tagIds = nextSourceSubcategory.tagIds.filter(
    (candidateId) => candidateId !== tagId,
  );
  nextTargetSubcategory.tagIds.splice(
    clampIndex(normalizedTargetIndex, nextTargetSubcategory.tagIds.length),
    0,
    tagId,
  );
  nextTag.subcategoryId = targetSubcategoryId;

  return {
    status: "applied",
    taxonomy: nextTaxonomy,
  };
}
