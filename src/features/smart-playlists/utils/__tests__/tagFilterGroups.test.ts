import { describe, expect, it } from "vitest";
import {
  TAG_FILTER_OPERATORS,
  buildTagFilterFormulaFromIncludeTagGroups,
  buildTagFilterFormulaFromLegacyFilters,
  evaluateTagFilterFormula,
  formatTagFilterFormula,
  pruneTagFilterFormula,
} from "@/utils/tagFilterGroups";

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
      }),
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
      }),
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
