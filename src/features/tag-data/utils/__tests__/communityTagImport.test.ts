import { describe, expect, it } from "vitest";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import { importCommunityTagPackage, type CommunityTagImportPackage } from "../communityTagImport";

const communityTag: CommunityTagImportPackage = {
  version: 1,
  kind: "tagify-community-tag",
  source: "tagify-community",
  publicTagKey: "deep-house",
  name: "Deep House",
  usage: { songCount: 42, contributorCount: 7, assignmentCount: 51 },
  publicUrl: "https://community.tagify.fm/search?tag=Deep%20House",
};

function createTaxonomy() {
  return buildTaxonomyFromCategoryTree([
    {
      id: "genres",
      name: "Genres",
      subcategories: [
        {
          id: "dance",
          name: "Dance",
          tags: [{ id: "house", name: "House" }],
        },
      ],
    },
  ]);
}

describe("communityTagImport", () => {
  it("imports a Community tag directly under a selected category", () => {
    const taxonomy = createTaxonomy();
    const categoryId = taxonomy.categoryOrder[0];
    const originalFolderIds = Object.keys(taxonomy.subcategoriesById);

    const result = importCommunityTagPackage(taxonomy, communityTag, {
      targetCategoryId: categoryId,
    });

    expect(result.status).toBe("imported");
    if (result.status !== "imported") return;
    const tag = result.taxonomy.tagsById[result.tagId];
    expect(tag).toMatchObject({
      name: "Deep House",
      parentId: categoryId,
      subcategoryId: categoryId,
      source: {
        type: "community",
        publicTagKey: "deep-house",
        publicTagName: "Deep House",
      },
    });
    expect(result.taxonomy.childrenByParentId?.[categoryId]).toContain(result.tagId);
    expect(Object.keys(result.taxonomy.subcategoriesById)).toEqual(originalFolderIds);
    expect(
      Object.values(result.taxonomy.subcategoriesById).some((folder) => folder.name === "Community Imports"),
    ).toBe(false);
  });

  it("imports a Community tag into a selected nested folder", () => {
    const taxonomy = createTaxonomy();
    const categoryId = taxonomy.categoryOrder[0];
    const folderId = taxonomy.categoriesById[categoryId].subcategoryIds[0];

    const result = importCommunityTagPackage(taxonomy, communityTag, {
      targetCategoryId: categoryId,
      targetSubcategoryId: folderId,
    });

    expect(result.status).toBe("imported");
    if (result.status !== "imported") return;
    expect(result.taxonomy.tagsById[result.tagId]).toMatchObject({
      parentId: folderId,
      subcategoryId: folderId,
    });
    expect(result.taxonomy.subcategoriesById[folderId].tagIds).toContain(result.tagId);
    expect(result.taxonomy.childrenByParentId?.[folderId]).toContain(result.tagId);
  });

  it("reuses an existing tag in the selected destination by default", () => {
    const taxonomy = createTaxonomy();
    const categoryId = taxonomy.categoryOrder[0];
    const imported = importCommunityTagPackage(
      taxonomy,
      { ...communityTag, name: "Ambient" },
      { targetCategoryId: categoryId },
    );
    expect(imported.status).toBe("imported");
    if (imported.status !== "imported") return;

    const result = importCommunityTagPackage(
      imported.taxonomy,
      { ...communityTag, name: "Ambient" },
      { targetCategoryId: categoryId },
    );

    expect(result.status).toBe("existing");
    if (result.status !== "existing") return;
    expect(result.tagId).toBe(imported.tagId);
    expect(Object.keys(result.taxonomy.tagsById)).toHaveLength(
      Object.keys(imported.taxonomy.tagsById).length,
    );
  });

  it("blocks imports into folders outside the selected category", () => {
    const taxonomy = createTaxonomy();

    const result = importCommunityTagPackage(taxonomy, communityTag, {
      targetCategoryId: "missing",
      targetSubcategoryId: "source",
    });

    expect(result.status).toBe("blocked");
  });
});
