// @vitest-environment node
import { beforeEach, expect, it } from "vitest";
import { TrackEditHistory } from "../TrackEditHistory";
const song = (rating: number) => ({ rating, energy: 0, bpm: null, tagIds: [], dateModified: rating });
let history: TrackEditHistory;
beforeEach(() => { localStorage.clear(); history = new TrackEditHistory(); });
it("finalizes both stacks when a song changes, including a return visit", () => {
  const a = history.select("single", ["a"]);
  history.record(a, { a: song(1) }, { a: song(2) }, "saved");
  history.select("single", ["b"]);
  expect(history.getSnapshot().undo).toEqual([]);
  history.record(a, { a: song(2) }, { a: song(3) }, "saved");
  expect(history.getSnapshot().undo).toEqual([]);
  history.select("single", ["a"]);
  expect(history.capture("single", ["a"])?.id).not.toBe(a.id);
  expect(history.getSnapshot().redo).toEqual([]);
});
it("uses bulk membership, not row order, and resets between selections and modes", () => {
  const batch = history.select("bulk", ["a", "b"]);
  history.record(batch, { a: song(1) }, { a: song(2) }, "saved");
  expect(history.select("bulk", ["b", "a"]).id).toBe(batch.id);
  expect(history.getSnapshot().undo).toHaveLength(1);
  history.select("bulk", ["b", "c"]);
  expect(history.getSnapshot().undo).toEqual([]);
  history.select("single", ["b"]);
  expect(history.getSnapshot().undo).toEqual([]);
});
it("ignores metadata-only edits and snapshots data so later mutation cannot rewrite history", () => {
  const session = history.select("single", ["a"]);
  history.record(session, { a: song(1) }, { a: { ...song(1), name: "New title", dateModified: 100 } }, "saved");
  expect(history.getSnapshot().undo).toEqual([]);
  const after = song(2);
  history.record(session, { a: song(1) }, { a: after }, "saved");
  after.rating = 5;
  expect(history.getSnapshot().undo[0].changes.a.after?.rating).toBe(2);
});
it("compacts bulk drafts at Save and keeps earlier saved batches", () => {
  const session = history.select("bulk", ["a", "b"]);
  history.record(session, { a: song(1) }, { a: song(2) }, "saved");
  history.record(session, { a: song(2) }, { a: song(3) }, "draft");
  history.record(session, { a: song(3) }, { a: song(4) }, "draft");
  history.record(session, { a: song(2) }, { a: song(4) }, "saved");
  expect(history.getSnapshot().undo.map(entry => entry.kind)).toEqual(["saved", "saved"]);
});
it("does not complete an old operation or expose it in a new account", () => {
  const session = history.select("single", ["a"]);
  history.record(session, { a: song(1) }, { a: song(2) }, "saved");
  const operation = history.begin("undo")!;
  localStorage.setItem("tagify:sync:account-id", "different-account");
  expect(history.isPending(session, "undo", operation.entry.id)).toBe(false);
  history.select("single", ["a"]);
  history.finish(session, "undo", operation.entry.id, operation.entry);
  expect(history.getSnapshot()).toMatchObject({ undo: [], redo: [], busy: false });
});

it("keeps unrelated history, but explicit consolidation starts a fresh visit for affected songs", () => {
  const session = history.select("single", ["a"]);
  history.record(session, { a: song(1) }, { a: song(2) }, "saved");
  expect(history.hasEditsFor(["a"])).toBe(true);
  expect(history.hasEditsFor(["b"])).toBe(false);
  history.resetForTracks(["b"]);
  expect(history.getSnapshot().undo).toHaveLength(1);
  history.resetForTracks(["a"]);
  expect(history.getSnapshot().undo).toEqual([]);
  const next = history.capture("single", ["a"]);
  expect(next?.id).not.toBe(session.id);
  history.record(next, { a: song(2) }, { a: song(3) }, "saved");
  expect(history.getSnapshot().undo).toHaveLength(1);
});
