// @vitest-environment node
import cssText from "../TagSelector.module.css?inline";
import { describe, expect, it } from "vitest";

// Class names may be scoped in the compiled stylesheet, so match on the name they start from.
function getRule(className: string) {
  return cssText.match(new RegExp(`\\.[\\w-]*${className}[\\w-]*\\s*\\{([^}]*)\\}`))?.[1];
}

function getLeftPaddingPx(rule: string | undefined) {
  const paddingLeft = rule?.match(/padding-left\s*:\s*(\d+)px/)?.[1];
  if (paddingLeft) return Number(paddingLeft);

  const padding = rule?.match(/padding\s*:\s*([^;]+)/)?.[1].trim().split(/\s+/);
  if (!padding) return 0;
  return Number.parseFloat(padding[3] ?? padding[1] ?? padding[0]) || 0;
}

describe("TagSelector nested folder styles", () => {
  it("indents every folder level by the same small step as top-level folders", () => {
    const nestedListRule = getRule("nestedSubcategoryList");
    const topLevelIndent = getLeftPaddingPx(getRule("subcategoryList"));

    expect(nestedListRule).toBeDefined();
    expect(topLevelIndent).toBeGreaterThan(0);
    expect(getLeftPaddingPx(nestedListRule)).toBe(topLevelIndent);
  });
});
