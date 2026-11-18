import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import TagSelector from "../TagSelector";
import type { TagCategory } from "@/types/tagData";

const categories: TagCategory[] = [{
  id: "mood",
  name: "Mood",
  subcategories: [],
  tags: [
    { id: "calm", name: "Calm", accentId: null },
    { id: "dark", name: "Dark", accentId: null },
    { id: "warm", name: "Warm", accentId: null },
  ],
}];
const props = { categories, customAccentsById: {}, onToggleTag: vi.fn(), onOpenTagManager: vi.fn(), isMultiTagging: false, isLockedTrack: false };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("tagify:expandedCategories", JSON.stringify(["mood"]));
});

const shownTags = () => within(screen.getByText("Mood").closest("div")!.parentElement!)
  .getAllByRole("button")
  .map((button) => button.textContent?.trim())
  .filter((name) => ["Calm", "Dark", "Warm"].includes(name ?? ""));

it("lists the most used tags first and keeps them still while tagging the same song", () => {
  let uses = new Map([["warm", 3], ["dark", 1]]);
  const { rerender } = render(<TagSelector {...props} getTagUses={() => uses} usageTarget="spotify:track:1" />);
  expect(shownTags()).toEqual(["Calm", "Dark", "Warm"]);

  fireEvent.change(screen.getByRole("combobox", { name: "Tag sort order" }), { target: { value: "most-used" } });
  expect(shownTags()).toEqual(["Warm", "Dark", "Calm"]);

  // Tagging this song with Calm a few times over doesn't move it under the pointer.
  uses = new Map([["calm", 9], ["warm", 3], ["dark", 1]]);
  rerender(<TagSelector {...props} getTagUses={() => uses} usageTarget="spotify:track:1" />);
  expect(shownTags()).toEqual(["Warm", "Dark", "Calm"]);

  // The next song is listed with the new counts.
  rerender(<TagSelector {...props} getTagUses={() => uses} usageTarget="spotify:track:2" />);
  expect(shownTags()).toEqual(["Calm", "Warm", "Dark"]);
});
