// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TagTaxonomy } from "@/types/tagData";
import {
  buildTagGroupFilterIdSet,
  evaluateTagFilterFormula,
  formatTagFilterFormula,
  pruneTagFilterFormula,
  tagFilterFormulaUsesGroups,
  toTagGroupFilterId,
  type TagFilterFormula,
} from "@/utils/tagFilterGroups";
import { smartPlaylistTagChoices } from "../smartPlaylist.tagChoices";
import type { SmartPlaylistFilterCriteria } from "../../model/smartPlaylist.types";

function taxonomy(extraGenreTags: string[] = []): TagTaxonomy {
  const tag = (id: string, subcategoryId: string) => ({ id, name: id.replace("tag_", ""), subcategoryId, parentId: subcategoryId });
  const genreMain = ["tag_rock", "tag_pop"];
  const subGenre = ["tag_shoegaze", "tag_grunge", ...extraGenreTags];
  return {
    categoryOrder: ["genre", "mood"],
    categoriesById: {
      genre: { id: "genre", name: "Genre", subcategoryIds: ["genre_main", "sub_genre"] },
      mood: { id: "mood", name: "Mood", subcategoryIds: ["mood_main"] },
    },
    subcategoriesById: {
      genre_main: { id: "genre_main", name: "Main", categoryId: "genre", tagIds: genreMain },
      sub_genre: { id: "sub_genre", name: "Sub-genre", categoryId: "genre", tagIds: subGenre },
      mood_main: { id: "mood_main", name: "Moods", categoryId: "mood", tagIds: ["tag_happy", "tag_sad"] },
    },
    tagsById: Object.fromEntries([
      ...genreMain.map((id) => [id, tag(id, "genre_main")]),
      ...subGenre.map((id) => [id, tag(id, "sub_genre")]),
      ["tag_happy", tag("tag_happy", "mood_main")],
      ["tag_sad", tag("tag_sad", "mood_main")],
    ]),
    customAccentsById: {},
    colorThemesById: {},
    ungroupedColorIds: [],
  };
}

const ANY_MOOD = toTagGroupFilterId("mood");
const SUB_GENRE = toTagGroupFilterId("sub_genre");
const formula = (clauses: TagFilterFormula["clauses"], connectors: TagFilterFormula["connectors"] = []): TagFilterFormula => ({ clauses, connectors });
const criteria = (f: TagFilterFormula) => ({ includeTagClauses: f.clauses, clauseConnectors: f.connectors }) as unknown as SmartPlaylistFilterCriteria;

describe("category terms in tag filters", () => {
  it("matches “rock but no sub-genre” (the Discord request)", () => {
    const rockWithoutSubGenre = formula([{ tagIds: ["tag_rock"], excludedTagIds: [SUB_GENRE], operator: "AND" }]);
    const tax = taxonomy();
    expect(evaluateTagFilterFormula(["tag_rock"], rockWithoutSubGenre, tax)).toBe(true);
    expect(evaluateTagFilterFormula(["tag_rock", "tag_grunge"], rockWithoutSubGenre, tax)).toBe(false);
    expect(evaluateTagFilterFormula(["tag_pop"], rockWithoutSubGenre, tax)).toBe(false);
  });

  it("combines Any and No terms with AND and OR", () => {
    const tax = taxonomy();
    const anyMoodAndSubGenre = formula([{ tagIds: [ANY_MOOD, SUB_GENRE], excludedTagIds: [], operator: "AND" }]);
    expect(evaluateTagFilterFormula(["tag_sad", "tag_grunge"], anyMoodAndSubGenre, tax)).toBe(true);
    expect(evaluateTagFilterFormula(["tag_sad"], anyMoodAndSubGenre, tax)).toBe(false);
    const anyMoodOrSubGenre = formula([{ tagIds: [ANY_MOOD, SUB_GENRE], excludedTagIds: [], operator: "OR" }]);
    expect(evaluateTagFilterFormula(["tag_grunge"], anyMoodOrSubGenre, tax)).toBe(true);
    expect(evaluateTagFilterFormula(["tag_rock"], anyMoodOrSubGenre, tax)).toBe(false);
    const noMoodOrRock = formula(
      [
        { tagIds: [], excludedTagIds: [ANY_MOOD], operator: "OR" },
        { tagIds: ["tag_rock"], excludedTagIds: [], operator: "OR" },
      ],
      ["OR"],
    );
    expect(evaluateTagFilterFormula(["tag_pop"], noMoodOrRock, tax)).toBe(true);
    expect(evaluateTagFilterFormula(["tag_happy", "tag_rock"], noMoodOrRock, tax)).toBe(true);
    expect(evaluateTagFilterFormula(["tag_happy"], noMoodOrRock, tax)).toBe(false);
  });

  it("counts tags added to the category after the filter was saved", () => {
    const anySubGenre = formula([{ tagIds: [SUB_GENRE], excludedTagIds: [], operator: "OR" }]);
    expect(evaluateTagFilterFormula(["tag_dreampop"], anySubGenre, taxonomy())).toBe(false);
    expect(evaluateTagFilterFormula(["tag_dreampop"], anySubGenre, taxonomy(["tag_dreampop"]))).toBe(true);
  });

  it("ignores a deleted category: No matches every song, Any matches none", () => {
    const tax = taxonomy();
    const gone = toTagGroupFilterId("deleted_category");
    expect(evaluateTagFilterFormula(["tag_rock"], formula([{ tagIds: [], excludedTagIds: [gone], operator: "OR" }]), tax)).toBe(true);
    expect(evaluateTagFilterFormula(["tag_rock"], formula([{ tagIds: [gone], excludedTagIds: [], operator: "OR" }]), tax)).toBe(false);
  });

  it("matches no tags without a taxonomy", () => {
    expect(evaluateTagFilterFormula(["tag_happy"], formula([{ tagIds: [ANY_MOOD], excludedTagIds: [], operator: "OR" }]), null)).toBe(false);
  });

  it("writes category terms out as Any and No", () => {
    const f = formula([{ tagIds: ["tag_rock", ANY_MOOD], excludedTagIds: [SUB_GENRE], operator: "AND" }]);
    expect(formatTagFilterFormula(f, (id) => id.replace("tag_", ""), taxonomy())).toBe("(rock AND Any Mood) AND No Sub-genre");
    expect(tagFilterFormulaUsesGroups(f)).toBe(true);
    expect(tagFilterFormulaUsesGroups(formula([{ tagIds: ["tag_rock"], excludedTagIds: [], operator: "OR" }]))).toBe(false);
  });

  it("keeps category terms when pruning removed tags", () => {
    const tax = taxonomy();
    const valid = new Set([...Object.keys(tax.tagsById).filter((id) => id !== "tag_rock"), ...buildTagGroupFilterIdSet(tax)]);
    const pruned = pruneTagFilterFormula(formula([{ tagIds: ["tag_rock", ANY_MOOD], excludedTagIds: [SUB_GENRE], operator: "AND" }]), valid);
    expect(pruned.clauses).toEqual([{ tagIds: [ANY_MOOD], excludedTagIds: [SUB_GENRE], operator: "AND" }]);
  });

  it("offers tag choices: No removes the category's tags, Any asks", () => {
    const tax = taxonomy();
    const noMood = criteria(formula([{ tagIds: ["tag_rock"], excludedTagIds: [ANY_MOOD], operator: "OR" }]));
    expect(smartPlaylistTagChoices(["tag_rock", "tag_sad"], noMood, tax)).toEqual([{ add: [], remove: ["tag_sad"] }]);
    const anyMood = criteria(formula([{ tagIds: [ANY_MOOD], excludedTagIds: [], operator: "OR" }]));
    expect(smartPlaylistTagChoices(["tag_rock"], anyMood, tax)).toBeNull();
    expect(smartPlaylistTagChoices(["tag_happy"], anyMood, tax)).toEqual([{ add: [], remove: [] }]);
  });
});

describe("buildTagGroupFilterOptions", () => {
  it("lists categories then their folders, skipping empty ones", async () => {
    const { buildTagGroupFilterOptions } = await import("@/utils/tagFilterGroups");
    const tax = taxonomy();
    tax.subcategoriesById.empty = { id: "empty", name: "Empty", categoryId: "mood", tagIds: [] };
    tax.categoriesById.mood.subcategoryIds.push("empty");
    expect(buildTagGroupFilterOptions(tax).map((option) => [option.path.join(" / "), option.depth, option.tagIds.length])).toEqual([
      ["Genre", 0, 4],
      ["Genre / Main", 1, 2],
      ["Genre / Sub-genre", 1, 2],
      ["Mood", 0, 2],
      ["Mood / Moods", 1, 2],
    ]);
  });
});
