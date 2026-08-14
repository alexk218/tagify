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
