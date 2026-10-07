import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTagDetails,
  createTagStatusIndicator,
} from "../inlineEditor.tagIndicator";

const groups = [
  {
    categoryName: "Genre",
    subcategoryName: "Electronic",
    tags: [
      { id: "house", name: "House", accent: null },
      { id: "techno", name: "Techno", accent: null },
    ],
  },
  {
    categoryName: "Mood",
    subcategoryName: "Time",
    tags: [{ id: "night", name: "Late Night", accent: null }],
  },
];

afterEach(() => {
  document.querySelectorAll(".tagify-tag-popover").forEach((popover) => popover.remove());
  vi.useRealTimers();
});

describe("inline tag status indicator", () => {
  it("renders nothing without tags in compact combined mode", () => {
    expect(createTagStatusIndicator({ status: "none", groups: [] })).toBeNull();
  });

  it("renders an Add tags affordance when empty tags mode requests one", () => {
    const indicator = createTagStatusIndicator({
      status: "none",
      groups: [],
      detailed: true,
      showEmpty: true,
    });
    expect(indicator).toHaveTextContent("Add tags");
    expect(indicator).toHaveAttribute("aria-label", "Add tags");
  });

  it("shows every applied tag immediately on hover, grouped by taxonomy", () => {
    const indicator = createTagStatusIndicator({ status: "incomplete", groups });
    document.body.appendChild(indicator);
    indicator.dispatchEvent(new MouseEvent("mouseenter"));

    const popover = document.querySelector(".tagify-tag-popover");
    expect(popover).not.toBeNull();
    expect(popover).toHaveTextContent("Genre · Electronic");
    expect(popover).toHaveTextContent("Mood · Time");
    expect(
      Array.from(popover.querySelectorAll(".tagify-tag-popover-chip"), (chip) =>
        chip.textContent,
      ),
    ).toEqual(["House", "Techno", "Late Night"]);
    expect(indicator).not.toHaveAttribute("title");
  });

  it("opens the tag editor on click without bubbling to navigation", () => {
    const onOpenEditor = vi.fn();
    const parent = document.createElement("div");
    const onNavigate = vi.fn();
    parent.addEventListener("click", onNavigate);
    const indicator = createTagStatusIndicator({
      status: "complete",
      groups,
      onOpenEditor,
    });
    parent.appendChild(indicator);
    indicator.click();
    expect(onOpenEditor).toHaveBeenCalledWith(indicator);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("closes the hover card with Escape", () => {
    const indicator = createTagStatusIndicator({ status: "complete", groups });
    document.body.appendChild(indicator);
    indicator.dispatchEvent(new MouseEvent("mouseenter"));
    indicator.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".tagify-tag-popover")).toBeNull();
  });

  it("keeps tag accent colors in the hover details", () => {
    const details = buildTagDetails(
      [
        {
          categoryName: "Genre",
          subcategoryName: "Electronic",
          tagId: "house",
          name: "House",
          accentId: "amber",
        },
      ],
      {},
    );
    expect(details[0].tags[0].accent.dot).toBe("#f59e0b");
  });
});
