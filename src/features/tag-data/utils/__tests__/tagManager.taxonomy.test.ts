import { describe, expect, it } from "vitest";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import {
  getRelativeInsertIndex,
  getSortableReorderTargetIndex,
  moveCategory,
  moveSubcategory,
  moveTag,
} from "../tagManager.taxonomy";

function createTaxonomy() {
  return buildTaxonomyFromCategoryTree([
    {
      id: "genre",
      name: "Genre",
      subcategories: [
        {
          id: "electronic",
          name: "Electronic",
          tags: [
            { id: "house", name: "House" },
            { id: "techno", name: "Techno" },
          ],
        },
        {
          id: "percussion",
          name: "Percussion",
          tags: [{ id: "tribal", name: "Tribal" }],
        },
      ],
    },
    {
      id: "mood",
      name: "Mood",
      subcategories: [
        {
          id: "energy",
          name: "Energy",
          tags: [{ id: "peak", name: "Peak" }],
        },
        {
          id: "groove",
          name: "Groove",
          tags: [{ id: "shuffle", name: "Shuffle" }],
        },
      ],
    },
  ]);
}

describe("tagManager.taxonomy", () => {
  it("computes an after-target index for downward reorders", () => {
    expect(
      getSortableReorderTargetIndex(["a", "b", "c", "d", "e"], "a", "d"),
    ).toBe(4);
  });

  it("computes a cross-list insert index from the hovered row and placement", () => {
    expect(
      getRelativeInsertIndex(["a", "b", "c", "d", "e"], "d", "after"),
    ).toBe(4);
    expect(
      getRelativeInsertIndex(["a", "b", "c", "d", "e"], "d", "before"),
    ).toBe(3);
  });

  it("reorders categories", () => {
    const taxonomy = createTaxonomy();

    const result = moveCategory(taxonomy, 0, 2);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }

    expect(result.taxonomy.categoryOrder).toEqual([
      taxonomy.categoryOrder[1],
      taxonomy.categoryOrder[0],
    ]);
  });

  it("moves subcategories across categories", () => {
    const taxonomy = createTaxonomy();
    const sourceCategoryId = taxonomy.categoryOrder[0];
    const targetCategoryId = taxonomy.categoryOrder[1];
    const subcategoryId = taxonomy.categoriesById[sourceCategoryId].subcategoryIds[1];

    const result = moveSubcategory(taxonomy, subcategoryId, targetCategoryId, 1);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }

    expect(
      result.taxonomy.categoriesById[sourceCategoryId].subcategoryIds,
    ).not.toContain(subcategoryId);
    expect(
      result.taxonomy.categoriesById[targetCategoryId].subcategoryIds,
    ).toContain(subcategoryId);
    expect(result.taxonomy.subcategoriesById[subcategoryId].categoryId).toBe(
      targetCategoryId,
    );
  });

  it("reorders subcategories after the hovered row when dragging downward", () => {
    const taxonomy = buildTaxonomyFromCategoryTree([
      {
        id: "genre",
        name: "Genre",
        subcategories: [
          { id: "a", name: "A", tags: [] },
          { id: "b", name: "B", tags: [] },
          { id: "c", name: "C", tags: [] },
          { id: "d", name: "D", tags: [] },
          { id: "e", name: "E", tags: [] },
        ],
      },
    ]);
    const categoryId = taxonomy.categoryOrder[0];
    const [aId, bId, cId, dId, eId] =
      taxonomy.categoriesById[categoryId].subcategoryIds;
    const targetIndex = getSortableReorderTargetIndex(
      taxonomy.categoriesById[categoryId].subcategoryIds,
      aId,
      dId,
    );

    expect(targetIndex).toBe(4);

    const result = moveSubcategory(taxonomy, aId, categoryId, targetIndex ?? 0);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }

    expect(result.taxonomy.categoriesById[categoryId].subcategoryIds).toEqual([
      bId,
      cId,
      dId,
      aId,
      eId,
    ]);
  });

  it("reorders tags within a subcategory", () => {
    const taxonomy = createTaxonomy();
    const subcategoryId = taxonomy.categoriesById[taxonomy.categoryOrder[0]].subcategoryIds[0];
    const [houseTagId, technoTagId] =
      taxonomy.subcategoriesById[subcategoryId].tagIds;

    const result = moveTag(taxonomy, houseTagId, subcategoryId, 2);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }

    expect(result.taxonomy.subcategoriesById[subcategoryId].tagIds).toEqual([
      technoTagId,
      houseTagId,
    ]);
  });

  it("reorders tags after the hovered row when dragging downward", () => {
    const taxonomy = buildTaxonomyFromCategoryTree([
      {
        id: "genre",
        name: "Genre",
        subcategories: [
          {
            id: "electronic",
            name: "Electronic",
            tags: [
              { id: "a", name: "A" },
              { id: "b", name: "B" },
              { id: "c", name: "C" },
              { id: "d", name: "D" },
              { id: "e", name: "E" },
            ],
          },
        ],
      },
    ]);
    const categoryId = taxonomy.categoryOrder[0];
    const subcategoryId = taxonomy.categoriesById[categoryId].subcategoryIds[0];
    const [aId, bId, cId, dId, eId] =
      taxonomy.subcategoriesById[subcategoryId].tagIds;
    const targetIndex = getSortableReorderTargetIndex(
      taxonomy.subcategoriesById[subcategoryId].tagIds,
      aId,
      dId,
    );

    expect(targetIndex).toBe(4);

    const result = moveTag(taxonomy, aId, subcategoryId, targetIndex ?? 0);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }

    expect(result.taxonomy.subcategoriesById[subcategoryId].tagIds).toEqual([
      bId,
      cId,
      dId,
      aId,
      eId,
    ]);
  });

  it("moves tags across subcategories", () => {
    const taxonomy = createTaxonomy();
    const sourceSubcategoryId =
      taxonomy.categoriesById[taxonomy.categoryOrder[0]].subcategoryIds[0];
    const targetSubcategoryId =
      taxonomy.categoriesById[taxonomy.categoryOrder[1]].subcategoryIds[0];
    const tagId = taxonomy.subcategoriesById[sourceSubcategoryId].tagIds[0];

    const result = moveTag(taxonomy, tagId, targetSubcategoryId, 1);

    expect(result.status).toBe("applied");
    if (result.status !== "applied") {
      return;
    }

    expect(result.taxonomy.subcategoriesById[sourceSubcategoryId].tagIds).not.toContain(
      tagId,
    );
    expect(result.taxonomy.subcategoriesById[targetSubcategoryId].tagIds).toContain(
      tagId,
    );
    expect(result.taxonomy.tagsById[tagId].subcategoryId).toBe(targetSubcategoryId);
  });

  it("rejects subcategory moves that would create duplicate sibling names", () => {
    const taxonomy = buildTaxonomyFromCategoryTree([
      {
        id: "genre",
        name: "Genre",
        subcategories: [{ id: "energy-genre", name: "Energy", tags: [] }],
      },
      {
        id: "mood",
        name: "Mood",
        subcategories: [{ id: "energy-mood", name: "Energy", tags: [] }],
      },
    ]);

    const genreCategoryId = taxonomy.categoryOrder[0];
    const moodCategoryId = taxonomy.categoryOrder[1];
    const subcategoryId = taxonomy.categoriesById[moodCategoryId].subcategoryIds[0];

    const result = moveSubcategory(taxonomy, subcategoryId, genreCategoryId, 1);

    expect(result).toMatchObject({
      status: "blocked",
      reason: "duplicate-subcategory-name",
    });
  });

  it("rejects tag moves that would create duplicate sibling names", () => {
    const taxonomy = buildTaxonomyFromCategoryTree([
      {
        id: "genre",
        name: "Genre",
        subcategories: [
          {
            id: "a",
            name: "A",
            tags: [{ id: "house-a", name: "House" }],
          },
          {
            id: "b",
            name: "B",
            tags: [{ id: "house-b", name: "House" }],
          },
        ],
      },
    ]);

    const categoryId = taxonomy.categoryOrder[0];
    const sourceSubcategoryId = taxonomy.categoriesById[categoryId].subcategoryIds[0];
    const targetSubcategoryId = taxonomy.categoriesById[categoryId].subcategoryIds[1];
    const tagId = taxonomy.subcategoriesById[sourceSubcategoryId].tagIds[0];

    const result = moveTag(taxonomy, tagId, targetSubcategoryId, 1);

    expect(result).toMatchObject({
      status: "blocked",
      reason: "duplicate-tag-name",
    });
  });

  it("returns noop when the destination is unchanged", () => {
    const taxonomy = createTaxonomy();
    const subcategoryId = taxonomy.categoriesById[taxonomy.categoryOrder[0]].subcategoryIds[0];
    const tagId = taxonomy.subcategoriesById[subcategoryId].tagIds[0];

    const result = moveTag(taxonomy, tagId, subcategoryId, 0);

    expect(result).toMatchObject({
      status: "noop",
      reason: "same-position",
    });
  });
});
