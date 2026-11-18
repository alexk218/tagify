// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getNextSelection, orderSelectedIds } from "../tagManager.selection";

const order = ["a", "b", "c", "d", "e"];
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };

describe("getNextSelection", () => {
  it("adds and removes items with Ctrl/Cmd+Click", () => {
    let selection = getNextSelection(null, "tags", order, "b", toggle);
    selection = getNextSelection(selection, "tags", order, "d", toggle);
    expect(selection).toEqual({ kind: "tags", ids: ["b", "d"], anchorId: "d" });

    selection = getNextSelection(selection, "tags", order, "b", toggle);
    expect(selection?.ids).toEqual(["d"]);
    expect(getNextSelection(selection, "tags", order, "d", toggle)).toBeNull();
  });

  it("selects a range from the anchor with Shift+Click, in either direction", () => {
    const start = getNextSelection(null, "tags", order, "d", toggle);
    expect(getNextSelection(start, "tags", order, "b", range)?.ids).toEqual(["b", "c", "d"]);

    const extended = getNextSelection(
      { kind: "tags", ids: ["a", "d"], anchorId: "d" },
      "tags",
      order,
      "e",
      { toggle: true, range: true },
    );
    expect(extended?.ids).toEqual(["a", "d", "e"]);
  });

  it("starts a range at the clicked item when nothing is selected yet", () => {
    const selection = getNextSelection(null, "folders", order, "c", range);
    expect(selection).toEqual({ kind: "folders", ids: ["c"], anchorId: "c" });
    expect(getNextSelection(selection, "folders", order, "a", range)?.ids).toEqual(["a", "b", "c"]);
  });

  it("starts a new range instead of deselecting when the anchor is no longer shown", () => {
    // The anchor "x" was hidden by collapsing its parent folder.
    const selection = getNextSelection(
      { kind: "folders", ids: ["x", "b"], anchorId: "x" },
      "folders",
      order,
      "b",
      range,
    );
    expect(selection).toEqual({ kind: "folders", ids: ["x", "b"], anchorId: "b" });
    expect(getNextSelection(selection, "folders", order, "d", range)?.ids).toEqual(["b", "c", "d"]);
  });

  it("replaces a selection of the other kind", () => {
    const tags = { kind: "tags" as const, ids: ["x"], anchorId: "x" };
    expect(getNextSelection(tags, "folders", order, "a", toggle)).toEqual({
      kind: "folders",
      ids: ["a"],
      anchorId: "a",
    });
  });
});

describe("orderSelectedIds", () => {
  it("sorts by screen order and keeps unknown ids last", () => {
    expect(orderSelectedIds(["d", "z", "a"], order)).toEqual(["a", "d", "z"]);
  });
});
