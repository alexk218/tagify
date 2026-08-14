import cssText from "../TagManager.module.css?inline";
import { describe, expect, it } from "vitest";

describe("TagManager taxonomy pane styles", () => {
  it("does not reserve scrollbar space when its content does not overflow", () => {
    const taxonomyPaneRule = cssText.match(/:first-child\s*\{([^}]*)\}/)?.[1];

    expect(taxonomyPaneRule).toBeDefined();
    expect(taxonomyPaneRule).not.toMatch(/scrollbar-gutter\s*:/);
  });
});
