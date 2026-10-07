import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TagManager from "../TagManager";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import { TagTaxonomy } from "@/types/tagData";

function createTaxonomy(): TagTaxonomy {
  const taxonomy = buildTaxonomyFromCategoryTree([
    {
      id: "genre",
      name: "Genre",
      subcategories: [
        {
          id: "electronic",
          name: "Electronic",
          tags: [
            { id: "house", name: "House" },
            { id: "Techno", name: "Techno" },
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
      ],
    },
  ]);
  delete (taxonomy as Partial<TagTaxonomy>).colorThemesById;
  delete (taxonomy as Partial<TagTaxonomy>).ungroupedColorIds;
  return taxonomy;
}

function createTaxonomyWithFireCollection(): TagTaxonomy {
  const taxonomy = createTaxonomy();
  taxonomy.customAccentsById["custom:flame"] = {
    id: "custom:flame",
    name: "Flame",
    color: "#ff3300",
    themeId: "theme:fire",
  };
  taxonomy.colorThemesById = {
    "theme:fire": { id: "theme:fire", name: "Fire", colorIds: ["custom:flame"] },
  };
  taxonomy.ungroupedColorIds = [];
  const house = Object.values(taxonomy.tagsById).find((tag) => tag.name === "House");
  if (house) house.accentId = "custom:flame";
  return taxonomy;
}

function renderTagManager(overrides: Partial<React.ComponentProps<typeof TagManager>> = {}) {
  const onClose = vi.fn();
  const onReplaceTaxonomy = vi.fn();

  const rendered = render(
    <TagManager
      taxonomy={createTaxonomy()}
      tracks={{}}
      playlists={{}}
      artists={{}}
      activeTagFilters={[]}
      excludedTagFilters={[]}
      smartPlaylists={[]}
      onClose={onClose}
      onReplaceTaxonomy={onReplaceTaxonomy}
      {...overrides}
    />,
  );

  return {
    ...rendered,
    onClose,
    onReplaceTaxonomy,
  };
}

function mockCommunityCatalog(tags: Array<Record<string, unknown>>) {
  class MockXMLHttpRequest {
    responseType = "";
    timeout = 0;
    status = 200;
    response: unknown = { tags };
    responseText = JSON.stringify({ tags });
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;

    open = vi.fn();
    setRequestHeader = vi.fn();
    send = vi.fn(() => {
      queueMicrotask(() => this.onload?.());
    });
  }

  vi.stubGlobal("XMLHttpRequest", MockXMLHttpRequest);
}

describe("TagManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem("tagify:showDefaultColorPalette");
    localStorage.removeItem("tagify:colorThemeSortMode");
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows the approved Taxonomy label", () => {
    renderTagManager();

    expect(screen.getByText("Categories and folders")).toBeInTheDocument();
    expect(
      screen.queryByText("Drag categories and subcategories here."),
    ).not.toBeInTheDocument();
  });

  it("shows clear rename and delete actions for categories and subcategories", async () => {
    renderTagManager();

    const renameCategory = await screen.findByRole("button", { name: "Rename category Genre" });
    const deleteCategory = screen.getByRole("button", { name: "Delete category Genre" });
    const renameSubcategory = screen.getByRole("button", { name: "Rename subcategory Electronic" });
    const deleteSubcategory = screen.getByRole("button", { name: "Delete subcategory Electronic" });

    expect(renameCategory).toHaveAttribute("title", "Rename Genre");
    expect(deleteCategory).toHaveAttribute("title", "Delete Genre");
    expect(renameSubcategory).toHaveAttribute("title", "Rename Electronic");
    expect(deleteSubcategory).toHaveAttribute("title", "Delete Electronic");
    [renameCategory, deleteCategory, renameSubcategory, deleteSubcategory].forEach((button) => {
      expect(button.querySelector("svg")).toHaveAttribute("width", "17");
      expect(button.querySelector("svg")).toHaveAttribute("height", "17");
    });
  });

  it("restores collapsed categories when reopened during the session", async () => {
    const user = userEvent.setup();
    let expandedCategoryIds: string[] | undefined;
    const onExpandedCategoryIdsChange = vi.fn((categoryIds: string[]) => {
      expandedCategoryIds = categoryIds;
    });

    const firstRender = renderTagManager({ onExpandedCategoryIdsChange });
    await user.click(await screen.findByRole("button", { name: "Collapse Genre" }));
    await waitFor(() => expect(expandedCategoryIds).toEqual([]));
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    firstRender.unmount();

    renderTagManager({
      initialExpandedCategoryIds: expandedCategoryIds,
      onExpandedCategoryIdsChange,
    });

    expect(await screen.findByRole("button", { name: "Expand Genre" })).toBeInTheDocument();
  });

  it("restores the selected subcategory when reopened during the session", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomy();
    const genreCategoryId = taxonomy.categoryOrder.find(
      (categoryId) => taxonomy.categoriesById[categoryId]?.name === "Genre",
    );
    const percussionSubcategoryId = Object.values(taxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Percussion",
    )?.id;
    let expandedCategoryIds: string[] | undefined;
    let selectedSubcategoryId: string | null | undefined;
    const onExpandedCategoryIdsChange = vi.fn((categoryIds: string[]) => {
      expandedCategoryIds = categoryIds;
    });
    const onSelectedSubcategoryIdChange = vi.fn((subcategoryId: string | null) => {
      selectedSubcategoryId = subcategoryId;
    });

    const firstRender = renderTagManager({
      taxonomy,
      onExpandedCategoryIdsChange,
      onSelectedSubcategoryIdChange,
    });
    await user.click(await screen.findByLabelText("Select subcategory Percussion"));
    await waitFor(() => expect(selectedSubcategoryId).toBe(percussionSubcategoryId));
    expect(expandedCategoryIds).toEqual([genreCategoryId]);
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    firstRender.unmount();

    renderTagManager({
      taxonomy,
      initialExpandedCategoryIds: expandedCategoryIds,
      onExpandedCategoryIdsChange,
      initialSelectedSubcategoryId: selectedSubcategoryId,
      onSelectedSubcategoryIdChange,
    });

    expect(await screen.findByRole("button", { name: "Collapse Genre" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Selected path")).toHaveTextContent(
      "Genre/Percussion",
    );
  });

  it("updates the inspector when selecting a different subcategory", async () => {
    const user = userEvent.setup();
    renderTagManager();

    await user.click(await screen.findByLabelText("Select subcategory Percussion"));

    await waitFor(() => {
      expect(screen.getByLabelText("Selected path")).toHaveTextContent("Genre/Percussion");
      expect(screen.getByText("Tribal")).toBeInTheDocument();
    });
  });

  it("keeps a clicked top-level category selected and allows tags directly under it", async () => {
    const user = userEvent.setup();
    const onSelectedSubcategoryIdChange = vi.fn();
    const promptSpy = vi.spyOn(window, "prompt");
    const { onReplaceTaxonomy } = renderTagManager({ onSelectedSubcategoryIdChange });

    await waitFor(() => {
      expect(screen.getByLabelText("Selected path")).toHaveTextContent("Genre/Electronic");
    });

    await user.click(await screen.findByLabelText("Select category Mood"));

    await waitFor(() => {
      expect(onSelectedSubcategoryIdChange).toHaveBeenLastCalledWith(null);
      expect(screen.getByLabelText("Selected path")).toHaveTextContent("Mood");
    });
    expect(screen.getByPlaceholderText(/Add tag to Mood/i)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Add tag to Mood/i), "Reflective");
    await user.click(screen.getByRole("button", { name: /Add Tag/i }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const moodCategoryId = savedTaxonomy.categoryOrder.find(
      (categoryId) => savedTaxonomy.categoriesById[categoryId]?.name === "Mood",
    );
    const reflectiveTag = Object.values(savedTaxonomy.tagsById).find(
      (tag) => tag.name === "Reflective",
    );

    expect(promptSpy).not.toHaveBeenCalled();
    expect(reflectiveTag?.parentId).toBe(moodCategoryId);
    expect(savedTaxonomy.childrenByParentId?.[moodCategoryId!]).toContain(
      reflectiveTag?.id,
    );
  });

  it("imports community tags directly into the selected top-level category", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();
    mockCommunityCatalog([
      {
        key: "organic",
        name: "Organic",
        songCount: 42,
        contributorCount: 5,
        assignmentCount: 51,
      },
    ]);

    await user.click(screen.getByRole("tab", { name: "Community" }));
    await user.click(await screen.findByRole("button", { name: /^Mood\b/ }));
    const organicRow = (await screen.findByText("Organic")).closest("article");
    expect(organicRow).not.toBeNull();

    await user.click(within(organicRow!).getByRole("button", { name: "Import" }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const moodCategoryId = savedTaxonomy.categoryOrder.find(
      (categoryId) => savedTaxonomy.categoriesById[categoryId]?.name === "Mood",
    );
    const organicTag = Object.values(savedTaxonomy.tagsById).find(
      (tag) => tag.name === "Organic",
    );

    expect(organicTag?.parentId).toBe(moodCategoryId);
    expect(organicTag?.subcategoryId).toBe(moodCategoryId);
    expect(savedTaxonomy.childrenByParentId?.[moodCategoryId!]).toContain(organicTag?.id);
    expect(
      Object.values(savedTaxonomy.subcategoriesById).some(
        (subcategory) => subcategory.name === "Community Imports",
      ),
    ).toBe(false);
  });

  it("opens the Community filtered song search when a community tag row is clicked", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderTagManager();
    mockCommunityCatalog([
      {
        key: "night drive",
        name: "Night Drive",
        songCount: 12,
        contributorCount: 3,
        assignmentCount: 14,
      },
    ]);

    await user.click(screen.getByRole("tab", { name: "Community" }));
    const tagLink = await screen.findByRole("link", {
      name: "Open Community songs tagged Night Drive",
    });

    await user.click(tagLink);

    expect(openSpy).toHaveBeenCalledWith(
      "https://community.tagify.fm/search?tag=label%3ANight%2520Drive",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("defaults community sorting to most users and supports ascending order", async () => {
    const user = userEvent.setup();
    renderTagManager();
    mockCommunityCatalog([
      {
        key: "solo favorite",
        name: "Solo Favorite",
        songCount: 120,
        contributorCount: 1,
        assignmentCount: 140,
      },
      {
        key: "group favorite",
        name: "Group Favorite",
        songCount: 40,
        contributorCount: 8,
        assignmentCount: 44,
      },
      {
        key: "small crowd",
        name: "Small Crowd",
        songCount: 20,
        contributorCount: 3,
        assignmentCount: 22,
      },
    ]);

    await user.click(screen.getByRole("tab", { name: "Community" }));

    expect(screen.getByRole("combobox", { name: "Sort community tags" })).toHaveValue("contributors");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Most users");
    expect(screen.queryByRole("option", { name: "Most assignments" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Niche" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Minimum community user count" })).not.toBeInTheDocument();

    const getCommunityTagNames = () =>
      screen
        .getAllByRole("link", { name: /Open Community songs tagged/ })
        .map((row) => within(row).getByText(/Favorite|Crowd/).textContent);

    await screen.findByText("Group Favorite");
    expect(getCommunityTagNames()).toEqual(["Group Favorite", "Small Crowd", "Solo Favorite"]);
    expect(screen.getByText("120 public tracks · 1 user")).toBeInTheDocument();
    expect(screen.queryByText(/assignments?/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sort community tags ascending" }));

    expect(getCommunityTagNames()).toEqual(["Solo Favorite", "Small Crowd", "Group Favorite"]);
  });

  it("does not open Community search when importing a community tag", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderTagManager();
    mockCommunityCatalog([
      {
        key: "organic",
        name: "Organic",
        songCount: 42,
        contributorCount: 5,
        assignmentCount: 51,
      },
    ]);

    await user.click(screen.getByRole("tab", { name: "Community" }));
    const organicRow = (await screen.findByText("Organic")).closest("article");
    expect(organicRow).not.toBeNull();

    await user.click(within(organicRow!).getByRole("button", { name: "Import" }));

    expect(openSpy).not.toHaveBeenCalled();
  });

  it("creates nested folders under an existing folder", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValueOnce("Sub Mood");
    const { onReplaceTaxonomy } = renderTagManager();

    await user.click(await screen.findByLabelText("Select subcategory Electronic"));
    const electronicRow = screen
      .getByLabelText("Select subcategory Electronic")
      .closest("div");
    const nestedAddButton = electronicRow?.nextElementSibling as HTMLElement | null;

    expect(nestedAddButton).toHaveTextContent("+ Add Subfolder");
    await user.click(nestedAddButton!);
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const electronicFolder = Object.values(savedTaxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Electronic",
    );
    const subMoodFolder = Object.values(savedTaxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Sub Mood",
    );

    expect(subMoodFolder?.parentId).toBe(electronicFolder?.id);
    expect(savedTaxonomy.childrenByParentId?.[electronicFolder!.id]).toContain(
      subMoodFolder?.id,
    );
  });

  it("expands and collapses nested folders", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValueOnce("Sub Mood");
    renderTagManager();

    await user.click(await screen.findByLabelText("Select subcategory Electronic"));
    const electronicRow = screen
      .getByLabelText("Select subcategory Electronic")
      .closest("div");
    const nestedAddButton = electronicRow?.nextElementSibling as HTMLElement | null;
    await user.click(nestedAddButton!);

    expect(await screen.findByLabelText("Select subcategory Sub Mood")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse Electronic" }));
    expect(screen.queryByLabelText("Select subcategory Sub Mood")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand Electronic" }));
    expect(await screen.findByLabelText("Select subcategory Sub Mood")).toBeInTheDocument();
  });

  it("renames a tag with spaces inside Tagify instead of using Spotify's native prompt", async () => {
    const user = userEvent.setup();
    const promptSpy = vi.spyOn(window, "prompt");
    const { onReplaceTaxonomy } = renderTagManager();

    await user.click(screen.getByRole("button", { name: "Rename tag House" }));
    const dialog = screen.getByRole("dialog", { name: "Rename tag" });
    const nameInput = within(dialog).getByRole("textbox", { name: "Rename tag" });
    await user.clear(nameInput);
    await user.type(nameInput, "Deep House");
    expect(nameInput).toHaveValue("Deep House");
    expect(promptSpy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Save name" }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    expect(Object.values(savedTaxonomy.tagsById).some((tag) => tag.name === "Deep House")).toBe(true);
  });

  it("shows and edits tags in a nested folder after selecting it", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValueOnce("Sub Mood");
    const { onReplaceTaxonomy } = renderTagManager();

    await user.click(screen.getByLabelText("Select subcategory Electronic"));
    const electronicRow = screen.getByLabelText("Select subcategory Electronic").closest("div");
    await user.click(electronicRow?.nextElementSibling as HTMLElement);
    expect(screen.getByLabelText("Select subcategory Sub Mood")).not.toHaveAttribute("aria-describedby");
    await user.click(screen.getByLabelText("Select subcategory Sub Mood"));
    expect(screen.getByLabelText("Selected path")).toHaveTextContent("Genre/Electronic/Sub Mood");
    const input = screen.getByPlaceholderText("Add tag to Sub Mood…");
    await user.type(input, "Dream Pop");
    await user.click(screen.getByRole("button", { name: "Add Tag" }));
    expect(screen.getByText("Dream Pop")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Select subcategory Electronic"));
    await user.click(screen.getByLabelText("Select subcategory Sub Mood"));
    expect(screen.getByText("Dream Pop")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));
    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    expect(Object.values(savedTaxonomy.tagsById).some((tag) => tag.name === "Dream Pop")).toBe(true);
  });

  it("nests a sibling folder when it is dropped onto another folder", async () => {
    const user = userEvent.setup();
    const taxonomy = buildTaxonomyFromCategoryTree([
      {
        id: "genres-styles",
        name: "Genres & Styles",
        subcategories: [
          { id: "genres", name: "Genres", tags: [] },
          { id: "source", name: "Source", tags: [] },
        ],
      },
    ]);
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    const { onReplaceTaxonomy } = renderTagManager({ taxonomy });

    const sourceRow = screen
      .getByLabelText("Select subcategory Source")
      .closest("div")!;
    const genresRow = screen
      .getByLabelText("Select subcategory Genres")
      .closest("div")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 100,
      width: 300,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(sourceRow, { dataTransfer });
    const dragOverEvent = createEvent.dragOver(genresRow, { dataTransfer });
    const dropEvent = createEvent.drop(genresRow, { dataTransfer });
    Object.defineProperty(dragOverEvent, "clientY", { value: 50 });
    Object.defineProperty(dropEvent, "clientY", { value: 50 });
    fireEvent(genresRow, dragOverEvent);
    fireEvent(genresRow, dropEvent);
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const categoryId = savedTaxonomy.categoryOrder[0];
    const genresFolder = Object.values(savedTaxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Genres",
    );
    const sourceFolder = Object.values(savedTaxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Source",
    );

    expect(savedTaxonomy.childrenByParentId?.[categoryId]).toEqual([
      genresFolder?.id,
    ]);
    expect(sourceFolder?.parentId).toBe(genresFolder?.id);
    expect(savedTaxonomy.childrenByParentId?.[genresFolder!.id]).toContain(
      sourceFolder?.id,
    );
  });

  it("reorders sibling folders when dropped on a row edge", async () => {
    const user = userEvent.setup();
    const taxonomy = buildTaxonomyFromCategoryTree([
      {
        id: "genres-styles",
        name: "Genres & Styles",
        subcategories: [
          { id: "genres", name: "Genres", tags: [] },
          { id: "source", name: "Source", tags: [] },
        ],
      },
    ]);
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    const { onReplaceTaxonomy } = renderTagManager({ taxonomy });

    const sourceRow = screen
      .getByLabelText("Select subcategory Source")
      .closest("div")!;
    const genresRow = screen
      .getByLabelText("Select subcategory Genres")
      .closest("div")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 100,
      width: 300,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(sourceRow, { dataTransfer });
    fireEvent.dragOver(genresRow, { dataTransfer, clientY: 5 });
    fireEvent.drop(genresRow, { dataTransfer, clientY: 5 });
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const categoryId = savedTaxonomy.categoryOrder[0];
    const genresFolder = Object.values(savedTaxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Genres",
    );
    const sourceFolder = Object.values(savedTaxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Source",
    );

    expect(savedTaxonomy.childrenByParentId?.[categoryId]).toEqual([
      sourceFolder?.id,
      genresFolder?.id,
    ]);
    expect(sourceFolder?.parentId).toBe(categoryId);
  });

  it("reorders top-level categories when dropped on a category row edge", async () => {
    const user = userEvent.setup();
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    const { onReplaceTaxonomy } = renderTagManager();

    const genreRow = screen.getByLabelText("Select category Genre").closest("div")!;
    const moodRow = screen.getByLabelText("Select category Mood").closest("div")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 100,
      width: 300,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(moodRow, { dataTransfer });
    fireEvent.dragOver(genreRow, { dataTransfer, clientY: 5 });
    fireEvent.drop(genreRow, { dataTransfer, clientY: 5 });
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    expect(savedTaxonomy.categoryOrder.map((categoryId) => savedTaxonomy.categoriesById[categoryId]?.name)).toEqual([
      "Mood",
      "Genre",
    ]);
  });

  it("reorders tags with native drag and drop", async () => {
    const user = userEvent.setup();
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    const { onReplaceTaxonomy } = renderTagManager();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 100,
      width: 300,
      height: 100,
      toJSON: () => ({}),
    });

    const technoChip = screen.getByText("Techno").closest('[draggable="true"]')!;
    const houseChip = screen.getByText("House").closest('[draggable="true"]')!;
    fireEvent.dragStart(technoChip, { dataTransfer });
    const dragOverEvent = createEvent.dragOver(houseChip, { dataTransfer });
    const dropEvent = createEvent.drop(houseChip, { dataTransfer });
    Object.defineProperty(dragOverEvent, "clientY", { value: 5 });
    Object.defineProperty(dropEvent, "clientY", { value: 5 });
    fireEvent(houseChip, dragOverEvent);
    fireEvent(houseChip, dropEvent);
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const electronicFolder = Object.values(savedTaxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Electronic",
    );
    expect(
      savedTaxonomy.childrenByParentId?.[electronicFolder!.id].map(
        (childId) => savedTaxonomy.tagsById[childId]?.name,
      ),
    ).toEqual(["Techno", "House"]);
  });

  it("filters the tree without losing the current selection", async () => {
    const user = userEvent.setup();
    renderTagManager();

    await user.click(await screen.findByLabelText("Select subcategory Percussion"));
    const searchInput = screen.getByPlaceholderText(
      "Search categories, folders, and tags…",
    );

    await user.type(searchInput, "House");

    expect(screen.queryByLabelText("Select subcategory Percussion")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Selected path")).toHaveTextContent("Genre/Percussion");
    expect(screen.getByText("Tribal")).toBeInTheDocument();
  });

  it("saves added tag changes", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy, onClose } = renderTagManager();

    await user.type(
      screen.getByPlaceholderText(/Add tag to Electronic/i),
      "Acid",
    );
    await user.click(screen.getByRole("button", { name: /Add Tag/i }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(onReplaceTaxonomy).toHaveBeenCalledTimes(1);
    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const electronicSubcategoryId = Object.values(savedTaxonomy.subcategoriesById).find(
      (subcategory) => subcategory.name === "Electronic",
    )?.id;

    expect(electronicSubcategoryId).toBeTruthy();
    expect(
      savedTaxonomy.subcategoriesById[electronicSubcategoryId!].tagIds.some(
        (tagId) => savedTaxonomy.tagsById[tagId]?.name === "Acid",
      ),
    ).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("saves accent changes for a tag", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();

    await user.click(await screen.findByLabelText("Add accent to tag House"));
    await user.click(screen.getByLabelText("Set Teal accent on tag House"));

    expect(screen.getByLabelText("Change accent for tag House")).toBeInTheDocument();
    expect(
      screen.getByText("House").closest('[data-accented="true"]'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const houseTagId = Object.values(savedTaxonomy.tagsById).find(
      (tag) => tag.name === "House",
    )?.id;

    expect(houseTagId).toBeTruthy();
    expect(savedTaxonomy.tagsById[houseTagId!].accentId).toBe("teal");
  });

  it("shows immutable defaults first and custom colors alphabetically in the picker", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomy();
    taxonomy.customAccentsById["custom:zebra"] = { id: "custom:zebra", name: "Zebra", color: "#111111" };
    taxonomy.customAccentsById["custom:apricot"] = { id: "custom:apricot", name: "Apricot", color: "#fed7aa" };
    taxonomy.ungroupedColorIds = ["custom:zebra", "custom:apricot"];

    renderTagManager({ taxonomy });
    await user.click(await screen.findByLabelText("Add accent to tag House"));

    expect(screen.getAllByRole("button", { name: /^Set .+ accent on tag House$/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Set Blue accent on tag House",
      "Set Teal accent on tag House",
      "Set Green accent on tag House",
      "Set Amber accent on tag House",
      "Set Rose accent on tag House",
      "Set Slate accent on tag House",
      "Set Apricot accent on tag House",
      "Set Zebra accent on tag House",
    ]);
  });

  it("groups custom picker colors by collection and keeps ungrouped colors separate", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomy();
    taxonomy.customAccentsById["custom:lilac"] = { id: "custom:lilac", name: "Lilac", color: "#c084fc", themeId: "theme:favorites" };
    taxonomy.customAccentsById["custom:apricot"] = { id: "custom:apricot", name: "Apricot", color: "#fed7aa", themeId: null };
    taxonomy.colorThemesById = { "theme:favorites": { id: "theme:favorites", name: "Favorites", colorIds: ["custom:lilac"] } };
    taxonomy.ungroupedColorIds = ["custom:apricot"];

    renderTagManager({ taxonomy });
    await user.click(await screen.findByLabelText("Add accent to tag House"));

    expect(within(screen.getByRole("group", { name: "Default colors" })).getByLabelText("Set Blue accent on tag House")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Favorites colors" })).getByLabelText("Set Lilac accent on tag House")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Ungrouped colors" })).getByLabelText("Set Apricot accent on tag House")).toBeInTheDocument();
  });

  it("uses custom color order in the picker and derives alternate sort orders without overwriting it", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomyWithFireCollection();
    taxonomy.customAccentsById["custom:flame"].name = "Apricot";
    taxonomy.customAccentsById["custom:zebra"] = { id: "custom:zebra", name: "Zebra", color: "#111111", themeId: "theme:fire" };
    taxonomy.colorThemesById["theme:fire"].colorIds.push("custom:zebra");

    const { onReplaceTaxonomy } = renderTagManager({ taxonomy });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.selectOptions(screen.getByLabelText("Sort colors and collections"), "custom");
    await user.click(screen.getByRole("button", { name: /Fire/ }));
    fireEvent.dragStart(screen.getByText("Zebra").closest('[draggable="true"]')!);
    fireEvent.drop(screen.getByText("Apricot").closest('[draggable="true"]')!);

    await user.click(screen.getByRole("tab", { name: "Tags" }));
    await user.click(await screen.findByLabelText("Change accent for tag House"));
    expect(within(screen.getByRole("group", { name: "Fire colors" })).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Set Zebra accent on tag House",
      "Set Apricot accent on tag House",
    ]);
    await user.click(screen.getByLabelText("Change accent for tag House"));

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.selectOptions(screen.getByLabelText("Sort colors and collections"), "alphabetical");
    await user.click(screen.getByRole("tab", { name: "Tags" }));
    await user.click(await screen.findByLabelText("Change accent for tag House"));
    expect(within(screen.getByRole("group", { name: "Fire colors" })).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Set Apricot accent on tag House",
      "Set Zebra accent on tag House",
    ]);

    await user.click(screen.getByRole("button", { name: /Save Changes/i }));
    expect((onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy).colorThemesById["theme:fire"].colorIds).toEqual([
      "custom:zebra",
      "custom:flame",
    ]);
  });

  it("hides default colors from the tag picker when the default palette is disabled", async () => {
    const user = userEvent.setup();
    const firstRender = renderTagManager({ taxonomy: createTaxonomyWithFireCollection() });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.click(screen.getByRole("switch", { name: "Show default palette" }));
    expect(localStorage.getItem("tagify:showDefaultColorPalette")).toBe("false");
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    firstRender.unmount();

    renderTagManager({ taxonomy: createTaxonomyWithFireCollection() });
    await user.click(await screen.findByLabelText("Change accent for tag House"));

    expect(screen.queryByRole("group", { name: "Default colors" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Fire colors" })).getByLabelText("Set Flame accent on tag House")).toBeInTheDocument();
  });

  it("keeps global color management in a dedicated Colors view", async () => {
    const user = userEvent.setup();
    renderTagManager();

    expect(screen.queryByRole("heading", { name: "Default palette" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Colors" }));

    expect(screen.getByRole("heading", { name: "Default palette" })).toBeInTheDocument();
    expect(screen.getByText("Built-in colors are always available and cannot be edited.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show default palette" })).toBeChecked();
    expect(screen.queryByText("My Colors")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Custom colors" })).toBeInTheDocument();
    expect(screen.queryByText("Default", { selector: "button" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Ungrouped/ }));
    expect(screen.queryByRole("heading", { name: "Default palette" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Show default palette" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /All Colors/ }));
    const defaultPaletteSection = screen.getByRole("heading", { name: "Default palette" }).closest("section")!;
    await user.click(screen.getByRole("switch", { name: "Show default palette" }));
    expect(screen.getByRole("heading", { name: "Default palette" })).toBeInTheDocument();
    expect(within(defaultPaletteSection).queryByText("Blue")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show default palette" })).not.toBeChecked();
  });

  it("keeps color exports usable and defers each download URL cleanup", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:tagify-colors-1")
      .mockReturnValueOnce("blob:tagify-colors-2");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      renderTagManager({ taxonomy: createTaxonomyWithFireCollection() });
      fireEvent.click(screen.getByRole("tab", { name: "Colors" }));
      fireEvent.click(screen.getByLabelText("More color actions"));

      const exportButton = screen.getByRole("button", { name: "Export Colors" });
      fireEvent.click(exportButton);
      fireEvent.click(exportButton);

      expect(createObjectURL).toHaveBeenCalledTimes(2);
      expect(anchorClick).toHaveBeenCalledTimes(2);
      expect(revokeObjectURL).not.toHaveBeenCalled();

      vi.runAllTimers();

      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
      expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:tagify-colors-1");
      expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:tagify-colors-2");
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("saves reusable custom colors without changing existing tag accents", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.click(screen.getByRole("button", { name: "+ Add Color" }));
    await user.type(screen.getByPlaceholderText("Name this color…"), "Lilac");
    const colorInput = screen.getByLabelText("Choose saved color") as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: "#c084fc" } });

    await user.click(screen.getByRole("button", { name: /Save Color/i }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const lilacAccent = Object.values(savedTaxonomy.customAccentsById).find(
      (accent) => accent.name === "Lilac",
    );

    expect(lilacAccent).toBeTruthy();
    expect(
      Object.values(savedTaxonomy.tagsById).every((tag) => tag.accentId == null),
    ).toBe(true);
  });

  it("identifies the exact custom or built-in color that conflicts", async () => {
    const user = userEvent.setup();
    renderTagManager({ taxonomy: createTaxonomyWithFireCollection() });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.click(screen.getByRole("button", { name: "+ Add Color" }));
    await user.type(screen.getByPlaceholderText("Name this color…"), "Ember");
    const colorInput = screen.getByLabelText("Choose saved color") as HTMLInputElement;

    fireEvent.change(colorInput, { target: { value: "#ff3300" } });
    await user.click(screen.getByRole("button", { name: /Save Color/i }));
    expect(screen.getByText('#FF3300 is already used by "Flame" in the "Fire" collection. Use "Flame" instead or choose a different color value.')).toBeInTheDocument();

    fireEvent.change(colorInput, { target: { value: "#5b8cff" } });
    await user.click(screen.getByRole("button", { name: /Save Color/i }));
    expect(screen.getByText('#5B8CFF is already the built-in "Blue" color. Use Blue instead or choose a different color value.')).toBeInTheDocument();
  });

  it("renames saved custom colors", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.click(screen.getByRole("button", { name: "+ Add Color" }));
    await user.type(screen.getByPlaceholderText("Name this color…"), "Lilac");
    const colorInput = screen.getByLabelText("Choose saved color") as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: "#c084fc" } });

    await user.click(screen.getByRole("button", { name: /Save Color/i }));
    await user.click(screen.getByRole("button", { name: /Edit saved color Lilac/i }));
    const editor = screen.getByLabelText("Edit Lilac");
    await user.clear(within(editor).getByLabelText("Name"));
    await user.type(within(editor).getByLabelText("Name"), "Sunburst");
    await user.click(within(editor).getByRole("button", { name: "Save Color" }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const renamedAccent = Object.values(savedTaxonomy.customAccentsById).find(
      (accent) => accent.name === "Sunburst",
    );

    expect(renamedAccent).toBeTruthy();
    expect(renamedAccent?.color).toBe("#c084fc");
  });

  it("keeps a color in its custom position when it is edited within the same collection", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomyWithFireCollection();
    taxonomy.customAccentsById["custom:ember"] = { id: "custom:ember", name: "Ember", color: "#f97316", themeId: "theme:fire" };
    taxonomy.colorThemesById["theme:fire"].colorIds.unshift("custom:ember");
    const { onReplaceTaxonomy } = renderTagManager({ taxonomy });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.selectOptions(screen.getByLabelText("Sort colors and collections"), "custom");
    await user.click(screen.getByRole("button", { name: /Fire/ }));
    await user.click(screen.getByRole("button", { name: "Edit saved color Ember" }));
    await user.click(within(screen.getByLabelText("Edit Ember")).getByRole("button", { name: "Save Color" }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect((onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy).colorThemesById["theme:fire"].colorIds).toEqual([
      "custom:ember",
      "custom:flame",
    ]);
  });

  it("deletes a custom color directly from its library row", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomy();
    taxonomy.customAccentsById["custom:lilac"] = { id: "custom:lilac", name: "Lilac", color: "#c084fc", themeId: null };
    taxonomy.ungroupedColorIds = ["custom:lilac"];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onReplaceTaxonomy } = renderTagManager({ taxonomy });

    await user.click(screen.getByRole("tab", { name: "Colors" }));

    expect(screen.getByRole("button", { name: "Delete saved color Lilac" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit Lilac")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete saved color Lilac" }));

    expect(confirmSpy).toHaveBeenCalledWith('Delete saved color "Lilac"?');
    expect(screen.queryByRole("button", { name: "Delete saved color Lilac" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    expect(savedTaxonomy.customAccentsById["custom:lilac"]).toBeUndefined();
    expect(savedTaxonomy.ungroupedColorIds).not.toContain("custom:lilac");
  });

  it("creates a collection and saves colors inside it", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();
    vi.spyOn(window, "prompt").mockReturnValue("Fire");

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.click(screen.getByRole("button", { name: "+ New Collection" }));
    expect(screen.getByRole("heading", { name: "Fire" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Add Color" }));
    await user.type(screen.getByPlaceholderText("Name this color…"), "Flame");
    fireEvent.change(screen.getByLabelText("Choose saved color"), { target: { value: "#ff3300" } });
    await user.click(screen.getByRole("button", { name: "Save Color" }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    const theme = Object.values(savedTaxonomy.colorThemesById).find((candidate) => candidate.name === "Fire");
    expect(theme).toBeTruthy();
    expect(savedTaxonomy.customAccentsById[theme!.colorIds[0]]).toMatchObject({ name: "Flame", color: "#ff3300", themeId: theme!.id });
  });

  it("moves a color into a collection with drag and drop without duplicating it", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomyWithFireCollection();
    taxonomy.customAccentsById["custom:sky"] = { id: "custom:sky", name: "Sky", color: "#38bdf8", themeId: null };
    taxonomy.ungroupedColorIds = ["custom:sky"];
    const { onReplaceTaxonomy } = renderTagManager({ taxonomy });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    const skyRow = screen.getByText("Sky").closest('[draggable="true"]')!;
    fireEvent.dragStart(skyRow);
    fireEvent.drop(screen.getByRole("button", { name: /Fire/ }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    expect(savedTaxonomy.colorThemesById["theme:fire"].colorIds).toEqual(["custom:flame", "custom:sky"]);
    expect(savedTaxonomy.ungroupedColorIds).not.toContain("custom:sky");
    expect(savedTaxonomy.customAccentsById["custom:sky"].themeId).toBe("theme:fire");
  });

  it("persists color and collection custom drag order", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomyWithFireCollection();
    taxonomy.customAccentsById["custom:ember"] = { id: "custom:ember", name: "Ember", color: "#f97316", themeId: "theme:fire" };
    taxonomy.colorThemesById["theme:fire"].colorIds.push("custom:ember");
    taxonomy.colorThemesById["theme:water"] = { id: "theme:water", name: "Water", colorIds: [] };
    taxonomy.colorThemeOrder = ["theme:fire", "theme:water"];
    const { onReplaceTaxonomy } = renderTagManager({ taxonomy });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.selectOptions(screen.getByLabelText("Sort colors and collections"), "custom");
    fireEvent.dragStart(screen.getByRole("button", { name: /Fire/ }));
    fireEvent.drop(screen.getByRole("button", { name: /Water/ }));
    await user.click(screen.getByRole("button", { name: /Fire/ }));
    fireEvent.dragStart(screen.getByText("Ember").closest('[draggable="true"]')!);
    fireEvent.drop(screen.getByText("Flame").closest('[draggable="true"]')!);
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    expect(savedTaxonomy.colorThemeOrder).toEqual(["theme:water", "theme:fire"]);
    expect(savedTaxonomy.colorThemesById["theme:fire"].colorIds).toEqual(["custom:ember", "custom:flame"]);
  });

  it("prevents same-collection color reordering outside custom sort mode", async () => {
    const user = userEvent.setup();
    const taxonomy = createTaxonomyWithFireCollection();
    taxonomy.customAccentsById["custom:ember"] = { id: "custom:ember", name: "Ember", color: "#f97316", themeId: "theme:fire" };
    taxonomy.colorThemesById["theme:fire"].colorIds.push("custom:ember");

    renderTagManager({ taxonomy });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.selectOptions(screen.getByLabelText("Sort colors and collections"), "alphabetical");
    await user.click(screen.getByRole("button", { name: /Fire/ }));

    const emberRow = screen.getByText("Ember").closest('[draggable="true"]')!;
    const flameRow = screen.getByText("Flame").closest('[draggable="true"]')!;
    fireEvent.dragStart(emberRow);
    fireEvent.drop(flameRow);

    expect(screen.getByRole("button", { name: /Save Changes/i })).toBeDisabled();
    expect(screen.getByText("No unsaved changes.")).toBeInTheDocument();
  });

  it("can delete a collection while moving its colors to Ungrouped", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager({ taxonomy: createTaxonomyWithFireCollection() });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.click(screen.getByRole("button", { name: /Fire/ }));
    await user.click(screen.getByRole("button", { name: "Delete collection Fire" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete Fire collection?" })).getByRole("button", { name: "Move Colors to Ungrouped" }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    expect(savedTaxonomy.colorThemesById["theme:fire"]).toBeUndefined();
    expect(savedTaxonomy.customAccentsById["custom:flame"]).toMatchObject({ themeId: null });
    expect(savedTaxonomy.ungroupedColorIds).toContain("custom:flame");
    expect(Object.values(savedTaxonomy.tagsById).find((tag) => tag.name === "House")?.accentId).toBe("custom:flame");
  });

  it("can delete a collection and all of its colors", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager({ taxonomy: createTaxonomyWithFireCollection() });

    await user.click(screen.getByRole("tab", { name: "Colors" }));
    await user.click(screen.getByRole("button", { name: /Fire/ }));
    await user.click(screen.getByRole("button", { name: "Delete collection Fire" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Delete Fire collection?" })).getByRole("button", { name: "Delete Collection and Colors" }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    const savedTaxonomy = onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy;
    expect(savedTaxonomy.colorThemesById["theme:fire"]).toBeUndefined();
    expect(savedTaxonomy.customAccentsById["custom:flame"]).toBeUndefined();
    expect(Object.values(savedTaxonomy.tagsById).find((tag) => tag.name === "House")?.accentId).toBeNull();
  });

  it("discards unsaved changes on cancel", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy, onClose } = renderTagManager();

    await user.type(
      screen.getByPlaceholderText(/Add tag to Electronic/i),
      "Acid",
    );
    await user.click(screen.getByRole("button", { name: /Add Tag/i }));
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(onReplaceTaxonomy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("discards unsaved accent changes on cancel", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy, onClose } = renderTagManager();

    await user.click(await screen.findByLabelText("Add accent to tag House"));
    await user.click(screen.getByLabelText("Set Rose accent on tag House"));
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(window.confirm).toHaveBeenCalled();
    expect(onReplaceTaxonomy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
