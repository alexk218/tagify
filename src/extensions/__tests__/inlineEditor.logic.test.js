import { describe, expect, it } from "vitest";
import {
  addRecentTag,
  createUpdatedTrack,
  getRatingUpdateForSelection,
  getTagIndicatorStatus,
  toggleTagId,
  toggleTagIdForSelection,
} from "../inlineEditor.logic";

describe("inline editor state", () => {
  it("persists only supported half-star ratings and preserves existing track data", () => {
    expect(
      createUpdatedTrack(
        { rating: 3, energy: 4, bpm: 120, tagIds: ["tag-1"], dateCreated: 1 },
        { rating: 4.5 },
        2,
      ),
    ).toEqual({
      rating: 4.5,
      energy: 4,
      bpm: 120,
      tagIds: ["tag-1"],
      dateCreated: 1,
      dateModified: 2,
    });
  });

  it("rejects invalid rating values", () => {
    expect(createUpdatedTrack(null, { rating: 4.25, energy: 11 }, 2)).toMatchObject({
      rating: 0,
      energy: 0,
      tagIds: [],
    });
  });

  it("toggles tags and keeps recent tags unique in session order", () => {
    expect(toggleTagId(["tag-1"], "tag-2")).toEqual(["tag-1", "tag-2"]);
    expect(toggleTagId(["tag-1", "tag-2"], "tag-1")).toEqual(["tag-2"]);
    expect(addRecentTag(["tag-1", "tag-2"], "tag-2")).toEqual([
      "tag-2",
      "tag-1",
    ]);
  });

  it("adds a bulk tag to every track unless every track already has it", () => {
    expect(
      toggleTagIdForSelection(
        [["tag-1"], ["tag-1", "tag-2"], []],
        "tag-1",
      ),
    ).toEqual([
      ["tag-1"],
      ["tag-1", "tag-2"],
      ["tag-1"],
    ]);

    expect(
      toggleTagIdForSelection(
        [["tag-1"], ["tag-1", "tag-2"]],
        "tag-1",
      ),
    ).toEqual([[], ["tag-2"]]);
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
