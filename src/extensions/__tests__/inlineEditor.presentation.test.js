import { describe, expect, it, vi } from "vitest";
import { renderInlineEditorPresentation } from "../inlineEditor.presentation";

const tagGroups = [
  {
    categoryName: "Genre",
    subcategoryName: "Electronic",
    tags: [{ id: "house", name: "House", accent: null }],
  },
];

function render(overrides = {}) {
  const control = document.createElement("div");
  renderInlineEditorPresentation(control, {
    rating: 4,
    energy: 7,
    tagStatus: "complete",
    tagGroups,
    onRate: vi.fn(),
    onEnergy: vi.fn(),
    ...overrides,
  });
  return control;
}

describe("inline editor presentation", () => {
  it("keeps combined mode centered and opens compact tag and energy editors directly", () => {
    const onOpenTags = vi.fn();
    const onOpenEnergy = vi.fn();
    const parent = document.createElement("div");
    const onNavigate = vi.fn();
    parent.addEventListener("click", onNavigate);
    const control = render({ onOpenTags, onOpenEnergy });
    parent.appendChild(control);

    expect(Array.from(control.children, (child) => child.className)).toEqual([
      "tagify-inline-leading",
      "tagify-star-rating-control",
      "tagify-inline-trailing",
    ]);
    expect(control.style.gridTemplateColumns).toBe(
      "minmax(0, 1fr) auto minmax(0, 1fr)",
    );

    const tagButton = control.querySelector(".tagify-tag-status-indicator");
    const energyButton = control.querySelector(".tagify-energy-rating-label");
    tagButton.click();
    energyButton.click();
    expect(onOpenTags).toHaveBeenCalledWith(tagButton);
    expect(onOpenEnergy).toHaveBeenCalledWith(energyButton);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("uses equal fixed side rails in the compact playbar layout", () => {
    const control = render({ compact: true });
    expect(control.style.gridTemplateColumns).toBe("26px auto 26px");
    expect(control.children[1]).toHaveClass("tagify-star-rating-control");
  });

  it("always renders an interactive empty star affordance in stars mode", () => {
    const control = render({ displayMode: "stars", rating: 0 });
    expect(control.querySelectorAll(".tagify-rating-star")).toHaveLength(5);
    expect(control.children).toHaveLength(1);
  });

  it("always renders the ten-step slider in energy mode, including when unset", () => {
    const control = render({ displayMode: "energy", energy: 0 });
    const slider = control.querySelector(".tagify-energy-control");
    expect(slider).toHaveAttribute("role", "slider");
    expect(slider).toHaveAttribute("aria-valuetext", "Energy not set");
    expect(slider.querySelectorAll(".tagify-energy-segment")).toHaveLength(10);
    expect(slider).toHaveTextContent("E—");
  });

  it("shows a detailed first-tag pill in tracklist tags mode", () => {
    const control = render({
      displayMode: "tags",
      tagGroups: [
        ...tagGroups,
        {
          categoryName: "Mood",
          subcategoryName: "Time",
          tags: [{ id: "night", name: "Late Night", accent: null }],
        },
      ],
    });
    expect(control.querySelector(".tagify-tag-status-indicator")).toHaveTextContent(
      "House +1",
    );
  });

  it("shows a tag count in compact tags mode", () => {
    const control = render({ displayMode: "tags", compact: true });
    expect(control.querySelector(".tagify-tag-status-indicator")).toHaveTextContent(
      "1 tag",
    );
  });

  it("shows Add tags when tags mode has no assigned tags", () => {
    const control = render({
      displayMode: "tags",
      tagStatus: "none",
      tagGroups: [],
    });
    expect(control.querySelector(".tagify-tag-status-indicator")).toHaveTextContent(
      "Add tags",
    );
  });

  it("renders nothing when disabled", () => {
    const control = render({ displayMode: "disabled" });
    expect(control).toBeEmptyDOMElement();
    expect(control.style.display).toBe("none");
  });

  it("keeps the To Tag icon right after the stars and energy in every mode", () => {
    const extra = document.createElement("button");
    extra.className = "tagify-to-tag-icon";

    const combined = render({ trailingExtra: extra });
    const trailing = combined.querySelector(".tagify-inline-trailing");
    expect(Array.from(trailing.children, (child) => child.className)).toEqual([
      "tagify-energy-rating-label",
      "tagify-to-tag-icon",
    ]);

    // Re-rendering moves the same icon instead of losing it.
    renderInlineEditorPresentation(combined, { rating: 2, trailingExtra: extra, onRate: vi.fn() });
    expect(combined.querySelectorAll(".tagify-to-tag-icon")).toHaveLength(1);

    const stars = render({ displayMode: "stars", trailingExtra: extra });
    expect(stars.lastElementChild).toBe(extra);

    const disabled = render({ displayMode: "disabled", trailingExtra: extra });
    expect(disabled.style.display).toBe("inline-flex");
    expect(Array.from(disabled.children)).toEqual([extra]);
  });

  it("keeps keyboard focus on energy while arrow keys change it, as the saved value redraws the controls", () => {
    const control = document.createElement("div");
    document.body.appendChild(control);
    const saved = [];
    const draw = (energy) => renderInlineEditorPresentation(control, {
      energy,
      displayMode: "energy",
      onEnergy: (next) => { saved.push(next); draw(next); },
    });
    draw(7);
    control.querySelector(".tagify-energy-control").focus();

    for (let press = 0; press < 2; press += 1) {
      document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    }

    expect(saved).toEqual([8, 9]);
    expect(document.activeElement).toBe(control.querySelector(".tagify-energy-control"));
    control.remove();
  });

  it("keeps keyboard focus on the star that was chosen once the rating redraws the controls", async () => {
    const control = document.createElement("div");
    document.body.appendChild(control);
    const draw = (rating) => renderInlineEditorPresentation(control, {
      rating,
      displayMode: "stars",
      onRate: (next) => { draw(next); },
    });
    draw(2);
    const stars = () => Array.from(control.querySelectorAll(".tagify-rating-star-button"));
    stars()[6].focus();
    stars()[6].click();
    await Promise.resolve();

    expect(control.querySelector('[aria-pressed="true"]')?.getAttribute("aria-label")).toBe("Clear 3.5 star rating");
    expect(document.activeElement).toBe(stars()[6]);
    control.remove();
  });
});
