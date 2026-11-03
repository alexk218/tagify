import { describe, expect, it } from "vitest";
import {
  CURRENT_STARTER_TAG_VERSION,
  STARTER_TAG_SEEDS,
  STARTER_TAG_VERSIONS,
  type StarterTagVersion,
} from "@tagify/sync-contracts";
import { normalizeColorLibrary } from "@/features/tag-data/utils/tagColorThemes";
import type { TagCategory, TagTaxonomy } from "@/types/tagData";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import { buildStarterTaxonomy, defaultTagData, KNOWN_STARTER_TAXONOMIES } from "../defaultTagData";

/** A version's tree under the readable IDs Tagify's own starter list used before the shared seed. */
function readableIdTree(version: StarterTagVersion): TagCategory[] {
  const rows = STARTER_TAG_SEEDS[version];
  const children = (parentId: string) => rows.filter((row) => row.parentId === parentId).sort((left, right) => left.position - right.position);
  return rows
    .filter((row) => row.kind === "category")
    .sort((left, right) => left.position - right.position)
    .map((category) => ({
      id: category.legacyId,
      name: category.name,
      subcategories: children(category.id).map((folder) => ({
        id: folder.legacyId,
        name: folder.name,
        tags: children(folder.id).map((tag) => ({ id: tag.legacyId, name: tag.name })),
      })),
    }));
}

/** How Tagify 3.3.3 and earlier built a new library's tags from readable IDs. */
function builtFromReadableIds(version: StarterTagVersion): TagTaxonomy {
  const taxonomy = buildTaxonomyFromCategoryTree(readableIdTree(version));
  return { ...taxonomy, ...normalizeColorLibrary({ ...taxonomy, colorThemesById: undefined, ungroupedColorIds: undefined }) };
}

const tagNames = (taxonomy: TagTaxonomy) => Object.values(taxonomy.tagsById).map((tag) => tag.name);

describe("starter tags", () => {
  it("start a new library with the current version, under the shared seed's IDs and order", () => {
    const rows = STARTER_TAG_SEEDS[CURRENT_STARTER_TAG_VERSION];
    const { taxonomy } = defaultTagData;

    expect(CURRENT_STARTER_TAG_VERSION).toBe(2);
    expect(taxonomy.categoryOrder).toEqual(rows.filter((row) => row.kind === "category").map((row) => row.id));
    expect([
      ...Object.keys(taxonomy.categoriesById),
      ...Object.keys(taxonomy.subcategoriesById),
      ...Object.keys(taxonomy.tagsById),
    ].sort()).toEqual(rows.map((row) => row.id).sort());
    for (const row of rows) {
      if (row.kind === "category") {
        expect(taxonomy.categoriesById[row.id].name).toBe(row.name);
        continue;
      }
      const node = row.kind === "folder" ? taxonomy.subcategoriesById[row.id] : taxonomy.tagsById[row.id];
      expect(node).toMatchObject({ name: row.name, parentId: row.parentId });
      expect(taxonomy.childrenByParentId?.[row.parentId!]?.[row.position]).toBe(row.id);
    }
    expect(Object.keys(taxonomy.tagsById)).toHaveLength(82);
  });

  it("keep the IDs Tagify has always given each starter tag", () => {
    for (const version of STARTER_TAG_VERSIONS) {
      expect(buildStarterTaxonomy(version)).toEqual(builtFromReadableIds(version));
    }
  });

  it("recognise both versions: the 73 tags new libraries got until 3.3.3, and the refreshed 82", () => {
    expect(KNOWN_STARTER_TAXONOMIES).toHaveLength(2);
    const [version1, version2] = KNOWN_STARTER_TAXONOMIES;
    expect(version2).toEqual(defaultTagData.taxonomy);
    expect(Object.keys(version1.tagsById)).toHaveLength(73);
    expect(JSON.stringify(version1)).toBe(JSON.stringify(builtFromReadableIds(1)));

    const removed = tagNames(version1).filter((name) => !tagNames(version2).includes(name)).sort();
    const added = tagNames(version2).filter((name) => !tagNames(version1).includes(name)).sort();
    expect(removed).toEqual(["Blues", "Country", "Holiday", "Live Recording", "Lo-fi", "Polished", "Reggae", "Studio", "Vintage"]);
    expect(added).toEqual([
      "2010s", "2020s", "Ambient", "Autumn", "Bittersweet", "English", "Epic", "French", "German",
      "Hopeful", "Japanese", "Korean", "Melancholic", "Metal", "Punk", "Soul", "Spanish", "Spring",
    ]);
    expect(Object.values(version2.subcategoriesById).map((folder) => folder.name)).toContain("Language");
  });
});
