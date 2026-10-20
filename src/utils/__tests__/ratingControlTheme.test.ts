// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getRatingControlColor } from "../ratingControlTheme";

describe("inactive rating and energy colors", () => {
  it.each([
    ["Spotify", "#282828", "#535353", "#b3b3b3", "#ffffff"],
    ["Comfy", "#101320", "#4b588c", "#b9bbbe", "#ffffff"],
  ])("preserves %s's existing control color", (_name, card, muted, subtext, text) => {
    expect(getRatingControlColor(card, muted, subtext, text)).toBeNull();
  });

  it.each([
    ["Everforest", "#374145", "#9aa79d", "#d3c6aa"],
    ["Kanagawa", "#d5cea3", "#545464", "#545464"],
    ["Lunar", "#303030", "#cecece", "#f3f3f3"],
    ["Catppuccin Latte", "#bcc0cc", "#5c5f77", "#4c4f69"],
    ["Catppuccin Frappe", "#51576d", "#b5bfe2", "#c6d0f5"],
    ["Catppuccin Macchiato", "#494d64", "#b8c0e0", "#cad3f5"],
    ["Catppuccin Mocha", "#45475a", "#bac2de", "#cdd6f4"],
  ])("restores visible controls in %s", (_name, card, subtext, text) => {
    expect(getRatingControlColor(card, card, subtext, text)).toBe(subtext);
  });

  it("also repairs near-identical colors rather than relying on exact equality", () => {
    expect(getRatingControlColor("rgb(55, 65, 69)", "rgb(56 66 70)", "rgb(154, 167, 157)", "#fff"))
      .toBe("rgb(154, 167, 157)");
  });

  it("uses text when the theme's subtext also blends into the card", () => {
    expect(getRatingControlColor("#303030", "#303030", "#313131", "#cecece")).toBe("#cecece");
  });

  it.each([["#000", "#ffffff"], ["#fff", "#000000"]])(
    "keeps controls visible even when all theme foregrounds match %s",
    (card, fallback) => {
      expect(getRatingControlColor(card, card, card, card)).toBe(fallback);
    },
  );

  it.each(["transparent", "rgba(40, 40, 40, 0.5)", "rgb(bad)", "var(--missing)"])(
    "leaves unsupported or translucent backgrounds alone: %s",
    (card) => expect(getRatingControlColor(card, "#303030", "#cecece", "#fff")).toBeNull(),
  );
});
