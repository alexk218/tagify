// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addRecentTag,
  getRatingUpdateForSelection,
  getTagIndicatorStatus,
} from "../inlineEditor.logic";

describe("inline editor state", () => {
  it("keeps recent tags unique in session order", () => {
    expect(addRecentTag(["tag-1", "tag-2"], "tag-2")).toEqual([
      "tag-2",
      "tag-1",
    ]);
  });

  it("sets a mixed selection to the chosen rating and clears a common rating", () => {
    expect(getRatingUpdateForSelection([2, 3.5, 5], 3.5)).toBe(3.5);
    expect(getRatingUpdateForSelection([3.5, 3.5, 3.5], 3.5)).toBe(0);
  });

  it("shows tag status only when tags exist and requires all values for green", () => {
    expect(getTagIndicatorStatus({ rating: 5, energy: 10 }, 0)).toBe("none");
    expect(getTagIndicatorStatus({ rating: 5, energy: 0 }, 1)).toBe("incomplete");
    expect(getTagIndicatorStatus({ rating: 0, energy: 10 }, 1)).toBe("incomplete");
    expect(getTagIndicatorStatus({ rating: 5, energy: 10 }, 1)).toBe("complete");
  });
});
