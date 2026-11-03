import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { findTastePack, TASTE_PACK_HOME } from "@tagify/community-contracts";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagTaxonomy } from "@/types/tagData";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import { planTastePacksForTaxonomy } from "@/utils/tastePackTaxonomy";
import TagManager from "../TagManager";

const { getTaxonomy, recordTastePacksAdded } = vi.hoisted(() => ({ getTaxonomy: vi.fn(), recordTastePacksAdded: vi.fn() }));
vi.mock("@/services/sync/SyncLocalState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sync/SyncLocalState")>()),
  getDesktopSyncConfiguration: () => null,
  flushLocalPersistence: () => Promise.resolve(),
}));
vi.mock("@/services/storage/IndexedDBStorageService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/storage/IndexedDBStorageService")>();
  return { ...actual, indexedDBStorage: new Proxy(actual.indexedDBStorage, { get: (target, key) => (key === "getTaxonomy" ? getTaxonomy : Reflect.get(target, key)) }) };
});
vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordTastePacksAdded,
}));
vi.mock("@/services/sync/SyncRuntime", () => ({ syncRuntime: { communityRequest: vi.fn() } }));

const metal = findTastePack("metal")!;

function renderTagManager(taxonomy: TagTaxonomy = defaultTagData.taxonomy) {
  const onReplaceTaxonomy = vi.fn();
  render(
    <TagManager
      taxonomy={taxonomy}
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

/** Opens the pack chooser from wherever this variation puts "Add a pack". */
async function openPacks() {
  const expand = screen.queryByRole("button", { name: "Expand Genre & Style" });
  if (expand) await userEvent.click(expand);
  await userEvent.click(screen.getByRole("button", { name: "+ Add a Pack" }));
  return screen.getByRole("group", { name: "Add a pack" });
}

it("offers packs under + Add Category when Genre & Style has been removed", async () => {
  const { onReplaceTaxonomy } = renderTagManager(createEmptyTaxonomy());
  const packs = await openPacks();

  await userEvent.click(within(packs).getByRole("button", { name: "Pop" }));
  await userEvent.click(within(packs).getByRole("button", { name: "Add 1 pack" }));
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  expect((onReplaceTaxonomy.mock.calls[0][0] as TagTaxonomy).categoryOrder).toEqual([TASTE_PACK_HOME.id]);
});

it("adds a pack to the unsaved tags, shows its folder, and saves it with Save Changes", async () => {
  const { onReplaceTaxonomy } = renderTagManager();
  const packs = await openPacks();

  await userEvent.click(within(packs).getByRole("button", { name: "Metal & Heavy" }));
  await userEvent.click(within(packs).getByRole("button", { name: "Add 1 pack" }));

  expect(screen.getByText("Added 11 tags for Metal & Heavy to Genre & Style. Save Changes to keep them.")).toBeInTheDocument();
  expect(screen.getByLabelText("Selected path")).toHaveTextContent("Genre & Style/Metal & Heavy");
  expect(screen.getByText("Doom Metal")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  const [saved, removed] = onReplaceTaxonomy.mock.calls[0] as [TagTaxonomy, string[]];
  expect(saved.subcategoriesById[metal.folderId]).toMatchObject({ name: "Metal & Heavy", parentId: TASTE_PACK_HOME.id });
  expect(removed).toEqual([]);
});

it("shows packs already in the tags as added, so adding twice changes nothing", async () => {
  renderTagManager(planTastePacksForTaxonomy(defaultTagData.taxonomy, ["metal"]).taxonomy);
  const packs = await openPacks();

  expect(within(packs).getByRole("button", { name: "Metal & Heavy Added" })).toBeDisabled();
  expect(within(packs).getByRole("button", { name: "Rock & Punk" })).toBeEnabled();
  expect(screen.getByText("No unsaved changes.")).toBeInTheDocument();
});

it("closes without changing anything", async () => {
  renderTagManager();
  const packs = await openPacks();
  await userEvent.click(within(packs).getByRole("button", { name: "Done" }));

  expect(screen.queryByRole("group", { name: "Add a pack" })).toBeNull();
  expect(screen.getByText("No unsaved changes.")).toBeInTheDocument();
});

it("counts the packs added once Save Changes has saved them", async () => {
  recordTastePacksAdded.mockClear();
  const { onReplaceTaxonomy } = renderTagManager();
  // The saved tags are what Save Changes handed over.
  onReplaceTaxonomy.mockImplementation((saved: TagTaxonomy) => getTaxonomy.mockResolvedValue(saved));
  const packs = await openPacks();
  await userEvent.click(within(packs).getByRole("button", { name: "Metal & Heavy" }));
  await userEvent.click(within(packs).getByRole("button", { name: "Add 1 pack" }));
  expect(recordTastePacksAdded).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => expect(recordTastePacksAdded).toHaveBeenCalledWith(["metal"], "tag_manager"));
});

it("counts nothing when saving the packs fails", async () => {
  recordTastePacksAdded.mockClear();
  getTaxonomy.mockResolvedValue(defaultTagData.taxonomy);
  renderTagManager();
  const packs = await openPacks();
  await userEvent.click(within(packs).getByRole("button", { name: "Metal & Heavy" }));
  await userEvent.click(within(packs).getByRole("button", { name: "Add 1 pack" }));

  await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => expect(getTaxonomy).toHaveBeenCalled());
  expect(recordTastePacksAdded).not.toHaveBeenCalled();
});

it("counts nothing when the packs are cancelled", async () => {
  recordTastePacksAdded.mockClear();
  getTaxonomy.mockClear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderTagManager();
  const packs = await openPacks();
  await userEvent.click(within(packs).getByRole("button", { name: "Metal & Heavy" }));
  await userEvent.click(within(packs).getByRole("button", { name: "Add 1 pack" }));

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(getTaxonomy).not.toHaveBeenCalled();
  expect(recordTastePacksAdded).not.toHaveBeenCalled();
});
