import { describe, expect, it, vi } from "vitest";
import {
  createEnergyRatingRow,
  getInlineMenuPlacement,
  getSortedMenuTagCategories,
  updateEnergyRatingRowSelection,
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

  it("renders all ten energy choices in one horizontal row", () => {
    const onSelect = vi.fn();
    const row = createEnergyRatingRow({ currentEnergy: 7, onSelect });

    expect(row.style.gridTemplateColumns).toBe("repeat(10, minmax(0, 1fr))");
    expect(row.querySelectorAll("button")).toHaveLength(10);
    expect(row.querySelector('[aria-label="Set energy to 7"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    row.querySelector('[aria-label="Set energy to 4"]').click();
    expect(onSelect).toHaveBeenCalledWith(4);

    updateEnergyRatingRowSelection(row, 4);
    expect(row.querySelector('[aria-label="Set energy to 7"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(row.querySelector('[aria-label="Set energy to 4"]')).toHaveAttribute(
      "aria-pressed",
      "true",
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
});
