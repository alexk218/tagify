import { TagTaxonomy } from "@/types/tagData";

export type TaxonomyMoveReason =
  | "same-position"
  | "duplicate-subcategory-name"
  | "duplicate-tag-name"
  | "invalid-descendant"
  | "missing-source"
  | "missing-target";

export type RelativeDropPlacement = "before" | "inside" | "after";

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

function getParentChildIds(taxonomy: TagTaxonomy, parentId: string): string[] {
  return [
    ...(taxonomy.childrenByParentId?.[parentId] ??
      taxonomy.subcategoriesById[parentId]?.childIds ??
      taxonomy.categoriesById[parentId]?.childIds ??
      taxonomy.categoriesById[parentId]?.subcategoryIds ??
      []),
  ];
}

function getRootCategoryId(taxonomy: TagTaxonomy, nodeId: string): string | null {
  if (taxonomy.categoriesById[nodeId]) {
    return nodeId;
  }

  let cursor = taxonomy.subcategoriesById[nodeId];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const parentId = cursor.parentId || cursor.categoryId;
    if (!parentId) {
      return null;
    }
    if (taxonomy.categoriesById[parentId]) {
      return parentId;
    }
    cursor = taxonomy.subcategoriesById[parentId];
  }

  return null;
}

function isDescendantOf(taxonomy: TagTaxonomy, candidateId: string, parentId: string): boolean {
  const childIds = getParentChildIds(taxonomy, parentId);
  if (childIds.includes(candidateId)) {
    return true;
  }

  return childIds.some((childId) =>
    taxonomy.subcategoriesById[childId]
      ? isDescendantOf(taxonomy, candidateId, childId)
      : false,
  );
}

function updateFolderSubtreeCategory(
  taxonomy: TagTaxonomy,
  folderId: string,
  categoryId: string,
) {
  const folder = taxonomy.subcategoriesById[folderId];
  if (!folder) {
    return;
  }

  folder.categoryId = categoryId;
  if (taxonomy.foldersById?.[folderId]) {
    taxonomy.foldersById[folderId].categoryId = categoryId;
  }

  getParentChildIds(taxonomy, folderId).forEach((childId) => {
    if (taxonomy.subcategoriesById[childId]) {
      updateFolderSubtreeCategory(taxonomy, childId, categoryId);
    }
  });
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

export function moveCategoryIntoParent(
  taxonomy: TagTaxonomy,
  categoryId: string,
  targetParentId: string,
  targetIndex: number,
): TaxonomyMoveResult {
  const category = taxonomy.categoriesById[categoryId];
  const targetCategory = taxonomy.categoriesById[targetParentId];
  const targetFolder = taxonomy.subcategoriesById[targetParentId];

  if (!category) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (!targetCategory && !targetFolder) {
    return {
      status: "blocked",
      reason: "missing-target",
      taxonomy,
    };
  }

  if (categoryId === targetParentId) {
    return {
      status: "noop",
      reason: "same-position",
      taxonomy,
    };
  }

  if (isDescendantOf(taxonomy, targetParentId, categoryId)) {
    return {
      status: "blocked",
      reason: "invalid-descendant",
      taxonomy,
    };
  }

  const targetChildren = getParentChildIds(taxonomy, targetParentId);
  const hasSiblingConflict = targetChildren.some(
    (candidateId) =>
      normalizeName(
        taxonomy.subcategoriesById[candidateId]?.name ||
          taxonomy.tagsById[candidateId]?.name ||
          "",
      ) === normalizeName(category.name),
  );

  if (hasSiblingConflict) {
    return {
      status: "blocked",
      reason: "duplicate-subcategory-name",
      taxonomy,
    };
  }

  const targetCategoryId = targetCategory?.id || getRootCategoryId(taxonomy, targetParentId);
  if (!targetCategoryId) {
    return {
      status: "blocked",
      reason: "missing-target",
      taxonomy,
    };
  }

  const nextTaxonomy = cloneTaxonomy(taxonomy);
  nextTaxonomy.childrenByParentId ||= {};
  nextTaxonomy.foldersById ||= {};

  const sourceChildIds = getParentChildIds(nextTaxonomy, categoryId);
  delete nextTaxonomy.categoriesById[categoryId];
  nextTaxonomy.categoryOrder = nextTaxonomy.categoryOrder.filter(
    (candidateId) => candidateId !== categoryId,
  );

  const nextFolder = {
    id: categoryId,
    name: category.name,
    parentId: targetParentId,
    categoryId: targetCategoryId,
    tagIds: sourceChildIds.filter((childId) => Boolean(nextTaxonomy.tagsById[childId])),
    childIds: sourceChildIds,
  };
  nextTaxonomy.subcategoriesById[categoryId] = nextFolder;
  nextTaxonomy.foldersById[categoryId] = nextFolder;
  nextTaxonomy.childrenByParentId[categoryId] = sourceChildIds;

  sourceChildIds.forEach((childId) => {
    const tag = nextTaxonomy.tagsById[childId];
    if (tag) {
      tag.parentId = categoryId;
      tag.subcategoryId = categoryId;
      return;
    }

    const childFolder = nextTaxonomy.subcategoriesById[childId];
    if (childFolder) {
      childFolder.parentId = categoryId;
    }
  });
  updateFolderSubtreeCategory(nextTaxonomy, categoryId, targetCategoryId);

  nextTaxonomy.childrenByParentId[targetParentId] = getParentChildIds(
    nextTaxonomy,
    targetParentId,
  ).filter((candidateId) => candidateId !== categoryId);
  nextTaxonomy.childrenByParentId[targetParentId].splice(
    clampIndex(targetIndex, nextTaxonomy.childrenByParentId[targetParentId].length),
    0,
    categoryId,
  );

  const nextTargetCategory = nextTaxonomy.categoriesById[targetParentId];
  if (nextTargetCategory) {
    nextTargetCategory.subcategoryIds = nextTargetCategory.subcategoryIds.filter(
      (candidateId) => candidateId !== categoryId,
    );
    nextTargetCategory.subcategoryIds.splice(
      clampIndex(targetIndex, nextTargetCategory.subcategoryIds.length),
      0,
      categoryId,
    );
    nextTargetCategory.childIds = [...nextTaxonomy.childrenByParentId[targetParentId]];
  }

  const nextTargetFolder = nextTaxonomy.subcategoriesById[targetParentId];
  if (nextTargetFolder) {
    nextTargetFolder.childIds = [...nextTaxonomy.childrenByParentId[targetParentId]];
  }

  return {
    status: "applied",
    taxonomy: nextTaxonomy,
  };
}

export function moveSubcategory(
  taxonomy: TagTaxonomy,
  subcategoryId: string,
  targetParentId: string,
  targetIndex: number,
): TaxonomyMoveResult {
  const subcategory = taxonomy.subcategoriesById[subcategoryId];
  const targetCategory = taxonomy.categoriesById[targetParentId];
  const targetFolder = taxonomy.subcategoriesById[targetParentId];

  if (!subcategory) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (!targetCategory && !targetFolder) {
    return {
      status: "blocked",
      reason: "missing-target",
      taxonomy,
    };
  }

  const sourceParentId = subcategory.parentId || subcategory.categoryId;
  const sourceParent = sourceParentId
    ? taxonomy.categoriesById[sourceParentId] || taxonomy.subcategoriesById[sourceParentId]
    : null;
  if (!sourceParentId || !sourceParent) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (targetParentId === subcategoryId || isDescendantOf(taxonomy, targetParentId, subcategoryId)) {
    return {
      status: "blocked",
      reason: "invalid-descendant",
      taxonomy,
    };
  }

  const sourceChildren = getParentChildIds(taxonomy, sourceParentId);
  const targetChildren = getParentChildIds(taxonomy, targetParentId);
  const targetCategoryId = targetCategory?.id || getRootCategoryId(taxonomy, targetParentId);

  if (!targetCategoryId) {
    return {
      status: "blocked",
      reason: "missing-target",
      taxonomy,
    };
  }

  if (sourceParentId !== targetParentId) {
    const hasSiblingConflict = targetChildren
      .filter((candidateId) => candidateId !== subcategoryId)
      .some(
        (candidateId) =>
          normalizeName(
            taxonomy.subcategoriesById[candidateId]?.name ||
              taxonomy.tagsById[candidateId]?.name ||
              "",
          ) ===
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

  const sourceIndex = sourceChildren.indexOf(subcategoryId);
  if (sourceIndex < 0) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  const adjustedTargetIndex =
    sourceParentId === targetParentId && sourceIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  const normalizedTargetIndex = clampIndex(
    adjustedTargetIndex,
    sourceParentId === targetParentId
      ? targetChildren.length - 1
      : targetChildren.length,
  );

  if (
    sourceParentId === targetParentId &&
    sourceIndex === normalizedTargetIndex
  ) {
    return {
      status: "noop",
      reason: "same-position",
      taxonomy,
    };
  }

  const nextTaxonomy = cloneTaxonomy(taxonomy);
  nextTaxonomy.childrenByParentId ||= {};
  nextTaxonomy.foldersById ||= {};
  const nextSourceCategory = nextTaxonomy.categoriesById[sourceParentId];
  const nextTargetCategory = nextTaxonomy.categoriesById[targetParentId];
  const nextSourceFolder = nextTaxonomy.subcategoriesById[sourceParentId];
  const nextTargetFolder = nextTaxonomy.subcategoriesById[targetParentId];
  const nextSubcategory = nextTaxonomy.subcategoriesById[subcategoryId];

  nextTaxonomy.childrenByParentId[sourceParentId] = getParentChildIds(
    nextTaxonomy,
    sourceParentId,
  ).filter((candidateId) => candidateId !== subcategoryId);
  if (nextSourceCategory) {
    nextSourceCategory.subcategoryIds = nextSourceCategory.subcategoryIds.filter(
      (candidateId) => candidateId !== subcategoryId,
    );
    nextSourceCategory.childIds = (nextSourceCategory.childIds || []).filter(
      (candidateId) => candidateId !== subcategoryId,
    );
  }
  if (nextSourceFolder) {
    nextSourceFolder.childIds = (nextSourceFolder.childIds || []).filter(
      (candidateId) => candidateId !== subcategoryId,
    );
  }

  nextTaxonomy.childrenByParentId[targetParentId] = getParentChildIds(
    nextTaxonomy,
    targetParentId,
  ).filter((candidateId) => candidateId !== subcategoryId);
  nextTaxonomy.childrenByParentId[targetParentId].splice(
    clampIndex(normalizedTargetIndex, nextTaxonomy.childrenByParentId[targetParentId].length),
    0,
    subcategoryId,
  );
  if (nextTargetCategory) {
    nextTargetCategory.subcategoryIds = nextTargetCategory.subcategoryIds.filter(
      (candidateId) => candidateId !== subcategoryId,
    );
    nextTargetCategory.subcategoryIds.splice(
      clampIndex(normalizedTargetIndex, nextTargetCategory.subcategoryIds.length),
      0,
      subcategoryId,
    );
    nextTargetCategory.childIds = [...nextTaxonomy.childrenByParentId[targetParentId]];
  }
  if (nextTargetFolder) {
    nextTargetFolder.childIds = [...nextTaxonomy.childrenByParentId[targetParentId]];
  }

  nextSubcategory.parentId = targetParentId;
  nextSubcategory.categoryId = targetCategoryId;
  nextTaxonomy.foldersById[subcategoryId] = nextSubcategory;
  updateFolderSubtreeCategory(nextTaxonomy, subcategoryId, targetCategoryId);

  return {
    status: "applied",
    taxonomy: nextTaxonomy,
  };
}

export function moveTag(
  taxonomy: TagTaxonomy,
  tagId: string,
  targetParentId: string,
  targetIndex: number,
): TaxonomyMoveResult {
  const tag = taxonomy.tagsById[tagId];
  const targetFolder = taxonomy.subcategoriesById[targetParentId];
  const targetCategory = taxonomy.categoriesById[targetParentId];
  const targetChildren = taxonomy.childrenByParentId?.[targetParentId] || targetFolder?.tagIds || [];

  if (!tag) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (!targetFolder && !targetCategory) {
    return {
      status: "blocked",
      reason: "missing-target",
      taxonomy,
    };
  }

  const sourceParentId = tag.parentId || tag.subcategoryId;
  const sourceFolder = taxonomy.subcategoriesById[sourceParentId];
  const sourceCategory = taxonomy.categoriesById[sourceParentId];
  const sourceChildren = taxonomy.childrenByParentId?.[sourceParentId] || sourceFolder?.tagIds || [];
  if (!sourceFolder && !sourceCategory) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  if (sourceParentId !== targetParentId) {
    const hasSiblingConflict = targetChildren
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

  const sourceIndex = sourceChildren.indexOf(tagId);
  if (sourceIndex < 0) {
    return {
      status: "blocked",
      reason: "missing-source",
      taxonomy,
    };
  }

  const adjustedTargetIndex =
    sourceParentId === targetParentId && sourceIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  const normalizedTargetIndex = clampIndex(
    adjustedTargetIndex,
    sourceParentId === targetParentId
      ? targetChildren.length - 1
      : targetChildren.length,
  );

  if (
    sourceParentId === targetParentId &&
    sourceIndex === normalizedTargetIndex
  ) {
    return {
      status: "noop",
      reason: "same-position",
      taxonomy,
    };
  }

  const nextTaxonomy = cloneTaxonomy(taxonomy);
  nextTaxonomy.childrenByParentId ||= {};
  const nextSourceFolder = nextTaxonomy.subcategoriesById[sourceParentId];
  const nextTargetFolder = nextTaxonomy.subcategoriesById[targetParentId];
  const nextSourceCategory = nextTaxonomy.categoriesById[sourceParentId];
  const nextTargetCategory = nextTaxonomy.categoriesById[targetParentId];
  const nextTag = nextTaxonomy.tagsById[tagId];

  nextTaxonomy.childrenByParentId[sourceParentId] = (nextTaxonomy.childrenByParentId[sourceParentId] || []).filter(
    (candidateId) => candidateId !== tagId,
  );
  if (nextSourceFolder) {
    nextSourceFolder.tagIds = nextSourceFolder.tagIds.filter((candidateId) => candidateId !== tagId);
    nextSourceFolder.childIds = (nextSourceFolder.childIds || []).filter((candidateId) => candidateId !== tagId);
  }
  if (nextSourceCategory) nextSourceCategory.childIds = (nextSourceCategory.childIds || []).filter((candidateId) => candidateId !== tagId);
  nextTaxonomy.childrenByParentId[targetParentId] = [...(nextTaxonomy.childrenByParentId[targetParentId] || [])];
  nextTaxonomy.childrenByParentId[targetParentId].splice(
    clampIndex(normalizedTargetIndex, nextTaxonomy.childrenByParentId[targetParentId].length),
    0,
    tagId,
  );
  if (nextTargetFolder) {
    nextTargetFolder.tagIds = [...nextTargetFolder.tagIds.filter((candidateId) => candidateId !== tagId)];
    nextTargetFolder.tagIds.splice(clampIndex(normalizedTargetIndex, nextTargetFolder.tagIds.length), 0, tagId);
    nextTargetFolder.childIds = [...(nextTargetFolder.childIds || []).filter((candidateId) => candidateId !== tagId), tagId];
  }
  if (nextTargetCategory) nextTargetCategory.childIds = [...(nextTargetCategory.childIds || []).filter((candidateId) => candidateId !== tagId), tagId];
  nextTag.parentId = targetParentId;
  nextTag.subcategoryId = targetParentId;

  return {
    status: "applied",
    taxonomy: nextTaxonomy,
  };
}
