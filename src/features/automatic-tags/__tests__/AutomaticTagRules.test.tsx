import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import AutomaticTagRules from "../AutomaticTagRules";
import { readRules } from "../store";
vi.mock("../useAutomaticTags", () => ({ useRuleContext: () => context }));
vi.mock("../facts", () => ({ checkRuleDetails: vi.fn(), readRuleFacts: () => ({}) }));
const context = { facts: { one: { durationMs: 170000 }, two: { durationMs: 230000 } }, playlists: {} };
const data = { ...defaultTagData, tracks: { one: { name: "One", artists: "Artist", rating: 4, energy: 7, bpm: 120, tagIds: ["old"], dateModified: 123 }, two: { name: "Two", artists: "Artist", rating: 5, energy: 8, bpm: 125, tagIds: [], dateModified: 124 } }, taxonomy: { ...defaultTagData.taxonomy, categoryOrder: ["mood"], categoriesById: { mood: { id: "mood", name: "Mood", subcategoryIds: [], childIds: ["short", "long"] } }, childrenByParentId: { mood: ["short", "long"] }, tagsById: { short: { id: "short", name: "Short", subcategoryId: "mood", parentId: "mood" }, long: { id: "long", name: "Long", subcategoryId: "mood", parentId: "mood" } } } };
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); });
async function setup() {
  const apply = vi.fn().mockResolvedValue(undefined), undo = vi.fn().mockResolvedValue(undefined);
  const view = render(<AutomaticTagRules data={data} onApply={apply} onUndo={undo} />);
  fireEvent.click(screen.getByRole("button", { name: "Automatic tags" }));
  fireEvent.change(await screen.findByLabelText("Rule name"), { target: { value: "Short songs" } });
  fireEvent.click(within(screen.getByRole("group", { name: "Add these tags" })).getByRole("checkbox", { name: "Short Mood" }));
  return { apply, undo, view };
}
it("shows a concrete preview, preserves annotations, and enables automation only after Apply", async () => {
  const { apply } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Save & preview" }));
  const preview = await screen.findByLabelText("Automatic tag preview");
  expect(apply).not.toHaveBeenCalled(); expect(readRules()[0].enabled).toBe(false);
  expect(within(preview).getByText(/One/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Keep applying automatically as details load" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply to 1 song" }));
  await waitFor(() => expect(readRules()[0].enabled).toBe(true));
  expect(apply).toHaveBeenCalledWith([{ trackUri: "one", toAdd: ["short"], toRemove: [], automaticRuleIds: [readRules()[0].id] }]);
  expect(data.tracks.one.dateModified).toBe(123);
  expect(screen.getByRole("status")).toHaveTextContent("1 song updated");
});
it("rejects an invalid time range without saving a rule or changing songs", async () => {
  const { apply } = await setup();
  fireEvent.change(screen.getByLabelText("Maximum length"), { target: { value: "3:99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & preview" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Check the rule"));
  expect(readRules()).toEqual([]); expect(apply).not.toHaveBeenCalled();
});
it("previews Otherwise only for known songs within the selected music", async () => {
  const { apply } = await setup();
  fireEvent.click(screen.getByText("Otherwise add different tags (optional)"));
  const otherwise = screen.getByRole("group", { name: "Otherwise add" });
  fireEvent.click(within(otherwise).getByRole("checkbox", { name: "Long Mood" }));
  fireEvent.click(screen.getByRole("button", { name: "Save & preview" }));
  await screen.findByLabelText("Automatic tag preview");
  fireEvent.click(screen.getByRole("button", { name: "Apply to 2 songs" }));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0][0].map((update: { trackUri: string; toAdd: string[] }) => [update.trackUri, update.toAdd])).toEqual([["one", ["short"]], ["two", ["long"]]]);
});
it("refuses a stale preview if song annotations changed before Apply", async () => {
  const { apply, undo, view } = await setup();
  fireEvent.click(screen.getByRole("button", { name: "Save & preview" }));
  await screen.findByLabelText("Automatic tag preview");
  view.rerender(<AutomaticTagRules data={{ ...data, tracks: { ...data.tracks, one: { ...data.tracks.one, tagIds: ["short"] } } }} onApply={apply} onUndo={undo} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply to 1 song" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preview again"));
  expect(apply).not.toHaveBeenCalled();
});
