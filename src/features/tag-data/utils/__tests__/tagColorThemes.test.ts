import { describe, expect, it } from "vitest";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import {
  normalizeColorLibrary,
  getOrderedCustomColors,
  getOrderedColorThemes,
  parseColorLibrary,
  serializeColorLibrary,
  uniqueImportedName,
} from "../tagColorThemes";

describe("color theme contracts", () => {
  it("keeps preset colors built in instead of migrating them into an editable theme", () => {
    const taxonomy = createEmptyTaxonomy();
    delete (taxonomy as Partial<typeof taxonomy>).colorThemesById;
    delete (taxonomy as Partial<typeof taxonomy>).ungroupedColorIds;
    taxonomy.tagsById.house = { id: "house", name: "House", subcategoryId: "electronic", accentId: "blue" };

    const result = normalizeColorLibrary(taxonomy);

    expect(result.tagsById.house.accentId).toBe("blue");
    expect(result.colorThemesById).toEqual({});
    expect(result.customAccentsById).toEqual({});
  });

  it("removes the legacy Default theme while preserving edited colors as custom", () => {
    const taxonomy = createEmptyTaxonomy();
    taxonomy.customAccentsById["custom:default-blue"] = {
      id: "custom:default-blue",
      name: "Ocean",
      color: "#123456",
      themeId: "theme:default",
    };
    taxonomy.customAccentsById["custom:default-teal"] = {
      id: "custom:default-teal",
      name: "Teal",
      color: "#2dd4bf",
      themeId: "theme:default",
    };
    taxonomy.colorThemesById["theme:default"] = {
      id: "theme:default",
      name: "Default",
      colorIds: ["custom:default-blue", "custom:default-teal"],
    };
    taxonomy.tagsById.ocean = { id: "ocean", name: "Ocean", subcategoryId: "electronic", accentId: "custom:default-blue" };
    taxonomy.tagsById.teal = { id: "teal", name: "Teal", subcategoryId: "electronic", accentId: "custom:default-teal" };

    const result = normalizeColorLibrary(taxonomy);

    expect(result.colorThemesById["theme:default"]).toBeUndefined();
    expect(result.tagsById.teal.accentId).toBe("teal");
    expect(result.customAccentsById["custom:default-teal"]).toBeUndefined();
    expect(result.tagsById.ocean.accentId).toBe("custom:default-blue");
    expect(result.customAccentsById["custom:default-blue"]).toMatchObject({
      name: "Ocean",
      color: "#123456",
      themeId: null,
    });
    expect(result.ungroupedColorIds).toContain("custom:default-blue");
  });

  it("round-trips the versioned export contract without internal ids", () => {
    const taxonomy = createEmptyTaxonomy();
    taxonomy.customAccentsById["custom:fire"] = { id: "custom:fire", name: "Flame", color: "#ff3300", themeId: "theme:fire" };
    taxonomy.colorThemesById["theme:fire"] = { id: "theme:fire", name: "Fire", colorIds: ["custom:fire"] };

    const exported = serializeColorLibrary(taxonomy);

    expect(parseColorLibrary(exported)).toEqual(exported);
    expect(JSON.stringify(exported)).not.toContain("custom:fire");
    expect(parseColorLibrary({ ...exported, themes: [{ name: "Fire", colors: [{ name: "Bad", color: "red" }] }] })).toBeNull();
  });

  it("renames every imported name collision", () => {
    const used = new Set(["fire", "fire (1)"]);
    expect(uniqueImportedName("Fire", used)).toBe("Fire (2)");
  });

  it("uses persisted custom collection order and appends unlisted collections in data order", () => {
    const taxonomy = createEmptyTaxonomy();
    taxonomy.colorThemesById = {
      "theme:one": { id: "theme:one", name: "One", colorIds: [] },
      "theme:two": { id: "theme:two", name: "Two", colorIds: [] },
      "theme:three": { id: "theme:three", name: "Three", colorIds: [] },
    };
    taxonomy.colorThemeOrder = ["theme:two", "theme:one"];

    expect(getOrderedColorThemes(taxonomy, "custom").map((theme) => theme.id)).toEqual([
      "theme:two",
      "theme:one",
      "theme:three",
    ]);
  });

  it("sorts collections by newest creation and update timestamp", () => {
    const taxonomy = createEmptyTaxonomy();
    taxonomy.colorThemesById = {
      "theme:older": { id: "theme:older", name: "Older", colorIds: [], createdAt: 10, updatedAt: 30 },
      "theme:newer": { id: "theme:newer", name: "Newer", colorIds: [], createdAt: 20, updatedAt: 20 },
    };

    expect(getOrderedColorThemes(taxonomy, "created").map((theme) => theme.id)).toEqual(["theme:newer", "theme:older"]);
    expect(getOrderedColorThemes(taxonomy, "updated").map((theme) => theme.id)).toEqual(["theme:older", "theme:newer"]);
  });

  it("derives color order without overwriting the persisted custom order", () => {
    const taxonomy = createEmptyTaxonomy();
    taxonomy.customAccentsById = {
      "custom:apricot": { id: "custom:apricot", name: "Apricot", color: "#fed7aa", createdAt: 10, updatedAt: 30 },
      "custom:zebra": { id: "custom:zebra", name: "Zebra", color: "#111111", createdAt: 20, updatedAt: 20 },
    };
    const customOrder = ["custom:zebra", "custom:apricot"] as const;

    expect(getOrderedCustomColors(taxonomy, customOrder, "custom").map((color) => color.id)).toEqual(["custom:zebra", "custom:apricot"]);
    expect(getOrderedCustomColors(taxonomy, customOrder, "alphabetical").map((color) => color.id)).toEqual(["custom:apricot", "custom:zebra"]);
    expect(getOrderedCustomColors(taxonomy, customOrder, "created").map((color) => color.id)).toEqual(["custom:zebra", "custom:apricot"]);
    expect(getOrderedCustomColors(taxonomy, customOrder, "updated").map((color) => color.id)).toEqual(["custom:apricot", "custom:zebra"]);
    expect(customOrder).toEqual(["custom:zebra", "custom:apricot"]);
  });
});
