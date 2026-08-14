import { describe, expect, it, vi } from "vitest";
import { renderInlineEditorPresentation } from "../inlineEditor.presentation";

describe("inline editor presentation", () => {
  it("updates energy and tag status immediately when the same control re-renders", () => {
    const control = document.createElement("div");
    const onRate = vi.fn();

    renderInlineEditorPresentation(control, {
      rating: 4,
      energy: 0,
      tagStatus: "none",
      tagListTooltip: "",
      compact: false,
      onRate,
    });

    expect(control.querySelector(".tagify-energy-rating-label")).toBeNull();
    expect(control.querySelector(".tagify-tag-status-indicator")).toBeNull();

    renderInlineEditorPresentation(control, {
      rating: 4,
      energy: 7,
      tagStatus: "incomplete",
      tagListTooltip: "House",
      compact: false,
      onRate,
    });

    expect(
      control.querySelector(".tagify-energy-rating-label"),
    ).toHaveTextContent("E 7");
    expect(
      control.querySelector(".tagify-tag-status-indicator"),
    ).toHaveAttribute("title", "House");

    renderInlineEditorPresentation(control, {
      rating: 4,
      energy: 7,
      tagStatus: "complete",
      tagListTooltip: "House\nLate Night",
      compact: false,
      onRate,
    });

    expect(
      control.querySelectorAll(".tagify-tag-status-indicator"),
    ).toHaveLength(1);
    expect(
      control.querySelector(".tagify-tag-status-indicator"),
    ).toHaveAttribute("title", "House\nLate Night");
    expect(
      control.querySelector(".tagify-tag-status-indicator").style.color,
    ).toBe("rgb(29, 185, 84)");
  });

  it("keeps stars centered between balanced status slots and isolates their clicks", () => {
    const parent = document.createElement("div");
    const control = document.createElement("div");
    const onNavigate = vi.fn();
    parent.addEventListener("click", onNavigate);
    parent.appendChild(control);

    renderInlineEditorPresentation(control, {
      rating: 4,
      energy: 7,
      tagStatus: "incomplete",
      tagListTooltip: "House",
      compact: false,
      onRate: vi.fn(),
    });

    expect(Array.from(control.children, (child) => child.className)).toEqual([
      "tagify-inline-leading",
      "tagify-star-rating-control",
      "tagify-inline-trailing",
    ]);
    expect(control.style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) auto minmax(0, 1fr)",
    );
    expect(
      control.querySelector(".tagify-inline-leading").firstElementChild,
    ).toHaveClass("tagify-tag-status-indicator");
    expect(
      control.querySelector(".tagify-inline-trailing").firstElementChild,
    ).toHaveClass("tagify-energy-rating-label");

    control.querySelector(".tagify-tag-status-indicator").click();
    control.querySelector(".tagify-energy-rating-label").click();
    expect(onNavigate).toHaveBeenCalledTimes(2);

    control.querySelector(".tagify-star-rating-control").click();
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["stars only", 0, "none"],
    ["stars and energy", 7, "none"],
    ["stars and tags", 0, "incomplete"],
    ["stars, energy, and tags", 7, "complete"],
  ])("keeps the star section in the center slot with %s", (_, energy, tagStatus) => {
    const control = document.createElement("div");

    renderInlineEditorPresentation(control, {
      rating: 4,
      energy,
      tagStatus,
      tagListTooltip: tagStatus === "none" ? "" : "House",
      compact: false,
      onRate: vi.fn(),
    });

    expect(control.children[1]).toHaveClass("tagify-star-rating-control");
    expect(control.children[0]).toHaveClass("tagify-inline-leading");
    expect(control.children[2]).toHaveClass("tagify-inline-trailing");
  });

  it("uses equal fixed side rails in the compact playbar layout", () => {
    const control = document.createElement("div");

    renderInlineEditorPresentation(control, {
      rating: 4,
      energy: 10,
      tagStatus: "complete",
      tagListTooltip: "House",
      compact: true,
      onRate: vi.fn(),
    });

    expect(control.style.gridTemplateColumns).toBe("26px auto 26px");
    expect(control.children[1]).toHaveClass("tagify-star-rating-control");
  });
});
