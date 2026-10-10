import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "../IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { normalizeTagDataStructure } from "@/features/tag-data/utils/tagData.schema";
import { recordingAnnotations } from "@/features/recording-reuse/utils/recordingReuse";
const identity = { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 180000, name: "Song" };
const original = { rating: 3, energy: 4, bpm: 120, tagIds: [], name: "Song", albumName: "Original", dateCreated: 10, dateModified: 20 };
beforeEach(async () => {
  indexedDBStorage.resetConnection(); vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("tagify:sync:account-id", "recording-tests"); await indexedDBStorage.init();
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { a: original, b: { ...original, rating: 0, energy: 0, albumName: "Compilation", dateModified: 30 } } });
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.unstubAllGlobals(); });
const proposals = async () => Object.fromEntries(Object.entries((await indexedDBStorage.loadAllStrict()).tracks).map(([uri, track]) => [uri, { identity, annotations: recordingAnnotations(track) }]));
it("links and propagates edits, keeps metadata dates stable, and unlinks without losing annotations", async () => {
  await indexedDBStorage.linkRecordings(await proposals(), "a", false);
  expect(await indexedDBStorage.getTrack("a")).toMatchObject({ ...original, recordingIdentity: identity });
  expect(await indexedDBStorage.getTrack("b")).toMatchObject({ rating: 3, energy: 4, albumName: "Compilation" });
  const a = (await indexedDBStorage.getTrack("a"))!;
  await indexedDBStorage.saveTrack("a", { ...a, rating: 5, dateModified: 99 });
  expect(await indexedDBStorage.getTrack("b")).toMatchObject({ rating: 5, albumName: "Compilation" });
  const beforeUnlink = (await indexedDBStorage.getTrack("b"))!;
  await indexedDBStorage.unlinkRecording("b");
  expect(await indexedDBStorage.getTrack("b")).toMatchObject({ rating: 5, dateModified: beforeUnlink.dateModified, recordingReuseDisabled: true });
  await indexedDBStorage.saveTrack("a", { ...(await indexedDBStorage.getTrack("a"))!, rating: 2 });
  expect((await indexedDBStorage.getTrack("b"))!.rating).toBe(5);
});
it("records every linked bulk change for undo, including after restart and file restore", async () => {
  await indexedDBStorage.linkRecordings(await proposals(), "a", false);
  const saved = normalizeTagDataStructure(await indexedDBStorage.loadAllStrict());
  expect(saved.tracks.a.recordingGroupId).toBe(saved.tracks.b.recordingGroupId);
  await indexedDBStorage.saveAll(saved);
  indexedDBStorage.resetConnection(); await indexedDBStorage.init();
  await indexedDBStorage.applyBulkTagUpdates([{ trackUri: "a", toAdd: [], toRemove: [], newRating: 1 }]);
  const undo = (await indexedDBStorage.getLatestBulkUndo())!;
  expect(Object.keys(undo.changes).sort()).toEqual(["a", "b"]);
  await indexedDBStorage.undoBulkTagUpdate(undo.id);
  expect((await indexedDBStorage.getTrack("a"))!.dateModified).toBe(20);
  expect((await indexedDBStorage.getTrack("b"))!.rating).toBe(3);
});
it("applies a remote annotation to linked copies without rewriting untouched metadata", async () => {
  await indexedDBStorage.linkRecordings(await proposals(), "a", false);
  const a = (await indexedDBStorage.getTrack("a"))!;
  await indexedDBStorage.saveTrack("a", { ...a, energy: 8, dateModified: 77 }, { captureSync: false });
  expect(await indexedDBStorage.getTrack("b")).toMatchObject({ energy: 8, albumName: "Compilation" });
  const enriched = (await indexedDBStorage.getTrack("a"))!;
  const before = (await indexedDBStorage.getTrack("b"))!;
  await indexedDBStorage.saveTrack("a", { ...enriched, albumImageUrl: "image" }, { captureSync: false });
  expect(await indexedDBStorage.getTrack("b")).toEqual(before);
});
it("refuses stale reviews, different recordings, conflicts, and different bulk edits to linked releases", async () => {
  const old = await proposals();
  await indexedDBStorage.saveTrack("b", { ...original, rating: 1 });
  await expect(indexedDBStorage.linkRecordings(old, "a", false)).rejects.toThrow("changed");
  const latest = await proposals();
  await expect(indexedDBStorage.linkRecordings(latest, "a", false)).rejects.toThrow("different tagging");
  await expect(indexedDBStorage.linkRecordings({ ...latest, b: { ...latest.b, identity: { ...identity, durationMs: 190000 } } }, "a", true)).rejects.toThrow("same recording");
  await indexedDBStorage.linkRecordings(latest, "a", true);
  await expect(indexedDBStorage.applyBulkTagUpdates([{ trackUri: "a", toAdd: [], toRemove: [], newRating: 1 }, { trackUri: "b", toAdd: [], toRemove: [], newRating: 2 }])).rejects.toThrow("Unlink");
  expect((await indexedDBStorage.getTrack("a"))!.rating).toBe(3);
});

it("remembers confirmed identities without rewriting dates, losing new choices, or recreating a deleted song", async () => {
  await indexedDBStorage.saveTrack("a", { ...original, rating: 5, dateModified: 99 });
  await indexedDBStorage.rememberRecordingIdentities({ a: identity, missing: identity });
  expect(await indexedDBStorage.getTrack("a")).toMatchObject({ rating: 5, dateModified: 99, recordingIdentity: identity });
  expect(await indexedDBStorage.getTrack("missing")).toBeNull();
});

it("consolidates explicit choices atomically while retaining each existing date and release metadata", async () => {
  await indexedDBStorage.saveTrack("b", { ...original, rating: 1, albumName: "Compilation", dateModified: 30 });
  const review = await proposals();
  const changes = await indexedDBStorage.linkRecordings(review, "a", false, { automatic: true, choices: { rating: 1, energy: 4, tagIds: [] } });
  expect(changes.a).toMatchObject({ rating: 1, dateModified: 20, dateCreated: 10, albumName: "Original" });
  expect(changes.b).toMatchObject({ rating: 1, dateModified: 30, albumName: "Compilation" });
  expect(changes.a.recordingGroupId).toBe(changes.b.recordingGroupId);
  await expect(indexedDBStorage.linkRecordings(review, "a", false, { automatic: true, choices: { rating: 5, energy: 4, tagIds: [] } })).rejects.toThrow("changed");
});

it("a pending edit from before matching preserves the new link and propagates only the user's changed field", async () => {
  const before = (await indexedDBStorage.loadAllStrict()).tracks;
  await indexedDBStorage.linkRecordings(await proposals(), "a", false, { automatic: true });
  await indexedDBStorage.saveTracks(new Map([["b", { ...before.b, rating: 5, dateModified: 99 }]]), before);
  const after = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(after.b).toMatchObject({ rating: 5, energy: 4, recordingIdentity: identity, dateModified: 99 });
  expect(after.a).toMatchObject({ rating: 5, energy: 4 });
  expect(after.a.recordingGroupId).toBe(after.b.recordingGroupId);
});

it("rejects a cancelled check, a changed account, and tags removed during review", async () => {
  const review = await proposals();
  await expect(indexedDBStorage.linkRecordings(review, "a", false, { automatic: true, isCurrent: () => false })).rejects.toThrow("changed");
  await expect(indexedDBStorage.linkRecordings(review, "a", false, { automatic: true, choices: { rating: 3, energy: 4, tagIds: ["deleted"] } })).rejects.toThrow("tags have changed");
  await expect(indexedDBStorage.rememberRecordingIdentities({ a: identity }, "another-account")).rejects.toThrow("account changed");
});
