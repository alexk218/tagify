import { expect, it } from "vitest";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import { COMMUNITY_TAGS_CATEGORY, placeCommunityTag } from "../communityTagPlacement";

const idOf = (records: Record<string, { id: string; name: string }>, name: string) =>
  Object.values(records).find((record) => record.name === name)!.id;
const taxonomy = () => buildTaxonomyFromCategoryTree([{
  id: "mood", name: "Mood & Energy",
  subcategories: [{ id: "atmo", name: "Atmosphere", tags: [{ id: "dark", name: "Dark" }] }],
}] as never);

it("uses the member's own tag of that name, wherever it is", () => {
  const current = taxonomy();
  const result = placeCommunityTag(current, "dark", ["Feeling / Moody / dark"]);
  expect(result.tag.id).toBe(idOf(current.tagsById, "Dark"));
  expect(result.taxonomy).toBe(current);
});

it("files a new tag in the first place people keep it that the member also has, as deep as the member's folders match", () => {
  const current = taxonomy();
  const folderId = idOf(current.subcategoriesById, "Atmosphere");
  const result = placeCommunityTag(current, "Foggy", ["Elements / Weather / Foggy", "mood & energy / Atmosphere / Weather / Foggy"]);
  expect(result.tag).toMatchObject({ name: "Foggy", parentId: folderId });
  expect(result.taxonomy.subcategoriesById[folderId].tagIds).toContain(result.tag.id);
});

it("puts a tag with no matching category in From Community, made once", () => {
  const first = placeCommunityTag(taxonomy(), "Techno", ["Genre / Techno"]);
  const categoryId = first.taxonomy.categoryOrder.at(-1)!;
  expect(first.taxonomy.categoriesById[categoryId].name).toBe(COMMUNITY_TAGS_CATEGORY);
  const second = placeCommunityTag(first.taxonomy, "House", ["House"]);
  expect(second.taxonomy.categoryOrder.filter((id) => second.taxonomy.categoriesById[id].name === COMMUNITY_TAGS_CATEGORY)).toHaveLength(1);
  expect(second.tag.parentId).toBe(categoryId);
});
