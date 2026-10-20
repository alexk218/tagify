// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isNearDuplicateTagName, isSameTagName, tagSlug } from "@tagify/community-contracts";
import matchFixtures from "@tagify/community-contracts/fixtures/tag-name-matches.fixtures.json";
import slugFixtures from "@tagify/community-contracts/fixtures/tag-slug.fixtures.json";

// The desktop suggests the same names, and groups the same spellings, as Community's tag pages.
describe("shared tag name rules in the desktop app", () => {
  it("groups spellings like the tag pages", () => {
    for (const { label, slug } of slugFixtures) expect(tagSlug(label), label).toBe(slug);
  });

  it("agrees on which names are the same tag, near-duplicates, or separate tags", () => {
    for (const [a, b] of matchFixtures.same) expect([isSameTagName(a, b), isNearDuplicateTagName(a, b)], `${a} / ${b}`).toEqual([true, false]);
    for (const [a, b] of matchFixtures.near) expect([isSameTagName(a, b), isNearDuplicateTagName(a, b)], `${a} / ${b}`).toEqual([false, true]);
    for (const [a, b] of matchFixtures.distinct) expect([isSameTagName(a, b), isNearDuplicateTagName(a, b)], `${a} / ${b}`).toEqual([false, false]);
  });
});
