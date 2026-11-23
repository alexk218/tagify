import { describe, expect, it } from "vitest";
import { ADVANCED_FILTERS_KEY, readAdvancedFilters, setAdvancedFilters } from "../advancedFiltersSetting";

describe("advanced filters setting", () => {
  it("starts off for someone new", () => {
    expect(readAdvancedFilters()).toBe(false);
  });

  it("starts on for someone who used the Complex tag editor", () => {
    localStorage.setItem("tagify:tagFilterEditorMode", "complex");
    expect(readAdvancedFilters()).toBe(true);
  });

  it("starts on for someone who had the Camelot keys open", () => {
    localStorage.setItem("tagify:showAdvancedFilters", "true");
    expect(readAdvancedFilters()).toBe(true);
  });

  it("follows the Settings switch once it has been set", () => {
    localStorage.setItem("tagify:tagFilterEditorMode", "complex");
    setAdvancedFilters(false);
    expect(localStorage.getItem(ADVANCED_FILTERS_KEY)).toBe("false");
    expect(readAdvancedFilters()).toBe(false);
  });
});
