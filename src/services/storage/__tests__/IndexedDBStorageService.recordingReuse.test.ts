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
  await expect(indexedDBStorage.applyBulkTagUpdates([{ trackUri: "a", toAdd: [], toRemove: [], newRating: 1 }, { trackUri: "b", toAdd: [], toRemove: [], newRating: 2 }])).rejects.toThrow("different changes");
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

it("automatically links Heavynissen's three different recording codes and retains the link through backup, reload, edits, and unlink", async () => {
  const ids = ["0FM31M7JGTYVgwcXJRZyTi", "7vuklW2wWZysUHbQigchbX", "39vBNPpuGv5U6MlNMa346j"].map(id => `spotify:track:${id}`);
  const codes = ["US2641219402", "US2641005202", "US2641299902"];
  const tracks = Object.fromEntries(ids.map((uri, i) => [uri, { ...original, name: "Altering the Future", dateModified: 20 + i, recordingIdentity: { isrc: codes[i], artistIds: ["4f5V3PQ66nIrBCqugJtaGn"], durationMs: 334440, name: i === 1 ? "Altering The Future" : "Altering the Future" } }]));
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks });
  const review = Object.fromEntries(Object.entries(tracks).map(([uri, data]) => [uri, { identity: data.recordingIdentity, annotations: recordingAnnotations(data) }]));
  await indexedDBStorage.linkRecordings(review, ids[0], false, { automatic: true });
  const backup = normalizeTagDataStructure(JSON.parse(JSON.stringify(await indexedDBStorage.loadAllStrict())));
  expect(new Set(ids.map(uri => backup.tracks[uri].recordingGroupId)).size).toBe(1);
  ids.forEach((uri, i) => expect(backup.tracks[uri]).toMatchObject({ dateModified: 20 + i }));
  await indexedDBStorage.saveAll(backup);
  indexedDBStorage.resetConnection(); await indexedDBStorage.init();
  await indexedDBStorage.saveTrack(ids[1], { ...backup.tracks[ids[1]], energy: 9 });
  for (const uri of ids) expect(await indexedDBStorage.getTrack(uri)).toMatchObject({ energy: 9 });
  await indexedDBStorage.unlinkRecording(ids[2]);
  const unlinked = (await indexedDBStorage.getTrack(ids[2]))!;
  expect(unlinked.recordingGroupConfirmed).toBeUndefined();
  await indexedDBStorage.saveTrack(ids[0], { ...(await indexedDBStorage.getTrack(ids[0]))!, energy: 1 });
  expect((await indexedDBStorage.getTrack(ids[2]))!.energy).toBe(9);
  expect((await indexedDBStorage.getTrack(ids[1]))!.energy).toBe(1);
});

it("confirmation never bypasses artist, version, duration, or stale annotation checks", async () => {
  const review = await proposals();
  for (const change of [{ artistIds: ["b".repeat(22)] }, { name: "Song (Live)" }, { durationMs: 190000 }, { isrc: "invalid" }]) {
    await expect(indexedDBStorage.linkRecordings({ ...review, b: { ...review.b, identity: { ...identity, ...change } } }, "a", false, { confirmSimilar: true })).rejects.toThrow("same recording");
  }
  await indexedDBStorage.saveTrack("a", { ...original, rating: 5 });
  await expect(indexedDBStorage.linkRecordings(review, "a", false, { confirmSimilar: true })).rejects.toThrow("changed");
});

it("refuses partial relinking, deleted sources, and cross-account reviews without changing saved data", async () => {
  await indexedDBStorage.linkRecordings(await proposals(), "a", false);
  const linked = (await indexedDBStorage.loadAllStrict()).tracks;
  const review = { a: { identity, annotations: recordingAnnotations(linked.a) }, c: { identity, annotations: recordingAnnotations(undefined) } };
  await expect(indexedDBStorage.linkRecordings(review, "a", false)).rejects.toThrow("Linked releases have changed");
  expect((await indexedDBStorage.loadAllStrict()).tracks).toEqual(linked);
  const complete = await proposals();
  await expect(indexedDBStorage.linkRecordings(complete, "a", false, { expectedDatabaseName: "another-account" })).rejects.toThrow("account changed");
  await indexedDBStorage.deleteTrack("a");
  await expect(indexedDBStorage.linkRecordings(complete, "a", false)).rejects.toThrow("saved release");
  expect(await indexedDBStorage.getTrack("a")).toBeNull();
  expect(await indexedDBStorage.getTrack("b")).toEqual(linked.b);
});

it("restores an inconsistent duration chain as separate songs without dropping choices or moving dates", async () => {
  const tracks = {
    a: { ...original, recordingGroupId: "old-group", recordingIdentity: identity },
    b: { ...original, recordingGroupId: "old-group", recordingIdentity: { ...identity, durationMs: 179100 }, dateModified: 30 },
    c: { ...original, recordingGroupId: "old-group", recordingIdentity: { ...identity, durationMs: 180900 }, dateModified: 40 },
  };
  expect(await indexedDBStorage.saveAll(normalizeTagDataStructure({ ...defaultTagData, tracks }))).toBe(true);
  const saved = (await indexedDBStorage.loadAllStrict()).tracks;
  for (const uri of ["a", "b", "c"] as const) {
    expect(saved[uri]).toMatchObject({ rating: 3, energy: 4, tagIds: [], dateModified: tracks[uri].dateModified });
    expect(saved[uri].recordingGroupId).toBeUndefined();
  }
  await indexedDBStorage.saveTrack("a", { ...saved.a, rating: 5 });
  expect((await indexedDBStorage.getTrack("b"))!.rating).toBe(3);
  expect((await indexedDBStorage.getTrack("c"))!.rating).toBe(3);
});

it("reads complete affected groups through the index and rejects a different account", async () => {
  await indexedDBStorage.linkRecordings(await proposals(), "a", false);
  const a = (await indexedDBStorage.getTrack("a"))!;
  await indexedDBStorage.saveTrack("unrelated", original);
  const before = await indexedDBStorage.loadAllStrict();
  const all = vi.spyOn(indexedDBStorage, "loadAllStrict");
  expect(await indexedDBStorage.getRecordingGroupTracksStrict([a.recordingGroupId!, a.recordingGroupId!])).toEqual({ a: before.tracks.a, b: before.tracks.b });
  expect(await indexedDBStorage.getRecordingGroupTracksStrict(["absent"])).toEqual({});
  expect(all).not.toHaveBeenCalled();
  all.mockRestore();
  await expect(indexedDBStorage.getRecordingGroupTracksStrict([a.recordingGroupId!], "tagify-db:another")).rejects.toThrow("account changed");
});

it("fills only missing observed details and preserves newer annotations and absent dates", async () => {
  const old = { rating: 5, energy: 0, bpm: 112, tagIds: [], camelotKey: "11A" };
  await indexedDBStorage.saveTrack("legacy", old);
  await indexedDBStorage.rememberRecordingDetails("legacy", { name: "Seventh Ciel", artists: "SimbaSōl" });
  expect(await indexedDBStorage.getTrack("legacy")).toEqual({ ...old, name: "Seventh Ciel", artists: "SimbaSōl" });
  await indexedDBStorage.saveTrack("legacy", { ...old, name: "Newer title", rating: 4, dateModified: 123 });
  await indexedDBStorage.rememberRecordingDetails("legacy", { name: "Stale title", artists: "SimbaSōl" });
  expect(await indexedDBStorage.getTrack("legacy")).toEqual({ ...old, name: "Newer title", artists: "SimbaSōl", rating: 4, dateModified: 123 });
});

it("does not resurrect deleted songs or save observed details after cancellation or account change", async () => {
  expect(await indexedDBStorage.rememberRecordingDetails("missing", { name: "Song" })).toEqual({});
  expect(await indexedDBStorage.getTrack("missing")).toBeNull();
  expect(await indexedDBStorage.rememberRecordingDetails("a", { artists: "Artist" }, undefined, () => false)).toEqual({});
  expect(await indexedDBStorage.getTrack("a")).toEqual(original);
  const account = "tagify-db:recording-tests";
  localStorage.setItem("tagify:sync:account-id", "other-account");
  await expect(indexedDBStorage.rememberRecordingDetails("a", { artists: "Artist" }, account)).rejects.toThrow("account changed");
});

it("does not restore a deleted track when an older metadata backfill completes", async () => {
  await indexedDBStorage.deleteTrack("a");
  expect(await indexedDBStorage.saveTracks(new Map([["a", { ...original, artists: "Late metadata" }]]), { a: original }, { keepConcurrentChanges: true })).toBe(true);
  expect(await indexedDBStorage.getTrack("a")).toBeNull();
});
