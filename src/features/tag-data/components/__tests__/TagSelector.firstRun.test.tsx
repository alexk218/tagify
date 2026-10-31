import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TagSelector from "../TagSelector";
import { defaultTagData } from "@/constants/defaultTagData";
import { buildCategoryTree } from "@/utils/tagTaxonomy";

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
