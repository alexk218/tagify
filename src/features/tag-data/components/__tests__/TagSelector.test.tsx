import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TagSelector from "../TagSelector";
import styles from "../TagSelector.module.css";
import { TagCategory } from "@/types/tagData";

const categories: TagCategory[] = [
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
        id: "percussion",
        name: "Percussion",
        tags: [{ id: "tribal", name: "Tribal", accentId: null }],
      },
    ],
  },
];

function renderTagSelector(overrides: Partial<React.ComponentProps<typeof TagSelector>> = {}) {
  const onToggleTag = vi.fn();
  const onOpenTagManager = vi.fn();

  render(
    <TagSelector
      categories={categories}
      customAccentsById={{}}
      trackTagIds={[]}
      onToggleTag={onToggleTag}
      onOpenTagManager={onOpenTagManager}
      isMultiTagging={false}
      isLockedTrack={false}
      {...overrides}
    />,
  );

  return {
    onToggleTag,
    onOpenTagManager,
  };
}

function seedExpandedState() {
  window.localStorage.setItem("tagify:expandedCategories", JSON.stringify(["genre"]));
  window.localStorage.setItem(
    "tagify:expandedSubcategories",
    JSON.stringify(["genre:electronic", "genre:percussion"]),
  );
  window.localStorage.setItem("tagify:areAllExpanded", "false");
  window.localStorage.setItem("tagify:tagSearchTerm", "");
}

function getElectronicTagButtons() {
  const electronicHeader = screen.getByText("Electronic");
  const subcategory = electronicHeader.closest(`.${styles.subcategory}`);
  if (!subcategory) {
    throw new Error("Expected Electronic subcategory container");
  }

  const tagGrid = subcategory.querySelector(`.${styles.tagGrid}`);
  if (!tagGrid) {
    throw new Error("Expected Electronic tag grid");
  }

  return within(tagGrid as HTMLElement).getAllByRole("button");
}

function expectTagOrder(expectedLabels: string[]) {
  const actualLabels = getElectronicTagButtons().map((button) => button.textContent?.trim());
  expect(actualLabels).toEqual(expectedLabels);
}

describe("TagSelector", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedExpandedState();
  });

  it("searches existing tags without offering to create one", async () => {
    const user = userEvent.setup();
    renderTagSelector();
    await user.type(screen.getByRole("textbox", { name: "Search tags" }), "Ambient");
    expect(screen.queryByRole("combobox", { name: "New tag category or folder" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create and apply/ })).toBeNull();
  });

  it("Enter adds a single match without removing an applied tag, and search can be cleared", async () => {
    const user = userEvent.setup();
    const { onToggleTag } = renderTagSelector({ trackTagIds: ["alpha"] });
    const input = screen.getByRole("textbox", { name: "Search tags" });
    await user.type(input, "alp{Enter}");
    expect(onToggleTag).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Clear tag search" }));
    await user.type(input, "zul{Enter}");
    expect(onToggleTag).toHaveBeenCalledWith("zulu");
  });

  it("defaults to custom order", () => {
    renderTagSelector();

    expect(screen.getByLabelText("Tag sort order")).toHaveValue("custom");
    expectTagOrder(["Zulu", "Alpha", "Mike"]);
  });

  it("reorders visible tags and keeps toggle behavior tied to tag ids", async () => {
    const user = userEvent.setup();
    const { onToggleTag } = renderTagSelector();

    await user.selectOptions(screen.getByLabelText("Tag sort order"), "alphabetical-asc");

    expectTagOrder(["Alpha", "Mike", "Zulu"]);

    await user.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onToggleTag).toHaveBeenCalledWith("alpha");
  });

  it("supports the highlighted-first custom sort and renders accented chips", async () => {
    const user = userEvent.setup();
    renderTagSelector();

    await user.selectOptions(
      screen.getByLabelText("Tag sort order"),
      "custom-highlighted-first",
    );

    expectTagOrder(["Zulu", "Mike", "Alpha"]);
    expect(screen.getByRole("button", { name: "Zulu" }).className).toContain(
      styles.tagButtonAccented,
    );
  });

  it("keeps applied styling after reordering", async () => {
    const user = userEvent.setup();
    renderTagSelector({ trackTagIds: ["alpha"] });

    await user.selectOptions(screen.getByLabelText("Tag sort order"), "alphabetical-desc");

    const alphaButton = screen.getByRole("button", { name: "Alpha" });
    expect(alphaButton.className).toContain(styles.tagApplied);
  });

  it("filters correctly while a non-custom sort mode is active", async () => {
    const user = userEvent.setup();
    renderTagSelector();

    await user.selectOptions(screen.getByLabelText("Tag sort order"), "alphabetical-desc");
    await user.type(screen.getByPlaceholderText("Search tags..."), "mi");

    expect(screen.getByRole("button", { name: "Mike" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zulu" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alpha" })).not.toBeInTheDocument();
  });

  it("matches category and subcategory names when searching", async () => {
    const user = userEvent.setup();
    renderTagSelector();

    await user.type(screen.getByPlaceholderText("Search tags..."), "electronic");

    expect(screen.getByRole("button", { name: "Zulu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mike" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tribal" })).not.toBeInTheDocument();
  });

  it("restores the saved sort mode from localStorage", () => {
    window.localStorage.setItem("tagify:tagSelectorSortMode", "alphabetical-desc");

    renderTagSelector();

    expect(screen.getByLabelText("Tag sort order")).toHaveValue("alphabetical-desc");
    expectTagOrder(["Zulu", "Mike", "Alpha"]);
  });
});

it("places folders nested inside other folders in their own indented list", () => {
  window.localStorage.clear();
  window.localStorage.setItem("tagify:expandedCategories", JSON.stringify(["genre"]));
  window.localStorage.setItem(
    "tagify:expandedSubcategories",
    JSON.stringify(["genre:electronic", "genre:house", "genre:deep"]),
  );
  renderTagSelector({
    categories: [
      {
        id: "genre",
        name: "Genre",
        subcategories: [
          {
            id: "electronic",
            name: "Electronic",
            tags: [{ id: "french", name: "French House" }],
            subcategories: [
              {
                id: "house",
                name: "House Sub",
                tags: [{ id: "sub", name: "Sub Tag" }],
                subcategories: [
                  { id: "deep", name: "Deep", tags: [{ id: "deep-tag", name: "Deep Tag" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  expect(styles.nestedSubcategoryList).toBeTruthy();
  const folderOf = (name: string) => screen.getByText(name).closest(`.${styles.subcategory}`);
  const electronic = folderOf("Electronic");
  const house = folderOf("House Sub");
  const deep = folderOf("Deep");

  expect(house?.parentElement).toHaveClass(styles.nestedSubcategoryList);
  expect(house?.parentElement?.parentElement).toBe(electronic);
  expect(deep?.parentElement).toHaveClass(styles.nestedSubcategoryList);
  expect(deep?.parentElement?.parentElement).toBe(house);
  expect(screen.getByRole("button", { name: "Deep Tag" })).toBeInTheDocument();
});

it("keeps the full name of a long clipped tag available on hover and to assistive technology", () => {
  seedExpandedState();
  const name = "Song length · from 3:00 through 5:00 · regular songs";
  renderTagSelector({ categories: [{ ...categories[0], subcategories: [{ ...categories[0].subcategories[0], tags: [{ id: "long", name }] }] }] });
  const button = screen.getByRole("button", { name });
  expect(button).toHaveAttribute("title", name);
  expect(button).toHaveTextContent(name);
});
