import { Tag, TagCategory, TagSubcategory } from "@/types/tagData";

export type TagSelectorSortMode =
  | "custom"
  | "custom-highlighted-first"
  | "alphabetical-asc"
  | "alphabetical-desc";

export const DEFAULT_TAG_SELECTOR_SORT_MODE: TagSelectorSortMode = "custom";

export const TAG_SELECTOR_SORT_MODE_OPTIONS: Array<{
  value: TagSelectorSortMode;
  label: string;
}> = [
  { value: "custom", label: "Custom Order" },
  { value: "custom-highlighted-first", label: "Custom + Highlighted First" },
  { value: "alphabetical-asc", label: "Alphabetical (A-Z)" },
  { value: "alphabetical-desc", label: "Alphabetical (Z-A)" },
];

export function isTagSelectorSortMode(value: string): value is TagSelectorSortMode {
  return TAG_SELECTOR_SORT_MODE_OPTIONS.some((option) => option.value === value);
}

function compareTagsByName(
  left: Tag,
  right: Tag,
  direction: 1 | -1,
  leftIndex: number,
  rightIndex: number,
): number {
  const comparison = left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
  });

  if (comparison !== 0) {
    return comparison * direction;
  }

  return leftIndex - rightIndex;
}

function sortTags(
  tags: Tag[],
  mode: Exclude<TagSelectorSortMode, "custom">,
): Tag[] {
  if (mode === "custom-highlighted-first") {
    return tags
      .map((tag, index) => ({ tag, index }))
      .sort((left, right) => {
        const leftPriority = left.tag.accentId ? 0 : 1;
        const rightPriority = right.tag.accentId ? 0 : 1;

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.index - right.index;
      })
      .map(({ tag }) => tag);
  }

  const direction = mode === "alphabetical-asc" ? 1 : -1;

  return tags
    .map((tag, index) => ({ tag, index }))
    .sort((left, right) =>
      compareTagsByName(left.tag, right.tag, direction, left.index, right.index),
    )
    .map(({ tag }) => tag);
}

function normalizeSearchTerm(searchTerm: string): string {
  return searchTerm.trim().toLowerCase();
}

function matchesSearchTerm(value: string, normalizedSearchTerm: string): boolean {
  return value.toLowerCase().includes(normalizedSearchTerm);
}

function cloneSubcategory(subcategory: TagSubcategory): TagSubcategory {
  return {
    ...subcategory,
    tags: [...subcategory.tags],
    subcategories: (subcategory.subcategories || []).map(cloneSubcategory),
  };
}

function filterSubcategory(
  subcategory: TagSubcategory,
  normalizedSearchTerm: string,
): TagSubcategory | null {
  if (matchesSearchTerm(subcategory.name, normalizedSearchTerm)) {
    return cloneSubcategory(subcategory);
  }

  const matchingTags = subcategory.tags.filter((tag) =>
    matchesSearchTerm(tag.name, normalizedSearchTerm),
  );
  const matchingSubcategories = (subcategory.subcategories || [])
    .map((child) => filterSubcategory(child, normalizedSearchTerm))
    .filter((child): child is TagSubcategory => Boolean(child));

  if (matchingTags.length === 0 && matchingSubcategories.length === 0) {
    return null;
  }

  return {
    ...subcategory,
    tags: matchingTags,
    subcategories: matchingSubcategories,
  };
}

export function filterTagSelectorCategories(
  categories: TagCategory[],
  searchTerm: string,
): TagCategory[] {
  const normalizedSearchTerm = normalizeSearchTerm(searchTerm);
  if (!normalizedSearchTerm) {
    return categories;
  }

  return categories.flatMap((category) => {
    if (matchesSearchTerm(category.name, normalizedSearchTerm)) {
      return [
        {
          ...category,
          tags: [...(category.tags || [])],
          subcategories: category.subcategories.map(cloneSubcategory),
        },
      ];
    }

    const matchingTags = (category.tags || []).filter((tag) =>
      matchesSearchTerm(tag.name, normalizedSearchTerm),
    );
    const matchingSubcategories = category.subcategories
      .map((subcategory) => filterSubcategory(subcategory, normalizedSearchTerm))
      .filter((subcategory): subcategory is TagSubcategory => Boolean(subcategory));

    if (matchingTags.length === 0 && matchingSubcategories.length === 0) {
      return [];
    }

    return [
      {
        ...category,
        tags: matchingTags,
        subcategories: matchingSubcategories,
      },
    ];
  });
}

function sortSubcategory(
  subcategory: TagSubcategory,
  mode: Exclude<TagSelectorSortMode, "custom">,
): TagSubcategory {
  return {
    ...subcategory,
    tags: sortTags(subcategory.tags, mode),
    subcategories: (subcategory.subcategories || []).map((child) =>
      sortSubcategory(child, mode),
    ),
  };
}

export function sortTagSelectorCategories(
  categories: TagCategory[],
  mode: TagSelectorSortMode,
): TagCategory[] {
  if (mode === "custom") {
    return categories;
  }

  return categories.map((category) => ({
    ...category,
    tags: category.tags ? sortTags(category.tags, mode) : undefined,
    subcategories: category.subcategories.map((subcategory) =>
      sortSubcategory(subcategory, mode),
    ),
  }));
}
