import type { TagTaxonomy, TaxonomyCategory, TaxonomySubcategory } from "@/types/tagData";
import { createEntityId } from "@/utils/tagTaxonomy";
import { cloneTaxonomy } from "./tagManager.taxonomy";

export interface CommunityTagImportPackage {
  version: number;
  kind: "tagify-community-tag";
  source: "tagify-community";
  publicTagKey: string;
  name: string;
  normalizedName?: string;
  suggestedPaths?: string[][];
  usage?: {
    songCount?: number;
    contributorCount?: number;
    assignmentCount?: number;
    firstSeenAt?: string;
    lastSeenAt?: string;
  };
  publicUrl?: string;
}

export interface CommunityTagImportOptions {
  targetCategoryId: string;
  targetSubcategoryId?: string | null;
  duplicateMode?: "use-existing" | "create-copy";
  importedAt?: string;
}

export type CommunityTagImportResult =
  | {
      status: "imported";
      taxonomy: TagTaxonomy;
      tagId: string;
      categoryId: string;
      subcategoryId: string;
      createdSubcategory: boolean;
    }
  | {
      status: "existing";
      taxonomy: TagTaxonomy;
      tagId: string;
      categoryId: string;
      subcategoryId: string;
    }
  | {
      status: "blocked";
      reason: "invalid-package" | "missing-category" | "missing-subcategory";
      taxonomy: TagTaxonomy;
    };

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function isCommunityTagImportPackage(value: unknown): value is CommunityTagImportPackage {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  return (
    record?.kind === "tagify-community-tag" &&
    record.source === "tagify-community" &&
    typeof record.publicTagKey === "string" &&
    record.publicTagKey.trim().length > 0 &&
    typeof record.name === "string" &&
    record.name.trim().length > 0
  );
}

function findTagByNameInSubcategory(
  taxonomy: TagTaxonomy,
  parent: TaxonomyCategory | TaxonomySubcategory,
  name: string,
): string | null {
  const normalizedName = normalizeName(name);
  const tagIds = "tagIds" in parent
    ? parent.tagIds
    : (taxonomy.childrenByParentId?.[parent.id] || []).filter((childId) => Boolean(taxonomy.tagsById[childId]));
  return tagIds.find((tagId) => normalizeName(taxonomy.tagsById[tagId]?.name ?? "") === normalizedName) ?? null;
}

function uniqueTagNameInSubcategory(
  taxonomy: TagTaxonomy,
  subcategory: TaxonomySubcategory,
  name: string,
): string {
  if (!findTagByNameInSubcategory(taxonomy, subcategory, name)) return name;
  let suffix = 2;
  let candidate = `${name} ${suffix}`;
  while (findTagByNameInSubcategory(taxonomy, subcategory, candidate)) {
    suffix += 1;
    candidate = `${name} ${suffix}`;
  }
  return candidate;
}

function resolveParent(
  taxonomy: TagTaxonomy,
  targetCategoryId: string,
  targetSubcategoryId: string | null | undefined,
): { parentId: string } | null {
  const category = taxonomy.categoriesById[targetCategoryId];
  if (!category) return null;

  if (targetSubcategoryId) {
    return taxonomy.subcategoriesById[targetSubcategoryId]?.categoryId === targetCategoryId
      ? { parentId: targetSubcategoryId }
      : null;
  }

  return { parentId: targetCategoryId };
}

export function importCommunityTagPackage(
  taxonomy: TagTaxonomy,
  importPackage: CommunityTagImportPackage,
  options: CommunityTagImportOptions,
): CommunityTagImportResult {
  if (!isCommunityTagImportPackage(importPackage)) return { status: "blocked", reason: "invalid-package", taxonomy };
  if (!taxonomy.categoriesById[options.targetCategoryId]) return { status: "blocked", reason: "missing-category", taxonomy };

  const resolvedParent = resolveParent(
    taxonomy,
    options.targetCategoryId,
    options.targetSubcategoryId,
  );
  if (!resolvedParent) return { status: "blocked", reason: "missing-subcategory", taxonomy };

  const targetParent = taxonomy.subcategoriesById[resolvedParent.parentId]
    || taxonomy.categoriesById[resolvedParent.parentId];
  const existingTagId = findTagByNameInSubcategory(taxonomy, targetParent, importPackage.name);
  if (existingTagId && options.duplicateMode !== "create-copy") {
    return {
      status: "existing",
      taxonomy,
      tagId: existingTagId,
      categoryId: options.targetCategoryId,
      subcategoryId: resolvedParent.parentId,
    };
  }

  const nextTaxonomy = cloneTaxonomy(taxonomy);
  const nextFolder = nextTaxonomy.subcategoriesById[resolvedParent.parentId];
  const nextCategory = nextTaxonomy.categoriesById[resolvedParent.parentId];
  const tagId = createEntityId("tag");
  const name = options.duplicateMode === "create-copy"
    ? uniqueTagNameInSubcategory(nextTaxonomy, nextFolder || nextCategory, importPackage.name)
    : importPackage.name;

  nextTaxonomy.childrenByParentId ||= {};
  nextTaxonomy.childrenByParentId[resolvedParent.parentId] = [
    ...(nextTaxonomy.childrenByParentId[resolvedParent.parentId] || []),
    tagId,
  ];
  if (nextFolder) {
    nextFolder.tagIds.push(tagId);
    nextFolder.childIds = [...(nextFolder.childIds || []), tagId];
  } else if (nextCategory) {
    nextCategory.childIds = [...(nextCategory.childIds || []), tagId];
  }
  nextTaxonomy.tagsById[tagId] = {
    id: tagId,
    name,
    parentId: resolvedParent.parentId,
    subcategoryId: resolvedParent.parentId,
    accentId: null,
    source: {
      type: "community",
      publicTagKey: importPackage.publicTagKey,
      publicTagName: importPackage.name,
      publicTagUrl: importPackage.publicUrl,
      importedAt: options.importedAt ?? new Date().toISOString(),
    },
  };

  return {
    status: "imported",
    taxonomy: nextTaxonomy,
    tagId,
    categoryId: options.targetCategoryId,
    subcategoryId: resolvedParent.parentId,
    createdSubcategory: false,
  };
}
