import { Tag, TagCategory } from "@/types/tagData";

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
          subcategories: category.subcategories.map((subcategory) => ({
            ...subcategory,
            tags: [...subcategory.tags],
          })),
        },
      ];
    }

    const matchingSubcategories = category.subcategories.flatMap((subcategory) => {
      if (matchesSearchTerm(subcategory.name, normalizedSearchTerm)) {
        return [
          {
            ...subcategory,
            tags: [...subcategory.tags],
          },
        ];
      }

      const matchingTags = subcategory.tags.filter((tag) =>
        matchesSearchTerm(tag.name, normalizedSearchTerm),
      );

      if (matchingTags.length === 0) {
        return [];
      }

      return [
        {
          ...subcategory,
          tags: matchingTags,
        },
      ];
    });

    if (matchingSubcategories.length === 0) {
      return [];
    }

    return [
      {
        ...category,
        subcategories: matchingSubcategories,
      },
    ];
  });
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
    subcategories: category.subcategories.map((subcategory) => ({
      ...subcategory,
      tags: sortTags(subcategory.tags, mode),
    })),
  }));
}
