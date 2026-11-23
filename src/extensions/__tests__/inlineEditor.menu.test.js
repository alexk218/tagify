import { describe, expect, it, vi } from "vitest";
import { buildCategoryTree } from "../../utils/tagTaxonomy";
import {
  createEnergyRatingRow,
  createMenuTagCategory,
  createStarRatingRow,
  getInlineMenuPlacement,
  getInitialInlineMenuFocusTarget,
  getSortedMenuTagCategories,
} from "../inlineEditor.menu";

const categories = [
  {
    id: "genre",
    name: "Genre",
    subcategories: [
      {
        id: "electronic",
        name: "Electronic",
        tags: [
          { id: "zulu", name: "Zulu", accentId: null },
          { id: "alpha", name: "Alpha", accentId: null },
          { id: "mike", name: "Mike", accentId: "amber" },
        ],
      },
    ],
  },
];

describe("inline editor menu", () => {
  it("chooses a stable side using the preferred expanded height", () => {
    expect(
      getInlineMenuPlacement({
        x: 500,
        y: 550,
        menuWidth: 260,
        preferredHeight: 540,
        viewportWidth: 800,
        viewportHeight: 768,
      }),
    ).toEqual({
      placement: "above",
      left: 500,
      bottom: 222,
      maxHeight: 538,
    });
  });

  it("keeps the whole menu inside the viewport at every edge", () => {
    expect(
      getInlineMenuPlacement({
        x: 790,
        y: 4,
        menuWidth: 260,
        preferredHeight: 540,
        viewportWidth: 800,
        viewportHeight: 768,
      }),
    ).toEqual({
      placement: "below",
      left: 532,
      top: 8,
      maxHeight: 540,
    });
  });

  it("renders an editable five-star rating row", async () => {
    const onSelect = vi.fn();
    const row = createStarRatingRow({ currentRating: 4, onSelect });

    expect(row).toHaveAttribute("aria-label", "Star rating");
    expect(row.querySelectorAll(".tagify-rating-star")).toHaveLength(5);
    expect(row.querySelector(".tagify-rating-star").style.fontSize).toBe("22px");
    expect(row.querySelectorAll("button")).toHaveLength(10);
    row.querySelector('[aria-label="Clear 4 star rating"]').click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith(0, 4));
    expect(row.querySelector('[aria-label="Set rating to 4 stars"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clears a newly selected menu rating without reopening the menu", async () => {
    const onSelect = vi.fn();
    const row = createStarRatingRow({ currentRating: 4, onSelect });

    row.querySelector('[aria-label="Set rating to 3 stars"]').click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(3, 4));
    row.querySelector('[aria-label="Clear 3 star rating"]').click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(0, 3));
  });

  it("keeps the menu rating when the removal confirmation is cancelled", async () => {
    const onSelect = vi.fn().mockResolvedValue(false);
    const row = createStarRatingRow({ currentRating: 5, onSelect });
    row.querySelector('[aria-label="Set rating to 4 stars"]').click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith(4, 5));
    expect(row.querySelector('[aria-label="Clear 5 star rating"]')).toHaveAttribute("aria-pressed", "true");
    expect([...row.querySelectorAll(".tagify-rating-star-fill")].map(fill => fill.style.width)).toEqual(Array(5).fill("100%"));
  });

  it("renders all ten energy choices in one horizontal row", async () => {
    const onSelect = vi.fn();
    const row = createEnergyRatingRow({ currentEnergy: 7, onSelect });

    expect(row.style.gridTemplateColumns).toBe("repeat(10, minmax(0, 1fr))");
    expect(row.querySelectorAll("button")).toHaveLength(10);
    expect(row.querySelector('[aria-label="Clear energy 7"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    row.querySelector('[aria-label="Set energy to 4"]').click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith(4));

    row.querySelector('[aria-label="Clear energy 4"]').click();
    await vi.waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(0));
    await vi.waitFor(() =>
      expect(row.querySelector('[aria-label="Set energy to 4"]')).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(row.querySelector('[aria-label="Set energy to 7"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it.each([
    ["custom", ["Zulu", "Alpha", "Mike"]],
    ["custom-highlighted-first", ["Mike", "Zulu", "Alpha"]],
    ["alphabetical-asc", ["Alpha", "Mike", "Zulu"]],
    ["alphabetical-desc", ["Zulu", "Mike", "Alpha"]],
  ])(
    "uses the TagSelector's %s sort mode for dropdown tags",
    (mode, expected) => {
      localStorage.setItem("tagify:tagSelectorSortMode", mode);

      const sorted = getSortedMenuTagCategories(categories, localStorage);

      expect(sorted[0].subcategories[0].tags.map((tag) => tag.name)).toEqual(
        expected,
      );
    },
  );

  it("focuses an applied tag instead of the selected energy for a tag-triggered menu", () => {
    const menu = document.createElement("div");
    menu.innerHTML = `
      <button aria-pressed="true">4 stars</button>
      <button data-tagify-energy="3" aria-pressed="true">3</button>
      <details><summary>Genres</summary>
        <button data-tagify-tag-id="house" aria-pressed="true">House</button>
      </details>
    `;

    expect(getInitialInlineMenuFocusTarget(menu, "tags")).toHaveTextContent("House");
    expect(getInitialInlineMenuFocusTarget(menu, "energy")).toHaveTextContent("3");
  });
});

describe("createMenuTagCategory", () => {
  const createTagButton = (tag) => {
    const button = document.createElement("button");
    button.textContent = tag.name;
    button.dataset.tagId = tag.id;
    return button;
  };

  it("shows tags placed directly in a category and in nested folders", () => {
    const category = {
      id: "aesthetic",
      name: "AESTHETIC",
      tags: [{ id: "space", name: "太空", accentId: null }],
      subcategories: [
        {
          id: "eras",
          name: "Eras",
          tags: [{ id: "y2k", name: "Y2K", accentId: null }],
          subcategories: [
            { id: "deep", name: "Deep", tags: [{ id: "retro", name: "复古", accentId: null }], subcategories: [] },
          ],
        },
      ],
    };

    const details = createMenuTagCategory(category, {
      appliedTagIds: new Set(["retro"]),
      openApplied: true,
      createTagButton,
    });

    expect([...details.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["太空", "Y2K", "复古"]);
    expect(details.querySelector(":scope > button")?.textContent).toBe("太空");
    expect([...details.querySelectorAll("details")].map((d) => d.open)).toEqual([true, true]);
    expect(details.open).toBe(true);
  });

  it("keeps sections closed unless the menu opens on the tags", () => {
    const details = createMenuTagCategory(
      { id: "c", name: "From Community", tags: [{ id: "t", name: "Single", accentId: null }], subcategories: [] },
      { appliedTagIds: new Set(["t"]), openApplied: false, createTagButton },
    );
    expect(details.open).toBe(false);
    expect(details.querySelector("button")?.textContent).toBe("Single");
  });
});

describe("menu tags built from a saved library", () => {
  it("shows a category's own tags and its folders, including folders inside folders", () => {
    const tag = (id, parentId) => ({ id, name: id, parentId, subcategoryId: parentId, accentId: null });
    const folder = (id, parentId) => ({ id, name: id, parentId, categoryId: "electronic", tagIds: [], childIds: [] });
    const folders = { house: folder("#house", "electronic"), techno: folder("#techno", "electronic"), region: folder("Region", "house") };
    folders.house.id = "house"; folders.techno.id = "techno"; folders.region.id = "region";
    const [category] = buildCategoryTree({
      categoryOrder: ["electronic"],
      categoriesById: { electronic: { id: "electronic", name: "ELECTRONIC", subcategoryIds: ["house", "techno"], childIds: ["HOUSE", "DISCO", "house", "techno"] } },
      foldersById: folders,
      subcategoriesById: folders,
      childrenByParentId: { electronic: ["HOUSE", "DISCO", "house", "techno"], house: ["Deep House", "region"], techno: ["Acid Techno"], region: ["French House"] },
      tagsById: {
        HOUSE: tag("HOUSE", "electronic"),
        DISCO: tag("DISCO", "electronic"),
        "Deep House": tag("Deep House", "house"),
        "Acid Techno": tag("Acid Techno", "techno"),
        "French House": tag("French House", "region"),
      },
      customAccentsById: {},
    });
    const details = createMenuTagCategory(category, {
      appliedTagIds: new Set(),
      createTagButton: (item) => Object.assign(document.createElement("button"), { textContent: item.name }),
    });

    expect([...details.querySelectorAll("summary")].map((summary) => summary.textContent)).toEqual(["ELECTRONIC", "#house", "Region", "#techno"]);
    expect([...details.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["HOUSE", "DISCO", "Deep House", "French House", "Acid Techno"]);
  });
});
