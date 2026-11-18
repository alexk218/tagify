import { Tag, TagCategory, TagDataStructure, TagSubcategory } from "@/types/tagData";

export type TagSelectorSortMode =
  | "custom"
  | "custom-highlighted-first"
  | "most-used"
  | "alphabetical-asc"
  | "alphabetical-desc";

export const DEFAULT_TAG_SELECTOR_SORT_MODE: TagSelectorSortMode = "custom";

export const TAG_SELECTOR_SORT_MODE_OPTIONS: Array<{
  value: TagSelectorSortMode;
  label: string;
}> = [
  { value: "custom", label: "Custom Order" },
  { value: "custom-highlighted-first", label: "Custom + Highlighted First" },
  { value: "most-used", label: "Most Used" },
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

/** How many songs, playlists, albums and artists carry each tag. */
export function countTagUses(
  tagData: Pick<TagDataStructure, "tracks" | "playlists" | "artists">,
): Map<string, number> {
  const uses = new Map<string, number>();
  const add = (entries: Record<string, { tagIds: string[] }> | undefined) => {
    for (const entry of Object.values(entries || {})) {
      for (const tagId of new Set(entry.tagIds)) {
        uses.set(tagId, (uses.get(tagId) || 0) + 1);
      }
    }
  };
  add(tagData.tracks);
  add(tagData.playlists);
  add(tagData.artists);
  return uses;
}

type TagUses = ReadonlyMap<string, number>;

const usesOfTag = (tag: Tag, uses: TagUses) => uses.get(tag.id) || 0;

function usesOfSubcategory(subcategory: TagSubcategory, uses: TagUses): number {
  return (
    subcategory.tags.reduce((sum, tag) => sum + usesOfTag(tag, uses), 0) +
    (subcategory.subcategories || []).reduce(
      (sum, child) => sum + usesOfSubcategory(child, uses),
      0,
    )
  );
}

function usesOfCategory(category: TagCategory, uses: TagUses): number {
  return (
    (category.tags || []).reduce((sum, tag) => sum + usesOfTag(tag, uses), 0) +
    category.subcategories.reduce(
      (sum, subcategory) => sum + usesOfSubcategory(subcategory, uses),
      0,
    )
  );
}

// Most used first, then by name, as Community's "Most used" lists them; a folder counts its tags together.
function byMostUsed<T extends { name: string }>(items: T[], usesOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, uses: usesOf(item) }))
    .sort(
      (left, right) =>
        right.uses - left.uses ||
        left.item.name.localeCompare(right.item.name, undefined, {
          sensitivity: "base",
          numeric: true,
        }) ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

function sortSubcategoriesByUse(
  subcategories: TagSubcategory[],
  uses: TagUses,
): TagSubcategory[] {
  return byMostUsed(subcategories, (subcategory) => usesOfSubcategory(subcategory, uses)).map(
    (subcategory) => ({
      ...subcategory,
      tags: byMostUsed(subcategory.tags, (tag) => usesOfTag(tag, uses)),
      subcategories: sortSubcategoriesByUse(subcategory.subcategories || [], uses),
    }),
  );
}

function sortTags(
  tags: Tag[],
  mode: Exclude<TagSelectorSortMode, "custom" | "most-used">,
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
  mode: Exclude<TagSelectorSortMode, "custom" | "most-used">,
): TagSubcategory {
  return {
    ...subcategory,
    tags: sortTags(subcategory.tags, mode),
    subcategories: (subcategory.subcategories || []).map((child) =>
      sortSubcategory(child, mode),
    ),
  };
}

/**
 * The picker's categories in the chosen order. "Most used" needs `uses` (see `countTagUses`);
 * without them it keeps the custom order.
 */
export function sortTagSelectorCategories(
  categories: TagCategory[],
  mode: TagSelectorSortMode,
  uses?: TagUses,
): TagCategory[] {
  if (mode === "custom") {
    return categories;
  }

  if (mode === "most-used") {
    if (!uses) return categories;
    return byMostUsed(categories, (category) => usesOfCategory(category, uses)).map(
      (category) => ({
        ...category,
        tags: category.tags ? byMostUsed(category.tags, (tag) => usesOfTag(tag, uses)) : undefined,
        subcategories: sortSubcategoriesByUse(category.subcategories, uses),
      }),
    );
  }

  return categories.map((category) => ({
    ...category,
    tags: category.tags ? sortTags(category.tags, mode) : undefined,
    subcategories: category.subcategories.map((subcategory) =>
      sortSubcategory(subcategory, mode),
    ),
  }));
}
