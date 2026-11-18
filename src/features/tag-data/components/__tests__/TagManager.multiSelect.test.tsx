import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TagManager from "../TagManager";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import { TagTaxonomy } from "@/types/tagData";
import { resetCommunityPopularTags } from "@/features/tag-data/utils/communityPopularTags";

vi.mock("@/services/sync/SyncLocalState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sync/SyncLocalState")>()),
  getDesktopSyncConfiguration: () => null,
}));
vi.mock("@/services/sync/SyncRuntime", () => ({ syncRuntime: { communityRequest: vi.fn() } }));

function createTaxonomy(): TagTaxonomy {
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
            { id: "trance", name: "Trance" },
            { id: "ambient", name: "Ambient" },
          ],
        },
        {
          id: "percussion",
          name: "Percussion",
          tags: [{ id: "tribal", name: "Tribal" }, { id: "house-2", name: "House" }],
        },
      ],
    },
    {
      id: "mood",
      name: "Mood",
      subcategories: [{ id: "energy", name: "Energy", tags: [{ id: "peak", name: "Peak" }] }],
    },
  ]);
}

function renderTagManager() {
  const onReplaceTaxonomy = vi.fn();
  render(
    <TagManager
      taxonomy={createTaxonomy()}
      tracks={{}}
      playlists={{}}
      artists={{}}
      activeTagFilters={[]}
      excludedTagFilters={[]}
      smartPlaylists={[]}
      onClose={vi.fn()}
      onReplaceTaxonomy={onReplaceTaxonomy}
    />,
  );
  return { onReplaceTaxonomy };
}

const chip = (name: string) =>
  screen.getAllByText(name).map((element) => element.closest('[draggable="true"]')).find(Boolean) as HTMLElement;
const folderButton = (name: string) => screen.getByLabelText(`Select subcategory ${name}`);
const ctrlClick = (element: Element) => fireEvent.click(element, { ctrlKey: true });
const tagByName = (taxonomy: TagTaxonomy, name: string, parentName?: string) =>
  Object.values(taxonomy.tagsById).find(
    (tag) =>
      tag.name === name &&
      (!parentName || taxonomy.subcategoriesById[tag.parentId || tag.subcategoryId]?.name === parentName),
  )!;
const folderByName = (taxonomy: TagTaxonomy, name: string) =>
  Object.values(taxonomy.subcategoriesById).find((folder) => folder.name === name)!;
const categoryByName = (taxonomy: TagTaxonomy, name: string) =>
  Object.values(taxonomy.categoriesById).find((category) => category.name === name)!;
const tagNamesIn = (taxonomy: TagTaxonomy, parentId: string) =>
  (taxonomy.childrenByParentId?.[parentId] ?? [])
    .filter((id) => taxonomy.tagsById[id])
    .map((id) => taxonomy.tagsById[id].name);

async function openElectronic(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText("Select subcategory Electronic"));
}

async function save(user: ReturnType<typeof userEvent.setup>, onReplaceTaxonomy: ReturnType<typeof vi.fn>) {
  await user.click(screen.getByRole("button", { name: /Save Changes/i }));
  return onReplaceTaxonomy.mock.calls[0] as [TagTaxonomy, string[], TagTaxonomy];
}

describe("TagManager multi-select", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    resetCommunityPopularTags();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
  });

  it("selects tags with Ctrl+Click and Shift+Click, and clears with Esc or a plain click", async () => {
    const user = userEvent.setup();
    renderTagManager();
    await openElectronic(user);

    expect(screen.getByText(/Click or Shift\+Click to select several tags or folders/)).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    ctrlClick(chip("House"));
    ctrlClick(chip("Trance"));
    expect(screen.getByRole("toolbar", { name: "Actions for 2 tags selected" })).toBeInTheDocument();
    expect(chip("House")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Techno")).toHaveAttribute("aria-pressed", "false");

    // Shift+Click selects from the last Ctrl+Clicked tag (Trance) to Ambient.
    fireEvent.click(chip("Ambient"), { shiftKey: true });
    expect(screen.getByText("2 tags selected")).toBeInTheDocument();
    expect(chip("House")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Trance")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip("House"), { shiftKey: true });
    expect(screen.getByText("3 tags selected")).toBeInTheDocument();
    expect(chip("Ambient")).toHaveAttribute("aria-pressed", "false");

    // Esc typed in a text field belongs to that field.
    fireEvent.keyDown(screen.getAllByRole("textbox")[0], { key: "Escape" });
    expect(screen.getByText("3 tags selected")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    ctrlClick(chip("House"));
    fireEvent.click(chip("Techno"));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("colors several tags at once", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();
    await openElectronic(user);

    ctrlClick(chip("House"));
    ctrlClick(chip("Techno"));
    ctrlClick(chip("Ambient"));
    await user.click(screen.getByRole("button", { name: "Color" }));
    await user.click(screen.getByLabelText("Set Teal accent on 3 tags selected"));

    expect(screen.getByText("3 tags selected")).toBeInTheDocument();
    const [saved] = await save(user, onReplaceTaxonomy);
    expect(tagByName(saved, "House", "Electronic").accentId).toBe("teal");
    expect(tagByName(saved, "Techno").accentId).toBe("teal");
    expect(tagByName(saved, "Ambient").accentId).toBe("teal");
    expect(tagByName(saved, "Trance").accentId ?? null).toBeNull();
  });

  it("moves selected tags to a folder with Move to…, and says when one couldn't go", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();
    await openElectronic(user);

    ctrlClick(chip("House"));
    ctrlClick(chip("Techno"));
    ctrlClick(chip("Trance"));
    await user.click(screen.getByRole("button", { name: "Move to…" }));
    const menu = screen.getByRole("dialog", { name: "Move 3 tags to" });
    expect(within(menu).getByRole("button", { name: /Electronic/ })).toBeDisabled();
    await user.click(within(menu).getByRole("button", { name: "Percussion" }));

    expect(
      screen.getByText(
        "Moved 2 tags to Percussion. 1 tag stayed where it was because Percussion already has something with the same name.",
      ),
    ).toBeInTheDocument();
    // Tag Manager follows the tags to their new folder and keeps them selected.
    expect(screen.getByLabelText("Selected path")).toHaveTextContent("Genre/Percussion");
    expect(screen.getByText("2 tags selected")).toBeInTheDocument();

    const [saved] = await save(user, onReplaceTaxonomy);
    expect(tagNamesIn(saved, folderByName(saved, "Percussion").id)).toEqual(["Tribal", "House", "Techno", "Trance"]);
    expect(tagNamesIn(saved, folderByName(saved, "Electronic").id)).toEqual(["House", "Ambient"]);
  });

  it("deletes selected tags after one confirmation", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();
    await openElectronic(user);

    ctrlClick(chip("Techno"));
    ctrlClick(chip("Ambient"));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toMatch(/^Delete 2 tags\?/);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    const [saved, removedTagIds] = await save(user, onReplaceTaxonomy);
    expect(tagNamesIn(saved, folderByName(saved, "Electronic").id)).toEqual(["House", "Trance"]);
    expect(removedTagIds).toHaveLength(2);
  });

  it("keeps the tags when deletion isn't confirmed", async () => {
    const user = userEvent.setup();
    renderTagManager();
    await openElectronic(user);
    vi.mocked(window.confirm).mockReturnValue(false);

    ctrlClick(chip("Techno"));
    ctrlClick(chip("Ambient"));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(chip("Techno")).toBeInTheDocument();
    expect(screen.getByText("2 tags selected")).toBeInTheDocument();
  });

  it("selects folders and moves them together", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();
    await screen.findByLabelText("Select subcategory Electronic");

    ctrlClick(folderButton("Electronic"));
    ctrlClick(folderButton("Percussion"));
    expect(screen.getByText("2 folders selected")).toBeInTheDocument();
    expect(folderButton("Electronic")).toHaveAttribute("aria-pressed", "true");
    // Folders can be moved but don't have colors.
    expect(screen.queryByRole("button", { name: "Color" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move to…" }));
    const menu = screen.getByRole("dialog", { name: "Move 2 folders to" });
    expect(within(menu).queryByRole("button", { name: "Electronic" })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("button", { name: "Mood" }));

    const [saved] = await save(user, onReplaceTaxonomy);
    const mood = categoryByName(saved, "Mood");
    expect(saved.childrenByParentId?.[mood.id].map((id) => saved.subcategoriesById[id].name)).toEqual([
      "Energy",
      "Electronic",
      "Percussion",
    ]);
    expect(saved.childrenByParentId?.[categoryByName(saved, "Genre").id]).toEqual([]);
  });

  it("drags a group of selected tags onto a folder", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();
    await openElectronic(user);
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: vi.fn(), setDragImage: vi.fn() };

    await user.click(screen.getByLabelText("Expand Mood"));
    ctrlClick(chip("Techno"));
    ctrlClick(chip("Ambient"));
    const energyRow = folderButton("Energy").closest("div")!;
    fireEvent.dragStart(chip("Ambient"), { dataTransfer });
    expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
    fireEvent(energyRow, createEvent.dragOver(energyRow, { dataTransfer }));
    fireEvent(energyRow, createEvent.drop(energyRow, { dataTransfer }));

    expect(screen.getByLabelText("Selected path")).toHaveTextContent("Mood/Energy");
    const [saved] = await save(user, onReplaceTaxonomy);
    expect(tagNamesIn(saved, folderByName(saved, "Energy").id)).toEqual(["Peak", "Techno", "Ambient"]);
  });

  it("still drags a single unselected tag on its own", async () => {
    const user = userEvent.setup();
    const { onReplaceTaxonomy } = renderTagManager();
    await openElectronic(user);
    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: vi.fn(), setDragImage: vi.fn() };

    await user.click(screen.getByLabelText("Expand Mood"));
    ctrlClick(chip("Techno"));
    ctrlClick(chip("Ambient"));
    const energyRow = folderButton("Energy").closest("div")!;
    fireEvent.dragStart(chip("Trance"), { dataTransfer });
    fireEvent(energyRow, createEvent.dragOver(energyRow, { dataTransfer }));
    fireEvent(energyRow, createEvent.drop(energyRow, { dataTransfer }));

    expect(dataTransfer.setDragImage).not.toHaveBeenCalled();
    const [saved] = await save(user, onReplaceTaxonomy);
    expect(tagNamesIn(saved, folderByName(saved, "Energy").id)).toEqual(["Peak", "Trance"]);
  });
});
