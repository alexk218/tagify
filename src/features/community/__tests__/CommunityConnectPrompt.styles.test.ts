// @vitest-environment node
import cssText from "../CommunityConnectPrompt.module.css?inline";
import { describe, expect, it } from "vitest";

describe("Community invitation layout", () => {
  it("moves the buttons under the text when the card itself is narrow, even in a wide window", () => {
    // Spotify's side panels can leave Tagify narrow while the window stays wide, so a window media query is not enough.
    expect(cssText).toMatch(/\.[\w-]*connect[\w-]*\s*\{[^}]*container-type\s*:\s*inline-size/);
    const narrow = cssText.match(/@container\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*)\}\s*$/);
    expect(narrow).not.toBeNull();
    expect(Number(narrow?.[1])).toBeGreaterThanOrEqual(480);
    expect(narrow?.[2]).toMatch(/actions[\w-]*\s*\{[^}]*width\s*:\s*100%/);
    expect(narrow?.[2]).toMatch(/text[\w-]*\s*\{[^}]*flex-basis\s*:\s*calc\(100% - 44px\)/);
  });
});
