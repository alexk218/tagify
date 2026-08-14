import { describe, expect, it } from "vitest";
import { getTagAccentTokens, normalizeCustomTagAccent } from "../tagAccent";

describe("tagAccent", () => {
  it("keeps bright custom accents on light label text", () => {
    const accentId = "custom:sunshine";
    const tokens = getTagAccentTokens(accentId, {
      [accentId]: {
        id: accentId,
        name: "Sunshine",
        color: "#ffed7a",
      },
    });

    expect(tokens?.text).toBe("#f8fbff");
  });

  it("keeps neon custom accents on light label text", () => {
    const accentId = "custom:lemon";
    const tokens = getTagAccentTokens(accentId, {
      [accentId]: {
        id: accentId,
        name: "Lemon",
        color: "#fef63c",
      },
    });

    expect(tokens?.text).toBe("#f8fbff");
  });

  it("preserves color creation and update timestamps during normalization", () => {
    expect(normalizeCustomTagAccent({
      id: "custom:ember",
      name: "Ember",
      color: "#f97316",
      createdAt: 10,
      updatedAt: 20,
    })).toMatchObject({ createdAt: 10, updatedAt: 20 });
  });
});
