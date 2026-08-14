import { describe, expect, it, vi } from "vitest";
import { renderStarRatingControl } from "../inlineEditor.ratingControl";

describe("inline star rating control", () => {
  it("renders five visible stars with half-star actions", () => {
    const control = document.createElement("div");
    const onRate = vi.fn();

    renderStarRatingControl(control, {
      rating: 2.5,
      compact: false,
      onRate,
    });

    expect(control.querySelectorAll(".tagify-rating-star")).toHaveLength(5);
    expect(control.querySelectorAll("button")).toHaveLength(10);
    expect(
      Array.from(
        control.querySelectorAll(".tagify-rating-star-fill"),
        (fill) => fill.style.width,
      ),
    ).toEqual(["100%", "100%", "50%", "0%", "0%"]);

    control
      .querySelector('button[aria-label="Set rating to 3.5 stars"]')
      .click();
    expect(onRate).toHaveBeenCalledWith(3.5);
  });

  it("lets the user clear the current rating by selecting it again", () => {
    const control = document.createElement("div");
    const onRate = vi.fn();

    renderStarRatingControl(control, {
      rating: 4.5,
      compact: true,
      onRate,
    });

    control.querySelector('button[aria-label="Clear 4.5 star rating"]').click();
    expect(onRate).toHaveBeenCalledWith(0);
  });

  it("refreshes the action label when the bulk selection changes", () => {
    const control = document.createElement("div");
    let trackCount = 2;

    renderStarRatingControl(control, {
      rating: 4.5,
      compact: false,
      getActionLabel: (value) =>
        `Set ${trackCount} selected tracks to ${value} stars`,
      onRate: vi.fn(),
    });

    const button = control.querySelector("button");
    expect(button).toHaveAttribute("aria-label", "Set rating to 0.5 stars");

    trackCount = 3;
    button.dispatchEvent(new MouseEvent("mouseenter"));
    expect(button).toHaveAttribute(
      "aria-label",
      "Set 3 selected tracks to 0.5 stars",
    );
  });
});
