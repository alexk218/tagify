import { describe, expect, it, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { createQuickTagSearch } from "../inlineEditor.quickTags";
const categories = [{ id: "genre", name: "Genre", subcategories: [], tags: [{ id: "house", name: "House" }, { id: "deep", name: "Deep house" }] }];
function setup(overrides = {}) {
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onCreate = vi.fn().mockResolvedValue({ id: "new", name: "Ambient" });
  const element = createQuickTagSearch({ categories, onApply, onCreate, ...overrides });
  document.body.append(element);
  return { view: within(element), onApply, onCreate };
}
describe("quick popup tagging", () => {
  it("applies a unique exact match but leaves ambiguous partial results alone", async () => {
    const { view, onApply } = setup();
    const input = view.getByRole("searchbox");
    fireEvent.input(input, { target: { value: "ho" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.input(input, { target: { value: "house" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith("house", "House"));
  });
  it("creates in the selected category and applies the new ID", async () => {
    const { view, onApply, onCreate } = setup();
    fireEvent.input(view.getByRole("searchbox"), { target: { value: "Ambient" } });
    fireEvent.click(view.getByRole("button", { name: "Create and apply “Ambient”" }));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith("new", "Ambient"));
    expect(onCreate).toHaveBeenCalledWith("Ambient", "genre");
    expect(view.getByRole("searchbox")).toHaveValue("");
  });
  it("finds a newly created category-level tag again without reopening the popup", async () => {
    let current = categories;
    const onCreate = vi.fn(async () => {
      current = [{ ...categories[0], tags: [...categories[0].tags, { id: "ambient", name: "Ambient" }] }];
      return { id: "ambient", name: "Ambient" };
    });
    const { view, onApply } = setup({ onCreate, getCategories: () => current });
    const input = view.getByRole("searchbox");
    fireEvent.input(input, { target: { value: "Ambient" } });
    fireEvent.click(view.getByRole("button", { name: "Create and apply “Ambient”" }));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith("ambient", "Ambient"));
    await vi.waitFor(() => expect(input).toBeEnabled());
    fireEvent.input(input, { target: { value: "Ambient" } });
    expect(view.getByRole("button", { name: "Ambient", exact: true })).toBeVisible();
    expect(view.queryByRole("button", { name: "Create and apply “Ambient”" })).toBeNull();
  });
  it("retains a failed creation for retry and never applies an unsaved ID", async () => {
    const { view, onApply } = setup({ onCreate: vi.fn().mockRejectedValue(new Error("Try again")) });
    fireEvent.input(view.getByRole("searchbox"), { target: { value: "Ambient" } });
    fireEvent.click(view.getByRole("button", { name: "Create and apply “Ambient”" }));
    await vi.waitFor(() => expect(view.getByRole("status")).toHaveTextContent("Try again"));
    expect(onApply).not.toHaveBeenCalled();
    expect(view.getByRole("searchbox")).toHaveValue("Ambient");
  });
});
