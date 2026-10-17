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

const popular = [
  { name: "male vocalist", slug: "male-vocalist", people: 12 },
  { name: "male vocals duet", slug: "male-vocals-duet", people: 3 },
  { name: "lo-fi", slug: "lo-fi", people: 40 },
  { name: "lo-fi beats", slug: "lo-fi-beats", people: 9 },
  { name: "lo-fi jazz", slug: "lo-fi-jazz", people: 8 },
  { name: "lo-fi hip hop", slug: "lo-fi-hip-hop", people: 7 },
  { name: "lo-fi house", slug: "lo-fi-house", people: 6 },
  { name: "deep house", slug: "deep-house", people: 20 },
];
const withMine = [{ id: "genre", name: "Genre", subcategories: [], tags: [{ id: "house", name: "House" }, { id: "deep", name: "Deep house" }, { id: "lofi", name: "Lo Fi" }] }];

describe("names other members use", () => {
  it("offers up to three names you don't have yet, and creates your own tag from one", async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: "new", name: "lo-fi beats" });
    const { view, onApply } = setup({ getPopularTags: () => popular, onCreate });
    fireEvent.input(view.getByRole("searchbox"), { target: { value: "lo-fi " } });
    const group = view.getByRole("group", { name: "Used by other members" });
    expect(within(group).getAllByRole("button").map((row) => row.getAttribute("aria-label"))).toEqual([
      "lo-fi beats, 9 members",
      "lo-fi jazz, 8 members",
      "lo-fi hip hop, 7 members",
    ]);
    fireEvent.click(within(group).getByRole("button", { name: "lo-fi beats, 9 members" }));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith("new", "lo-fi beats"));
    expect(onCreate).toHaveBeenCalledWith("lo-fi beats", "genre");
  });

  it("uses your own spelling of the same tag instead of offering to create another", async () => {
    const { view, onApply, onCreate } = setup({ categories: withMine, getPopularTags: () => popular });
    const input = view.getByRole("searchbox");
    fireEvent.input(input, { target: { value: "lofi" } });
    expect(view.getAllByRole("button")[0]).toHaveTextContent("Lo Fi");
    expect(view.queryByRole("button", { name: /Create and apply/ })).toBeNull();
    expect(view.queryByRole("button", { name: "Use this name" })).toBeNull();
    // "lo-fi" itself is yours already; only names you don't have are offered.
    expect(within(view.getByRole("group", { name: "Used by other members" })).getAllByRole("button")[0]).toHaveAccessibleName("lo-fi beats, 9 members");
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith("lofi", "Lo Fi"));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("points out the usual name before you create a near-duplicate, without blocking your own", async () => {
    const onCreate = vi.fn(async (name) => ({ id: name, name }));
    const { view, onApply } = setup({ getPopularTags: () => popular, onCreate });
    fireEvent.input(view.getByRole("searchbox"), { target: { value: "male vocals" } });
    const hint = "Members usually call this “male vocalist” (12)";
    const create = view.getByRole("button", { name: "Create and apply “male vocals”" });
    expect(create).toHaveAccessibleDescription(hint);
    expect(create).toBeEnabled();
    expect(view.getByRole("button", { name: "Use this name" })).toHaveAccessibleDescription(hint);
    // Screen readers hear the hint once while typing, from a polite live region.
    expect(view.getAllByText(hint).some((element) => element.getAttribute("aria-live") === "polite")).toBe(true);
    // The hinted name isn't repeated in the list.
    expect(within(view.getByRole("group", { name: "Used by other members" })).getAllByRole("button").map((row) => row.getAttribute("aria-label"))).toEqual(["male vocals duet, 3 members"]);

    fireEvent.click(view.getByRole("button", { name: "Use this name" }));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith("male vocalist", "male vocalist"));
    expect(onCreate).toHaveBeenCalledWith("male vocalist", "genre");

    fireEvent.input(view.getByRole("searchbox"), { target: { value: "male vocals" } });
    fireEvent.click(view.getByRole("button", { name: "Create and apply “male vocals”" }));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith("male vocals", "male vocals"));
  });

  it("applies your existing tag when it is the usual name", async () => {
    const categoriesWithVocalist = [{ ...categories[0], tags: [...categories[0].tags, { id: "vocalist", name: "Male Vocalist" }] }];
    const { view, onApply, onCreate } = setup({ categories: categoriesWithVocalist, getPopularTags: () => popular });
    fireEvent.input(view.getByRole("searchbox"), { target: { value: "male vocals" } });
    fireEvent.click(view.getByRole("button", { name: "Use this name" }));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledWith("vocalist", "Male Vocalist"));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows nothing extra while the list of names isn't available", () => {
    const { view } = setup({ getPopularTags: () => [] });
    fireEvent.input(view.getByRole("searchbox"), { target: { value: "male vocals" } });
    expect(view.queryByRole("group")).toBeNull();
    expect(view.queryByText(/Members usually call this/)).toBeNull();
    expect(view.queryByRole("button", { name: "Use this name" })).toBeNull();
    expect(view.getByRole("button", { name: "Create and apply “male vocals”" })).toBeEnabled();
  });
});

