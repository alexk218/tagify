import { afterEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob } from "node:buffer";
import { defaultTagData } from "@/constants/defaultTagData";
import { buildResolvedTagLookup, createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import { CREATE_SHARED_TAG, createSmartPlaylistRecipeBundle, downloadSmartPlaylistRecipeBundle, getRecipeSelections, installSmartPlaylistRecipeBundle, isSmartPlaylistRecipeBundle, parseSmartPlaylistShare } from "../smartPlaylist.recipes";
import type { SmartPlaylistCriteria } from "../../model/smartPlaylist.types";

const tagId = Object.keys(defaultTagData.taxonomy.tagsById)[0];
const original: SmartPlaylistCriteria = { id: "my-local-rule", playlistId: "private-spotify-playlist", playlistName: "House", isActive: true, createdAt: 10, lastSyncAt: 20, smartPlaylistTrackUris: ["spotify:track:private"], pendingTagChoices: ["spotify:track:waiting"],
  criteria: { includeTagClauses: [{ tagIds: [tagId], excludedTagIds: [], operator: "AND" }], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null },
};
const share = () => createSmartPlaylistRecipeBundle([original], defaultTagData.taxonomy);

describe("safe playlist sharing", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("exports only the selected definition, without song data or account connections", async () => {
    const bundle = await share();
    const text = JSON.stringify(bundle);
    for (const secret of [original.playlistId, original.id!, "spotify:track:", "pendingTagChoices", "isActive", "lastSyncAt", "smartPlaylistTrackUris"]) expect(text).not.toContain(secret);
    expect(bundle.recipes[0].criteria.ratingFilters).toEqual([5]);
    expect(bundle.recipes[0].tagReferences).toHaveLength(1);
  });
  it("requires a tag choice and allows mapping to an existing tag in another folder", async () => {
    const bundle = await share();
    bundle.recipes[0].tagReferences[0].categoryName = "Someone else’s genres";
    const choices = getRecipeSelections(bundle, defaultTagData.taxonomy, []);
    expect(Object.values(choices[0].tagMappings)).toEqual([""]);
    expect(() => installSmartPlaylistRecipeBundle(bundle, defaultTagData.taxonomy, [], 100, choices)).toThrow("Choose");
    choices[0].tagMappings[bundle.recipes[0].tagReferences[0].key] = tagId;
    const result = installSmartPlaylistRecipeBundle(bundle, defaultTagData.taxonomy, [original], 100, choices);
    expect(result.createdTagCount).toBe(0);
    expect(result.playlists[0]).toBe(original);
    // Identical local definitions are kept without duplicates, even before they have a source record.
    expect(result.importedCount).toBe(0);
  });
  it("adds an explicit copy with a unique name and identity, disabled and unconnected", async () => {
    const bundle = await share();
    const first = installSmartPlaylistRecipeBundle(bundle, defaultTagData.taxonomy, []).playlists[0];
    const bound = { ...first, playlistId: "my-spotify", isActive: true, pendingTagChoices: ["spotify:track:pending"] };
    const choices = getRecipeSelections(bundle, defaultTagData.taxonomy, [bound]);
    expect(choices[0].mode).toBe("skip"); choices[0].mode = "copy";
    const result = installSmartPlaylistRecipeBundle(bundle, defaultTagData.taxonomy, [bound], 100, choices);
    expect(result.playlists[0]).toBe(bound);
    expect(result.playlists[1]).toMatchObject({ playlistName: "House (2)", playlistId: "", isActive: false, smartPlaylistTrackUris: [], lastSyncAt: 0 });
    expect(result.playlists[1].id).not.toBe(bound.id);
    expect(result.playlists[1].pendingTagChoices).toBeUndefined();
    // Re-sharing two independent copies produces a valid file with two distinct identities.
    expect(isSmartPlaylistRecipeBundle(await createSmartPlaylistRecipeBundle(result.playlists, defaultTagData.taxonomy))).toBe(true);
  });
  it("creates missing paths only for selected setups and does not alter the source taxonomy", async () => {
    const bundle = await share(); const empty = createEmptyTaxonomy();
    const choices = getRecipeSelections(bundle, empty, []);
    choices[0].mode = "skip";
    expect(installSmartPlaylistRecipeBundle(bundle, empty, [], 100, choices).createdTagCount).toBe(0);
    choices[0].mode = "add";
    choices[0].tagMappings[bundle.recipes[0].tagReferences[0].key] = CREATE_SHARED_TAG;
    const result = installSmartPlaylistRecipeBundle(bundle, empty, [], 100, choices);
    expect(result.createdTagCount).toBe(1);
    expect(buildResolvedTagLookup(result.taxonomy).size).toBe(1);
    expect(empty.tagsById).toEqual({});
  });
  it("fails sharing a missing tag instead of dropping a condition or exposing its local identity", async () => {
    await expect(createSmartPlaylistRecipeBundle([{ ...original, criteria: { ...original.criteria, includeTagClauses: [{ tagIds: ["missing-private-tag"], excludedTagIds: [], operator: "AND" }] } }], defaultTagData.taxonomy)).rejects.toThrow("missing");
  });
  it("keeps older setups with the same creation date distinct without exposing their Spotify IDs", async () => {
    const older = { ...original, id: undefined };
    const bundle = await createSmartPlaylistRecipeBundle([older, { ...older, playlistId: "another-private-id" }], defaultTagData.taxonomy);
    expect(new Set(bundle.recipes.map((recipe) => recipe.id)).size).toBe(2);
    expect(JSON.stringify(bundle)).not.toContain("another-private-id");
  });
  it("downloads the complete validated file and retains it until the browser can begin saving", async () => {
    const bundle = await share(); vi.useFakeTimers(); vi.stubGlobal("Blob", NativeBlob);
    let file!: Blob;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { file = blob as Blob; return "blob:share-test"; });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.isConnected).toBe(true); expect(this.download).toMatch(/^tagify-smart-playlist.*\.json$/); });
    downloadSmartPlaylistRecipeBundle(bundle);
    expect(click).toHaveBeenCalledOnce(); expect(revoke).not.toHaveBeenCalled();
    expect(parseSmartPlaylistShare(await file.text())).toEqual(bundle);
    vi.advanceTimersByTime(1000); expect(revoke).toHaveBeenCalledWith("blob:share-test");
  });
  it("blocks too many selected setups with a useful next step", async () => {
    await expect(createSmartPlaylistRecipeBundle(Array.from({ length: 101 }, (_, i) => ({ ...original, id: `setup-${i}` })), defaultTagData.taxonomy)).rejects.toThrow("100 setups");
  });
  it.each([
    (bundle: any) => { bundle.recipes[0].criteria.includeTagClauses[0].operator = "XOR"; },
    (bundle: any) => { bundle.recipes[0].criteria.ratingFilters = [99]; },
    (bundle: any) => { bundle.recipes[0].criteria.energyMinFilter = 9; bundle.recipes[0].criteria.energyMaxFilter = 2; },
    (bundle: any) => { bundle.recipes[0].criteria.bpmMinFilter = "100"; },
    (bundle: any) => { bundle.recipes[0].criteria.camelotKeyFilters = ["99Z"]; },
    (bundle: any) => { bundle.recipes[0].criteria.clauseConnectors = ["AND"]; },
    (bundle: any) => { bundle.recipes[0].criteria.includeTagClauses[0].tagIds = ["unknown"]; },
    (bundle: any) => { bundle.recipes[0].source.recipeId = "a-different-id"; },
    (bundle: any) => { bundle.recipes.push(bundle.recipes[0]); },
    (bundle: any) => { bundle.recipes[0].tagReferences.push(bundle.recipes[0].tagReferences[0]); },
  ])("rejects malformed definitions before mutation (%#)", async (damage) => {
    const bundle = await share(); damage(bundle);
    expect(isSmartPlaylistRecipeBundle(bundle)).toBe(false);
    expect(() => installSmartPlaylistRecipeBundle(bundle, defaultTagData.taxonomy, [original])).toThrow("incomplete");
  });
  it("gives useful guidance for old, newer, empty, broken, or oversized files", async () => {
    expect(() => parseSmartPlaylistShare("[]")).toThrow("older playlist backup");
    expect(() => parseSmartPlaylistShare("nope")).toThrow("original file");
    expect(() => parseSmartPlaylistShare("x".repeat(2 * 1024 * 1024 + 1))).toThrow("too large");
    const bundle = await share();
    expect(() => parseSmartPlaylistShare(JSON.stringify({ ...bundle, version: 2 }))).toThrow("newer Tagify");
    expect(() => parseSmartPlaylistShare(JSON.stringify({ ...bundle, recipes: [] }))).toThrow("complete");
  });
});
