import { describe, expect, it } from "vitest";
import { createTagStatusIndicator } from "../inlineEditor.tagIndicator";

describe("inline tag status indicator", () => {
  it("renders nothing when the track has no applied tags", () => {
    expect(createTagStatusIndicator("none", "")).toBeNull();
  });

  it("renders only a colored dot with the applied tags as its tooltip", () => {
    const indicator = createTagStatusIndicator(
      "incomplete",
      "House\nLate Night",
    );

    expect(indicator.textContent).toBe("●");
    expect(indicator.title).toBe("House\nLate Night");
    expect(indicator.style.color).toBe("rgb(255, 165, 0)");
    expect(indicator).toHaveAttribute(
      "aria-label",
      "Applied tags: House, Late Night",
    );
    expect(indicator.style.cursor).toContain("data:image/svg+xml");
    expect(indicator.style.cursor).toMatch(/3 3, pointer$/);

    const encodedCursorSvg = indicator.style.cursor.match(
      /data:image\/svg\+xml,([^"]+)/,
    )[1];
    const cursorSvg = decodeURIComponent(encodedCursorSvg);
    expect(cursorSvg).toContain('width="16" height="16"');
    expect(cursorSvg).toContain('fill="#FFFFFF"');
    expect(cursorSvg).not.toContain("#1DB954");
  });

  it("uses green only for a complete tagged track", () => {
    const indicator = createTagStatusIndicator("complete", "House");

    expect(indicator.style.color).toBe("rgb(29, 185, 84)");
  });
});
