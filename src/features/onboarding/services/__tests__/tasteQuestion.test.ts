import { afterEach, describe, expect, it } from "vitest";
import { buildMoodsStarterTaxonomy, defaultTagData, KNOWN_STARTER_TAXONOMIES } from "@/constants/defaultTagData";
import { hasCustomTaxonomy } from "@/features/tag-data/utils/tagData.schema";
import { classifyLocalReplica } from "@/services/sync/SyncLocalState";
import type { TagTaxonomy } from "@/types/tagData";
import {
  isTasteQuestionOffered,
  markTasteQuestionAnswered,
  markTasteQuestionOffered,
  shouldAskTasteQuestion,
  tasteQuestionTaxonomy,
} from "../tasteQuestion";

const starter = () => structuredClone(defaultTagData.taxonomy);
const categoryNames = (taxonomy: TagTaxonomy) => taxonomy.categoryOrder.map((id) => taxonomy.categoriesById[id].name);
const tagCount = (taxonomy: TagTaxonomy) => Object.keys(taxonomy.tagsById).length;
const ask = (overrides: Partial<Parameters<typeof shouldAskTasteQuestion>[0]> = {}) => shouldAskTasteQuestion({
  offered: true, isLoading: false, taggedTrackCount: 0, connected: false, restoreOnOffer: false, taxonomy: starter(), ...overrides,
});

afterEach(() => localStorage.clear());

describe("What do you listen to? on desktop", () => {
  it("is offered once, from the fresh install until it's answered", () => {
    expect(isTasteQuestionOffered()).toBe(false);
    markTasteQuestionOffered();
    expect(isTasteQuestionOffered()).toBe(true);
    markTasteQuestionAnswered("skipped");
    markTasteQuestionOffered();
    expect(isTasteQuestionOffered()).toBe(false);
  });

  it("is asked only of a new library with nothing of its own", () => {
    expect(ask()).toBe(true);
    expect(ask({ offered: false })).toBe(false);
    expect(ask({ isLoading: true })).toBe(false);
    expect(ask({ taggedTrackCount: 1 })).toBe(false);
    expect(ask({ connected: true })).toBe(false);
    expect(ask({ restoreOnOffer: true })).toBe(false);
    const edited = starter();
    edited.tagsById[Object.keys(edited.tagsById)[0]].name = "My own name";
    expect(ask({ taxonomy: edited })).toBe(false);
  });

  it("Skip leaves Moods and moments, the same 40 tags as Community's set", () => {
    const { taxonomy, packs } = tasteQuestionTaxonomy(starter(), [], true);
    expect(packs).toEqual([]);
    expect(categoryNames(taxonomy)).toEqual(["Mood & Energy", "Usage & Context"]);
    expect(tagCount(taxonomy)).toBe(40);
    // The kept categories keep the starter tags' IDs.
    for (const id of taxonomy.categoryOrder) expect(defaultTagData.taxonomy.categoriesById[id]).toBeDefined();
    for (const id of Object.keys(taxonomy.tagsById)) expect(defaultTagData.taxonomy.tagsById[id]?.name).toBe(taxonomy.tagsById[id].name);
  });

  it("Continue adds the ticked packs to Moods and moments, and the library still counts as new", () => {
    const { taxonomy, packs } = tasteQuestionTaxonomy(starter(), ["metal", "pop"], true);
    expect(packs.map((pack) => pack.key)).toEqual(["metal", "pop"]);
    expect(categoryNames(taxonomy)).toEqual(["Mood & Energy", "Usage & Context", "Genre & Style"]);
    expect(tagCount(taxonomy)).toBe(40 + 11 + 10);
    // Untouched, it can still take an account's tags when the person signs in later.
    expect(hasCustomTaxonomy(taxonomy)).toBe(false);
    expect(classifyLocalReplica({ taxonomy, tracks: {}, playlists: {}, artists: {} }, KNOWN_STARTER_TAXONOMIES, null)).toBe("fresh-default");
    expect(classifyLocalReplica({ taxonomy: buildMoodsStarterTaxonomy(), tracks: {}, playlists: {}, artists: {} }, KNOWN_STARTER_TAXONOMIES, null)).toBe("fresh-default");
  });

  it("never replaces tags that aren't untouched starter tags: the packs are only added", () => {
    const current = starter();
    const { taxonomy } = tasteQuestionTaxonomy(current, ["metal"], false);
    for (const id of Object.keys(current.tagsById)) expect(taxonomy.tagsById[id]?.name).toBe(current.tagsById[id].name);
    expect(tagCount(taxonomy)).toBeGreaterThan(tagCount(current));
    expect(tasteQuestionTaxonomy(current, [], false).taxonomy).toBe(current);
  });
});
