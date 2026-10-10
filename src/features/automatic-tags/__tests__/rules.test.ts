import { describe, expect, it } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { normalizeRules, planRule, ruleMatch, spotifyScope, type AutomaticTagRule } from "../rules";
const rule: AutomaticTagRule = { id: "short", name: "Short songs", enabled: false, scopes: [], conditions: [{ field: "length", max: 180 }], tagIds: ["short"], otherwiseTagIds: ["long"] };
const track = { rating: 4, energy: 7, bpm: 120, tagIds: ["existing"], dateModified: 123, albumUri: "spotify:album:one" };
const data = { ...defaultTagData, tracks: { a: track, b: { ...track, bpm: null }, c: track }, taxonomy: { ...defaultTagData.taxonomy, tagsById: Object.fromEntries(["short", "long", "existing"].map(id => [id, { id, name: id, subcategoryId: "folder" }])) } };
const context = { facts: { a: { durationMs: 180000, artistUris: ["spotify:artist:one"] }, b: { durationMs: 181000, artistUris: ["spotify:artist:two"] } }, playlists: { "spotify:playlist:one": new Set(["a", "b"]), "spotify:playlist:two": new Set(["a"]) } };
describe("automatic tag rules", () => {
  it("adds matching and otherwise tags, skips missing facts, preserves source data", () => {
    const result = planRule(rule, data, context);
    expect(result).toEqual({ matched: 1, unknown: 1, updates: [
      { trackUri: "a", toAdd: ["short"], toRemove: [], automaticRuleIds: ["short"] },
      { trackUri: "b", toAdd: ["long"], toRemove: [], automaticRuleIds: ["short"] },
    ] });
    expect(track).toEqual({ rating: 4, energy: 7, bpm: 120, tagIds: ["existing"], dateModified: 123, albumUri: "spotify:album:one" });
  });
  it("intersects multiple playlists and never tags songs outside the selection", () => {
    const scoped = { ...rule, scopes: ["spotify:playlist:one", "spotify:playlist:two"] };
    expect(ruleMatch(scoped, "b", data, context)).toBe("outside");
    expect(planRule(scoped, data, context).updates.map(u => u.trackUri)).toEqual(["a"]);
    expect(ruleMatch(scoped, "a", data, { ...context, playlists: {} })).toBeNull();
  });
  it("uses confirmed album/artist identities, including collaborating artists", () => {
    expect(ruleMatch({ ...rule, scopes: ["spotify:album:one", "spotify:artist:one"] }, "a", data, context)).toBe(true);
    expect(ruleMatch({ ...rule, scopes: ["spotify:artist:two"] }, "a", data, context)).toBe("outside");
    expect(ruleMatch({ ...rule, scopes: ["spotify:artist:one"] }, "c", data, context)).toBeNull();
  });
  it("combines length and BPM, treats missing BPM as unknown rather than Otherwise", () => {
    const combined = { ...rule, conditions: [...rule.conditions, { field: "bpm" as const, min: 120, max: 120 }] };
    expect(ruleMatch(combined, "a", data, context)).toBe(true);
    expect(ruleMatch(combined, "b", data, context)).toBeNull();
  });
  it("is idempotent and ignores removed tags", () => {
    expect(planRule(rule, { ...data, tracks: { a: { ...track, tagIds: ["existing", "short"] } } }, context).updates).toEqual([]);
    expect(planRule({ ...rule, tagIds: ["deleted"], otherwiseTagIds: [] }, data, context).updates).toEqual([]);
  });
  it("supports a membership-only rule and rejects an unrestricted blanket rule", () => {
    expect(planRule({ ...rule, scopes: ["spotify:album:one"], conditions: [] }, data, context).updates).toHaveLength(3);
    expect(normalizeRules([{ ...rule, conditions: [] }])).toEqual([]);
  });
  it.each([{ conditions: [{ field: "length", min: 200, max: 100 }] }, { conditions: [{ field: "length", min: NaN }] }, { scopes: ["javascript:alert(1)"] }, { tagIds: [] }, { otherwiseTagIds: [42] }])("rejects malformed imported rules: %j", invalid => {
    expect(normalizeRules([{ ...rule, ...invalid }])).toEqual([]);
  });
  it("bounds and deduplicates imported rules and selected tags", () => {
    expect(normalizeRules([rule, rule])).toHaveLength(1);
    expect(normalizeRules([{ ...rule, tagIds: ["short", "short"] }])[0].tagIds).toEqual(["short"]);
    expect(normalizeRules(Array.from({ length: 30 }, (_, i) => ({ ...rule, id: String(i) })))).toHaveLength(20);
  });
  it("accepts Spotify share links and rejects unrelated links", () => {
    expect(spotifyScope("https://open.spotify.com/intl-en/playlist/abc123?si=xyz")).toBe("spotify:playlist:abc123");
    expect(spotifyScope("spotify:artist:abc123")).toBe("spotify:artist:abc123");
    expect(spotifyScope("https://example.com/playlist/abc123")).toBeNull();
    expect(spotifyScope("https://open.spotify.com/track/abc123")).toBeNull();
  });
});


it("includes untagged songs in an explicitly chosen playlist only after their details are known", () => {
  const selected = { ...rule, scopes: ["spotify:playlist:new"] };
  const scope = { ...context, playlists: { "spotify:playlist:new": new Set(["new", "unknown"]) }, facts: { ...context.facts, new: { durationMs: 160000, name: "New song", artists: "An artist" } } };
  const result = planRule(selected, data, scope);
  expect(result.updates).toEqual([{ trackUri: "new", toAdd: ["short"], toRemove: [], automaticRuleIds: ["short"], trackDetails: { name: "New song", artists: "An artist" } }]);
  expect(result.unknown).toBe(1);
});
it("includes album tracklist members even before their first manual tag", () => {
  const scoped = { ...rule, scopes: ["spotify:album:new"] };
  const albumContext = { ...context, albums: { "spotify:album:new": new Set(["new"]) }, facts: { ...context.facts, new: { name: "Album song", artists: "An artist", durationMs: 160000, albumUri: "spotify:album:new" } } };
  expect(planRule(scoped, { ...data, tracks: {} }, albumContext).updates).toHaveLength(1);
});
