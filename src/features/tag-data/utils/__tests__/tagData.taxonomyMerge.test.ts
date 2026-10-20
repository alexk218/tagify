// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TagTaxonomy } from "@/types/tagData";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import { mergeTaxonomy } from "../tagData.taxonomyMerge";

function taxonomy(folders: Record<string, string[]>, names: Record<string, string> = {}): TagTaxonomy {
  const tagsById: TagTaxonomy["tagsById"] = {};
  const subcategoriesById: TagTaxonomy["subcategoriesById"] = {};
  for (const [folderId, tagIds] of Object.entries(folders)) {
    subcategoriesById[folderId] = { id: folderId, name: names[folderId] ?? folderId, parentId: "mood", categoryId: "mood", tagIds: [...tagIds] };
    for (const tagId of tagIds) tagsById[tagId] = { id: tagId, name: names[tagId] ?? tagId, parentId: folderId, subcategoryId: folderId };
  }
  return normalizeTaxonomyTree({
    categoryOrder: ["mood"],
    categoriesById: { mood: { id: "mood", name: "Mood", subcategoryIds: Object.keys(folders) } },
    subcategoriesById, tagsById,
    customAccentsById: {}, colorThemesById: {}, colorThemeOrder: [], ungroupedColorIds: [],
  });
}

const tagsIn = (value: TagTaxonomy, folderId: string) => value.childrenByParentId?.[folderId];

describe("mergeTaxonomy", () => {
  it("keeps a tag created elsewhere while this edit added another", () => {
    const before = taxonomy({ tone: ["calm"] });
    const edited = taxonomy({ tone: ["calm", "sombre"] });
    const current = taxonomy({ tone: ["calm", "lofi"] });
    const merged = mergeTaxonomy(before, edited, current);
    expect(tagsIn(merged, "tone")).toEqual(["calm", "sombre", "lofi"]);
    expect(Object.keys(merged.tagsById).sort()).toEqual(["calm", "lofi", "sombre"]);
    expect(merged.subcategoriesById.tone.tagIds).toEqual(["calm", "sombre", "lofi"]);
  });

  it("applies this edit's rename and another device's removal", () => {
    const before = taxonomy({ tone: ["calm", "sad"] });
    const edited = taxonomy({ tone: ["calm", "sad"] }, { calm: "Calm" });
    const current = taxonomy({ tone: ["calm"] });
    const merged = mergeTaxonomy(before, edited, current);
    expect(merged.tagsById.calm.name).toBe("Calm");
    expect(merged.tagsById.sad).toBeUndefined();
  });

  it("keeps a removed folder when a tag was put in it elsewhere", () => {
    const before = taxonomy({ tone: ["calm"], style: ["raw"] });
    const edited = taxonomy({ tone: ["calm"] });
    const current = taxonomy({ tone: ["calm"], style: ["raw", "lofi"] });
    const merged = mergeTaxonomy(before, edited, current);
    expect(merged.subcategoriesById.style).toBeDefined();
    expect(tagsIn(merged, "style")).toEqual(["lofi"]);
    expect(merged.tagsById.raw).toBeUndefined();
  });

  it("returns either side unchanged when only one side changed", () => {
    const before = taxonomy({ tone: ["calm"] });
    const edited = taxonomy({ tone: ["calm", "sad"] });
    const current = taxonomy({ tone: ["calm", "lofi"] });
    expect(mergeTaxonomy(before, before, current)).toBe(current);
    expect(mergeTaxonomy(before, edited, before)).toBe(edited);
  });

  it("keeps colors and collections changed on both sides", () => {
    const base = taxonomy({ tone: ["calm"] });
    const withColors = (ids: string[], grouped: string[]): TagTaxonomy => ({
      ...base,
      customAccentsById: Object.fromEntries(ids.map((id) => [id, { id: id as `custom:${string}`, name: id, color: "#112233", themeId: grouped.includes(id) ? "theme:a" : null }])),
      colorThemesById: { "theme:a": { id: "theme:a", name: "A", colorIds: grouped as `custom:${string}`[] } },
      colorThemeOrder: ["theme:a"],
      ungroupedColorIds: ids.filter((id) => !grouped.includes(id)) as `custom:${string}`[],
    });
    const before = withColors(["custom:1"], []);
    const merged = mergeTaxonomy(before, withColors(["custom:1", "custom:2"], []), withColors(["custom:1", "custom:3"], ["custom:3"]));
    expect(Object.keys(merged.customAccentsById).sort()).toEqual(["custom:1", "custom:2", "custom:3"]);
    expect(merged.colorThemesById["theme:a"].colorIds).toEqual(["custom:3"]);
    expect(merged.ungroupedColorIds).toEqual(["custom:1", "custom:2"]);
    expect(merged.customAccentsById["custom:3"].themeId).toBe("theme:a");
  });
});
