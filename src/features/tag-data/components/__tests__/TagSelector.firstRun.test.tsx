import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TagSelector from "../TagSelector";
import { defaultTagData } from "@/constants/defaultTagData";
import { buildCategoryTree } from "@/utils/tagTaxonomy";
import { planTastePacksForTaxonomy } from "@/utils/tastePackTaxonomy";

const categories = buildCategoryTree(defaultTagData.taxonomy);
const props = { categories, customAccentsById: {}, onToggleTag: vi.fn(), onOpenTagManager: vi.fn(), isMultiTagging: false, isLockedTrack: false };
beforeEach(() => { localStorage.clear(); });

it("opens every tag group for a library with no tags yet", async () => {
  render(<TagSelector {...props} expandForFirstRun />);
  expect(await screen.findByRole("button", { name: "Rock" })).toBeVisible();
  expect(JSON.parse(localStorage.getItem("tagify:expandedCategories") || "[]")).toHaveLength(categories.length);
});

it("keeps the groups a person already chose to open or close", () => {
  localStorage.setItem("tagify:expandedCategories", "[]");
  render(<TagSelector {...props} expandForFirstRun />);
  expect(screen.queryByRole("button", { name: "Rock" })).toBeNull();
  expect(localStorage.getItem("tagify:expandedCategories")).toBe("[]");
});

it("leaves groups collapsed once a library has tags", () => {
  render(<TagSelector {...props} />);
  expect(screen.queryByRole("button", { name: "Rock" })).toBeNull();
});

const withMetal = buildCategoryTree(planTastePacksForTaxonomy(defaultTagData.taxonomy, ["metal"]).taxonomy);

it("opens taste packs added while a new library's picker is open, keeping what the person closed", async () => {
  const { rerender } = render(<TagSelector {...props} expandForFirstRun />);
  expect(await screen.findByRole("button", { name: "Rock" })).toBeVisible();
  // The person closes Era & Decade, then adds a pack.
  fireEvent.click(screen.getByText("Era & Decade"));
  expect(screen.queryByRole("button", { name: "2010s" })).toBeNull();

  rerender(<TagSelector {...props} categories={withMetal} expandForFirstRun />);

  expect(await screen.findByRole("button", { name: "Nu Metal" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "2010s" })).toBeNull();
});

it("opens taste packs added with every group closed, and only them", async () => {
  localStorage.setItem("tagify:expandedCategories", "[]");
  const { rerender } = render(<TagSelector {...props} expandForFirstRun />);
  rerender(<TagSelector {...props} categories={withMetal} expandForFirstRun />);
  expect(await screen.findByRole("button", { name: "Nu Metal" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Rock" })).toBeNull();
});

it("opens taste packs added while the picker was hidden", async () => {
  // The picker showed once and the person closed every group; then no song was on while they added a pack.
  localStorage.setItem("tagify:expandedCategories", "[]");
  render(<TagSelector {...props} expandForFirstRun />).unmount();

  render(<TagSelector {...props} categories={withMetal} expandForFirstRun />);
  expect(await screen.findByRole("button", { name: "Nu Metal" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Rock" })).toBeNull();
});

it("opens everything, packs added beforehand included, and keeps a pack folder the person closed when the picker comes back", async () => {
  const { unmount } = render(<TagSelector {...props} categories={withMetal} expandForFirstRun />);
  expect(await screen.findByRole("button", { name: "Nu Metal" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Rock" })).toBeVisible();
  fireEvent.click(screen.getByText("Metal & Heavy"));
  expect(screen.queryByRole("button", { name: "Nu Metal" })).toBeNull();
  unmount();

  render(<TagSelector {...props} categories={withMetal} expandForFirstRun />);
  expect(await screen.findByRole("button", { name: "Rock" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Nu Metal" })).toBeNull();
});

it("leaves pack folders as they are in a library that has tags", () => {
  const { rerender } = render(<TagSelector {...props} />);
  rerender(<TagSelector {...props} categories={withMetal} />);
  expect(screen.queryByRole("button", { name: "Nu Metal" })).toBeNull();
});
