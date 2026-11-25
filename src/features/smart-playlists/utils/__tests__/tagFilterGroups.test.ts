// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  TAG_FILTER_OPERATORS,
  buildTagFilterFormulaFromIncludeTagGroups,
  buildTagFilterFormulaFromLegacyFilters,
  evaluateTagFilterFormula,
  findTagFilterLocations,
  formatTagFilterFormula,
  normalizeTagFilterFormula,
  pruneTagFilterFormula,
  withTagInFilterClause,
  withoutTagInFilterClause,
} from "@/utils/tagFilterGroups";

const { AND, OR } = TAG_FILTER_OPERATORS;
const clause = (
  tagIds: string[],
  operator: "AND" | "OR" = AND,
  excludedTagIds: string[] = [],
) => ({ tagIds, excludedTagIds, operator });

describe("a tag in several groups", () => {
  it("keeps a tag that appears in more than one group", () => {
    const formula = normalizeTagFilterFormula({
      clauses: [clause(["distortion", "crunchy"]), clause(["distortion", "overdrive"])],
      connectors: [OR],
    });

    expect(formula.clauses.map((c) => c.tagIds)).toEqual([
      ["distortion", "crunchy"],
      ["distortion", "overdrive"],
    ]);
    expect(findTagFilterLocations(formula, "distortion")).toEqual([
      { clauseIndex: 0, lane: "include" },
      { clauseIndex: 1, lane: "include" },
    ]);
  });

  it("still allows a tag only once within a group", () => {
    const formula = normalizeTagFilterFormula({
      clauses: [clause(["a", "a", "b"], AND, ["a", "c"])],
      connectors: [],
    });

    expect(formula.clauses[0]).toEqual(clause(["a", "b"], AND, ["c"]));
  });

  it("matches (A AND B) OR (A AND C AND D), which needs A twice", () => {
    const formula = {
      clauses: [clause(["a", "b"]), clause(["a", "c", "d"])],
      connectors: [OR],
    };

    expect(evaluateTagFilterFormula(["a", "b"], formula, null)).toBe(true);
    expect(evaluateTagFilterFormula(["a", "c", "d"], formula, null)).toBe(true);
    expect(evaluateTagFilterFormula(["a", "c"], formula, null)).toBe(false);
    expect(evaluateTagFilterFormula(["b", "c", "d"], formula, null)).toBe(false);
  });

  it("adds a tag to a group without taking it out of the others", () => {
    const formula = { clauses: [clause(["a", "b"]), clause(["c"])], connectors: [OR] };

    expect(withTagInFilterClause(formula, "a", 1)).toEqual({
      clauses: [clause(["a", "b"]), clause(["c", "a"])],
      connectors: [OR],
    });
  });

  it("switches a tag's lane only in the group it is changed in", () => {
    const formula = { clauses: [clause(["a"]), clause(["a", "b"])], connectors: [OR] };

    expect(withTagInFilterClause(formula, "a", 1, { lane: "exclude" })).toEqual({
      clauses: [clause(["a"]), clause(["b"], AND, ["a"])],
      connectors: [OR],
    });
  });

  it("removes a tag from one group only, dropping the group if it empties", () => {
    const formula = {
      clauses: [clause(["a", "b"]), clause(["a"]), clause(["c"])],
      connectors: [OR, AND],
    };

    expect(withoutTagInFilterClause(formula, "a", 0)).toEqual({
      clauses: [clause(["b"]), clause(["a"]), clause(["c"])],
      connectors: [OR, AND],
    });
    expect(withoutTagInFilterClause(formula, "a", 1)).toEqual({
      clauses: [clause(["a", "b"]), clause(["c"])],
      connectors: [AND],
    });
  });
});

describe("tagFilterGroups", () => {
  it("converts legacy OR filters into a single OR clause", () => {
    expect(
      buildTagFilterFormulaFromLegacyFilters(
        ["tag_pop", "tag_rock", "tag_pop"],
        true,
      ),
    ).toEqual({
      clauses: [
        {
          tagIds: ["tag_pop", "tag_rock"],
          excludedTagIds: [],
          operator: TAG_FILTER_OPERATORS.OR,
        },
      ],
      connectors: [],
    });
  });

  it("supports configurable operators within and between clauses", () => {
    expect(
      evaluateTagFilterFormula(["tag_pop", "tag_sfw"], {
        clauses: [
          {
            tagIds: ["tag_pop", "tag_rock"],
            excludedTagIds: [],
            operator: TAG_FILTER_OPERATORS.OR,
          },
          {
            tagIds: ["tag_sfw"],
            excludedTagIds: [],
            operator: TAG_FILTER_OPERATORS.AND,
          },
        ],
        connectors: [TAG_FILTER_OPERATORS.AND],
      }, null),
    ).toBe(true);

    expect(
      evaluateTagFilterFormula(["tag_sfw"], {
        clauses: [
          {
            tagIds: ["tag_pop", "tag_rock"],
            excludedTagIds: [],
            operator: TAG_FILTER_OPERATORS.OR,
          },
          {
            tagIds: ["tag_sfw"],
            excludedTagIds: [],
            operator: TAG_FILTER_OPERATORS.AND,
          },
        ],
        connectors: [TAG_FILTER_OPERATORS.OR],
      }, null),
    ).toBe(true);
  });

  it("prunes invalid tags and drops empty clauses", () => {
    expect(
      pruneTagFilterFormula(
        {
          clauses: [
            {
              tagIds: ["tag_pop", "tag_rock"],
              excludedTagIds: [],
              operator: TAG_FILTER_OPERATORS.OR,
            },
            {
              tagIds: ["tag_sfw"],
              excludedTagIds: [],
              operator: TAG_FILTER_OPERATORS.AND,
            },
          ],
          connectors: [TAG_FILTER_OPERATORS.AND],
        },
        new Set(["tag_rock", "tag_sfw"]),
      ),
      ).toEqual({
      clauses: [
        {
          tagIds: ["tag_rock"],
          excludedTagIds: [],
          operator: TAG_FILTER_OPERATORS.OR,
        },
        {
          tagIds: ["tag_sfw"],
          excludedTagIds: [],
          operator: TAG_FILTER_OPERATORS.AND,
        },
      ],
      connectors: [TAG_FILTER_OPERATORS.AND],
    });
  });

  it("formats clause-local NOT terms inline", () => {
    expect(
      formatTagFilterFormula(
        {
          clauses: [
            {
              tagIds: ["tag_pop", "tag_rock"],
              excludedTagIds: ["tag_live"],
              operator: TAG_FILTER_OPERATORS.OR,
            },
          ],
          connectors: [],
        },
        (tagId) =>
          ({
            tag_pop: "Pop",
            tag_rock: "Rock",
            tag_live: "Live",
          })[tagId] ?? tagId,
      ),
    ).toBe("(Pop OR Rock) AND NOT Live");
  });

  it("formats clause formulas as a readable expression", () => {
    expect(
      formatTagFilterFormula(
        buildTagFilterFormulaFromIncludeTagGroups([
          ["tag_pop", "tag_rock"],
          ["tag_sfw"],
        ]),
        (tagId) =>
          ({
            tag_pop: "Pop",
            tag_rock: "Rock",
            tag_sfw: "SFW",
          })[tagId] ?? tagId,
      ),
    ).toBe("(Pop OR Rock) AND SFW");
  });
});
