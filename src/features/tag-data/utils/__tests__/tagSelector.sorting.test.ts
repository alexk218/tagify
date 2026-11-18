// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TagCategory } from "@/types/tagData";
import {
  countTagUses,
  filterTagSelectorCategories,
  sortTagSelectorCategories,
  type TagSelectorSortMode,
} from "../tagSelector.sorting";

function createCategories(): TagCategory[] {
  return [
      {
        id: "genre",
        name: "Genre",
        subcategories: [
          {
            id: "electronic",
            name: "Electronic",
            tags: [
              { id: "zulu", name: "Zulu", accentId: "blue" },
              { id: "alpha", name: "Alpha", accentId: null },
              { id: "mike", name: "Mike", accentId: "amber" },
            ],
          },
          {
            id: "mood",
            name: "Mood",
            tags: [
              { id: "late", name: "Late", accentId: null },
              { id: "early", name: "Early", accentId: null },
            ],
          },
        ],
      },
    {
      id: "energy",
      name: "Energy",
        subcategories: [
          {
            id: "peak",
            name: "Peak",
            tags: [{ id: "drive", name: "Drive", accentId: null }],
          },
        ],
      },
  ];
}

function getTagNames(
  categories: TagCategory[],
  categoryId: string,
  subcategoryId: string,
): string[] {
  const category = categories.find((candidate) => candidate.id === categoryId);
  const subcategory = category?.subcategories.find(
    (candidate) => candidate.id === subcategoryId,
  );

  return subcategory?.tags.map((tag) => tag.name) ?? [];
}

describe("tagSelector.sorting", () => {
  it("preserves taxonomy order for custom mode", () => {
    const categories = createCategories();

    const result = sortTagSelectorCategories(categories, "custom");

    expect(result).toBe(categories);
    expect(getTagNames(result, "genre", "electronic")).toEqual([
      "Zulu",
      "Alpha",
      "Mike",
    ]);
  });

  it.each([
    ["custom-highlighted-first", ["Zulu", "Mike", "Alpha"]],
    ["alphabetical-asc", ["Alpha", "Mike", "Zulu"]],
    ["alphabetical-desc", ["Zulu", "Mike", "Alpha"]],
  ] as const)(
    "sorts tags within each subcategory for %s",
    (mode: TagSelectorSortMode, expectedOrder) => {
      const result = sortTagSelectorCategories(createCategories(), mode);

      expect(getTagNames(result, "genre", "electronic")).toEqual(expectedOrder);
      expect(getTagNames(result, "genre", "mood")).toEqual(
        mode === "alphabetical-asc" ? ["Early", "Late"] : ["Late", "Early"],
      );
    },
  );

  it("does not reorder categories or subcategories under alternate sort modes", () => {
    const categories = createCategories();

    const result = sortTagSelectorCategories(categories, "alphabetical-asc");

    expect(result.map((category) => category.id)).toEqual(["genre", "energy"]);
    expect(result[0].subcategories.map((subcategory) => subcategory.id)).toEqual([
      "electronic",
      "mood",
    ]);
  });

  it("keeps equivalent names in their original order", () => {
    const categories: TagCategory[] = [
      {
        id: "genre",
        name: "Genre",
        subcategories: [
          {
            id: "electronic",
            name: "Electronic",
            tags: [
              { id: "first", name: "House", accentId: null },
              { id: "second", name: "house", accentId: null },
              { id: "third", name: "HOUSE", accentId: null },
            ],
          },
        ],
      },
    ];

    const result = sortTagSelectorCategories(categories, "alphabetical-asc");

    expect(result[0].subcategories[0].tags.map((tag) => tag.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("reveals full descendant tags when searching by category or subcategory name", () => {
    const categories = createCategories();

    expect(
      filterTagSelectorCategories(categories, "genre")[0].subcategories[0].tags.map(
        (tag) => tag.name,
      ),
    ).toEqual(["Zulu", "Alpha", "Mike"]);

    expect(
      filterTagSelectorCategories(categories, "electronic")[0].subcategories[0].tags.map(
        (tag) => tag.name,
      ),
    ).toEqual(["Zulu", "Alpha", "Mike"]);
  });

  describe("most-used", () => {
    const uses = countTagUses({
      tracks: {
        "spotify:track:1": { tagIds: ["alpha", "late", "drive"] } as never,
        "spotify:track:2": { tagIds: ["alpha", "drive", "drive"] } as never,
        "spotify:track:3": { tagIds: ["drive", "mike"] } as never,
      },
      playlists: { "spotify:album:1": { tagIds: ["drive"] } as never },
      artists: { "spotify:artist:1": { tagIds: ["late"] } as never },
    });

    it("counts each song, playlist, album and artist once per tag", () => {
      expect(Object.fromEntries(uses)).toEqual({ alpha: 2, late: 2, drive: 4, mike: 1 });
    });

    it("lists the most used tags first, then by name", () => {
      const result = sortTagSelectorCategories(createCategories(), "most-used", uses);

      expect(getTagNames(result, "genre", "electronic")).toEqual(["Alpha", "Mike", "Zulu"]);
      expect(getTagNames(result, "genre", "mood")).toEqual(["Late", "Early"]);
    });

    it("lists folders by how much their tags are used together", () => {
      const result = sortTagSelectorCategories(createCategories(), "most-used", uses);

      // Genre's tags are used 5 times, Energy's 4; Electronic 3, Mood 2.
      expect(result.map((category) => category.id)).toEqual(["genre", "energy"]);
      expect(result[0].subcategories.map((subcategory) => subcategory.id)).toEqual([
        "electronic",
        "mood",
      ]);

      const busierEnergy = new Map(uses).set("drive", 9);
      expect(
        sortTagSelectorCategories(createCategories(), "most-used", busierEnergy).map(
          (category) => category.id,
        ),
      ).toEqual(["energy", "genre"]);
    });

    it("keeps the custom order until the counts are known", () => {
      const categories = createCategories();
      expect(sortTagSelectorCategories(categories, "most-used")).toBe(categories);
    });
  });
});
