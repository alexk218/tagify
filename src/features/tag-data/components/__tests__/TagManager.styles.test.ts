// @vitest-environment node
import cssText from "../TagManager.module.css?inline";
import { describe, expect, it } from "vitest";

describe("TagManager taxonomy pane styles", () => {
  it("does not reserve scrollbar space when its content does not overflow", () => {
    // The pane is .taxonomyPane since the resizable divider (#878); every rule for it counts.
    const taxonomyPaneRules = [...cssText.matchAll(/\._?taxonomyPane(?:_[a-z0-9]+)?\s*\{([^}]*)\}/g)].map((match) => match[1]);

    expect(taxonomyPaneRules.length).toBeGreaterThan(0);
    for (const rule of taxonomyPaneRules) expect(rule).not.toMatch(/scrollbar-gutter\s*:/);
  });
});
