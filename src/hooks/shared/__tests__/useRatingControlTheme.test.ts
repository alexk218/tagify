import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRatingControlTheme } from "../useRatingControlTheme";

const property = "--tagify-rating-control-muted";

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty(property);
  document.getElementById("test-theme-palette")?.remove();
});

describe("live theme compatibility", () => {
  it("updates for a Marketplace stylesheet change and restores the exact default color", async () => {
    let palette: Record<string, string> = {
      card: "rgb(40, 40, 40)",
      "button-disabled": "rgb(83, 83, 83)",
      subtext: "rgb(179, 179, 179)",
      text: "rgb(255, 255, 255)",
    };
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      // JSDOM does not resolve CSS variables; emulate the browser's resolved palette.
      const key = (element as HTMLElement).style.color.match(/--spice-([\w-]+)/)?.[1];
      return { backgroundColor: palette.card, color: key ? palette[key] : "" } as CSSStyleDeclaration;
    });
    const theme = document.createElement("style");
    theme.id = "test-theme-palette";
    document.head.appendChild(theme);
    const { unmount } = renderHook(useRatingControlTheme);
    expect(document.documentElement.style.getPropertyValue(property)).toBe("");

    palette = {
      card: "rgb(55, 65, 69)",
      "button-disabled": "rgb(55, 65, 69)",
      subtext: "rgb(154, 167, 157)",
      text: "rgb(211, 198, 170)",
    };
    theme.textContent = ":root { --spice-card: #374145; }";
    await waitFor(() => expect(document.documentElement.style.getPropertyValue(property)).toBe(palette.subtext));

    palette.card = "rgb(40, 40, 40)";
    palette["button-disabled"] = "rgb(83, 83, 83)";
    theme.textContent = ":root { --spice-card: #282828; }";
    await waitFor(() => expect(document.documentElement.style.getPropertyValue(property)).toBe(""));
    unmount();
    expect(document.querySelector("body > span[hidden]")).toBeNull();
  });

  it("removes listeners and restores a prior property when the app unmounts", () => {
    document.documentElement.style.setProperty(property, "#123456");
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      backgroundColor: "rgb(0, 0, 0)", color: "rgb(0, 0, 0)",
    } as CSSStyleDeclaration);
    const removeListener = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(useRatingControlTheme);
    expect(document.documentElement.style.getPropertyValue(property)).toBe("#ffffff");
    unmount();
    expect(document.documentElement.style.getPropertyValue(property)).toBe("#123456");
    expect(document.documentElement.style.getPropertyPriority(property)).toBe("");
    expect(removeListener).toHaveBeenCalledWith("load", expect.any(Function), true);
  });
});
