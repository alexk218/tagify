import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "../IndexedDBStorageService";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
const uri = "spotify:track:original";
const original = { rating: 4, energy: 5, bpm: 120, tagIds: ["old"], dateCreated: 10, dateModified: 20, albumUri: "spotify:album:old" };
beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("tagify:sync:account-id", "bulk-undo-tests");
  await indexedDBStorage.init();
  const taxonomy = createEmptyTaxonomy();
  taxonomy.categoryOrder = ["genre"];
  taxonomy.categoriesById.genre = { id: "genre", name: "Genre", subcategoryIds: [], childIds: ["old", "new"] };
  taxonomy.tagsById = { old: { id: "old", name: "Old", subcategoryId: "genre" }, new: { id: "new", name: "New", subcategoryId: "genre" } };
  await indexedDBStorage.saveTaxonomy(taxonomy);
  await indexedDBStorage.saveTrack(uri, original);
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.unstubAllGlobals(); });

it("atomically restores prior values and dates after a restart, removing a newly tagged track", async () => {
  await indexedDBStorage.applyBulkTagUpdates([
    { trackUri: uri, toAdd: ["new"], toRemove: ["old"], newRating: 1, newEnergy: 2 },
    { trackUri: "spotify:track:new", toAdd: ["new"], toRemove: [] },
  ]);
  indexedDBStorage.resetConnection();
  await indexedDBStorage.init();
  const entry = await indexedDBStorage.getLatestBulkUndo();
  const result = await indexedDBStorage.undoBulkTagUpdate(entry!.id);
  expect(result.skippedFields).toBe(0);
  expect(await indexedDBStorage.getTrack(uri)).toEqual(original);
  expect(await indexedDBStorage.getTrack("spotify:track:new")).toBeNull();
  expect(await indexedDBStorage.getLatestBulkUndo()).toBeNull();
});

it("keeps later rating and metadata edits while undoing unaffected tags and energy", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: [], newRating: 1, newEnergy: 2 }]);
  const after = (await indexedDBStorage.getTrack(uri))!;
  await indexedDBStorage.saveTrack(uri, { ...after, rating: 3, name: "Enriched title", dateModified: 99 });
  const result = await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  expect(result.skippedFields).toBe(1);
  expect(await indexedDBStorage.getTrack(uri)).toMatchObject({ rating: 3, energy: 5, tagIds: ["old"], name: "Enriched title", dateModified: 99 });
});

it("does not overwrite a tag list edited later or resurrect a deleted tag", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: ["old"] }]);
  const tree = await indexedDBStorage.getTaxonomy();
  delete tree.tagsById.old;
  await indexedDBStorage.saveTaxonomy(tree);
  const result = await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  expect(result.skippedFields).toBe(1);
  expect((await indexedDBStorage.getTrack(uri))!.tagIds).toEqual(["new"]);
});

it("refuses a stale Undo button and retains the last ten real bulk saves", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: [], toRemove: [], newRating: 1 }]);
  const old = (await indexedDBStorage.getLatestBulkUndo())!.id;
  for (let i = 0; i < 11; i++) await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: [], toRemove: [], newRating: i % 2 ? 1 : 2 }]);
  await expect(indexedDBStorage.undoBulkTagUpdate(old)).rejects.toThrow();
  for (let i = 0; i < 10; i++) await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  expect(await indexedDBStorage.getLatestBulkUndo()).toBeNull();
});

it("starts a fresh undo history when a backup replaces the library", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: [], toRemove: [], newRating: 1 }]);
  expect(await indexedDBStorage.saveAll(await indexedDBStorage.loadAllStrict())).toBe(true);
  expect(await indexedDBStorage.getLatestBulkUndo()).toBeNull();
});

it("adds artist tags atomically without losing ratings or another addition, and leaves no-op dates stable", async () => {
  const artist = "spotify:artist:artist";
  await indexedDBStorage.saveArtist(artist, { rating: 4, energy: 6, tagIds: [], dateCreated: 1, dateModified: 2 });
  await Promise.all([indexedDBStorage.addEntityTags(artist, "artist", ["old"]), indexedDBStorage.addEntityTags(artist, "artist", ["new"])]);
  const saved = await indexedDBStorage.getArtist(artist);
  expect(saved).toMatchObject({ rating: 4, energy: 6, tagIds: ["old", "new"], dateCreated: 1 });
  await indexedDBStorage.addEntityTags(artist, "artist", ["old", "new"]);
  expect(await indexedDBStorage.getArtist(artist)).toEqual(saved);
  await expect(indexedDBStorage.addEntityTags(artist, "artist", ["removed"])).rejects.toThrow();
  expect(await indexedDBStorage.getArtist(artist)).toEqual(saved);
});
it("refuses a bulk save to a different account and leaves the original track unchanged", async () => {
  await expect(indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: [] }], "different-account")).rejects.toThrow("account changed");
  expect(await indexedDBStorage.getTrack(uri)).toEqual(original);
});

it("rejects a tag creation after its original account changed", async () => {
  const before = await indexedDBStorage.getTaxonomy();
  await expect(indexedDBStorage.createQuickTag("Unwanted", "genre", "different-account")).rejects.toThrow();
  expect(await indexedDBStorage.getTaxonomy()).toEqual(before);
});


it("preserves timestamps for automatic tags and pauses their rules before Undo", async () => {
  const { writeRules, readRules } = await import("@/features/automatic-tags/store");
  writeRules([{ id: "auto", name: "Fast songs", enabled: true, scopes: [], conditions: [{ field: "bpm", min: 100 }], tagIds: ["new"], otherwiseTagIds: [] }]);
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: [], automaticRuleIds: ["auto"] }]);
  expect(await indexedDBStorage.getTrack(uri)).toEqual({ ...original, tagIds: ["old", "new"] });
  const entry = (await indexedDBStorage.getLatestBulkUndo())!;
  expect(entry.automaticRuleIds).toEqual(["auto"]);
  await indexedDBStorage.undoBulkTagUpdate(entry.id);
  expect(await indexedDBStorage.getTrack(uri)).toEqual(original);
  expect(readRules()[0].enabled).toBe(false);
});

it("keeps a scoped automatic rule and its undo from changing linked releases outside the preview", async () => {
  const other = "spotify:track:otherRelease";
  await indexedDBStorage.saveTrack(uri, { ...original, recordingGroupId: "linked" });
  await indexedDBStorage.saveTrack(other, { ...original, recordingGroupId: "linked", albumUri: "spotify:album:other" });
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: [], automaticRuleIds: ["auto"] }]);
  expect((await indexedDBStorage.getTrack(other))?.tagIds).toEqual(["old"]);
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  expect((await indexedDBStorage.getTrack(other))?.tagIds).toEqual(["old"]);
  expect((await indexedDBStorage.getTrack(uri))?.dateModified).toBe(20);
});

it("persists redo after restart, restores the exact saved timestamps, and can undo it again", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: ["old"], newRating: 1 }, { trackUri: "spotify:track:new", toAdd: ["new"], toRemove: [] }]);
  const saved = await indexedDBStorage.getTrack(uri);
  const newlyTagged = await indexedDBStorage.getTrack("spotify:track:new");
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  indexedDBStorage.resetConnection(); await indexedDBStorage.init();
  const entry = (await indexedDBStorage.getBulkEditHistory()).redo!;
  await indexedDBStorage.redoBulkTagUpdate(entry.id);
  expect(await indexedDBStorage.getTrack(uri)).toEqual(saved);
  expect(await indexedDBStorage.getTrack("spotify:track:new")).toEqual(newlyTagged);
  expect((await indexedDBStorage.getBulkEditHistory()).redo).toBeNull();
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  expect(await indexedDBStorage.getTrack(uri)).toEqual(original);
});
it("clears redo on a new annotation edit but retains it through metadata enrichment", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: [] }]);
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  await indexedDBStorage.saveTrack(uri, { ...original, albumName: "Enriched" });
  expect((await indexedDBStorage.getBulkEditHistory()).redo).not.toBeNull();
  await indexedDBStorage.saveTrack(uri, { ...original, rating: 2 });
  expect((await indexedDBStorage.getBulkEditHistory()).redo).toBeNull();
});
it("does not resurrect deleted tags on redo and refuses a stale redo ID", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: [] }]);
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  const entry = (await indexedDBStorage.getBulkEditHistory()).redo!;
  await expect(indexedDBStorage.redoBulkTagUpdate("stale")).rejects.toThrow();
  const taxonomy = await indexedDBStorage.getTaxonomy(); delete taxonomy.tagsById.new;
  await indexedDBStorage.saveTaxonomy(taxonomy);
  const result = await indexedDBStorage.redoBulkTagUpdate(entry.id);
  expect(result.skippedFields).toBe(1);
  expect((await indexedDBStorage.getTrack(uri))!.tagIds).toEqual(["old"]);
});
it("replays several undos in order and isolates redo across accounts", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: [], toRemove: [], newRating: 1 }]);
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: [], toRemove: [], newRating: 2 }]);
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  const stale = (await indexedDBStorage.getBulkEditHistory()).redo!.id;
  localStorage.setItem("tagify:sync:account-id", "other");
  await expect(indexedDBStorage.redoBulkTagUpdate(stale)).rejects.toThrow();
  localStorage.setItem("tagify:sync:account-id", "bulk-undo-tests");
  await indexedDBStorage.redoBulkTagUpdate((await indexedDBStorage.getBulkEditHistory()).redo!.id);
  expect((await indexedDBStorage.getTrack(uri))!.rating).toBe(1);
  await indexedDBStorage.redoBulkTagUpdate((await indexedDBStorage.getBulkEditHistory()).redo!.id);
  expect((await indexedDBStorage.getTrack(uri))!.rating).toBe(2);
});

it("redo keeps undone automatic rules paused rather than silently enabling them", async () => {
  const { writeRules, readRules } = await import("@/features/automatic-tags/store");
  writeRules([{ id: "rule", name: "New tag", enabled: true, conditions: [{ field: "bpm", min: 100 }], scopes: [], tagIds: ["new"], otherwiseTagIds: [] }]);
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: [], automaticRuleIds: ["rule"] }]);
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  await indexedDBStorage.redoBulkTagUpdate((await indexedDBStorage.getBulkEditHistory()).redo!.id);
  expect(readRules()[0].enabled).toBe(false);
  expect((await indexedDBStorage.getTrack(uri))!.dateModified).toBe(20);
});

it("changing a release opt-out does not discard redo or rewrite song dates", async () => {
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: ["new"], toRemove: [] }]);
  await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
  await indexedDBStorage.unlinkRecording("spotify:track:unannotated", true);
  expect((await indexedDBStorage.getBulkEditHistory()).redo).not.toBeNull();
  expect((await indexedDBStorage.getTrack(uri))!.dateModified).toBe(20);
});
