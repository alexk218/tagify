// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { TrackEditHistory, editChanges } from "../TrackEditHistory";
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

const library = (size: number) => Object.fromEntries(Array.from({ length: size }, (_, index) => [`s${index}`, song(index % 5)]));

it("compares only the edited songs when a save names them, and finds the same changes as a full compare", () => {
  const before = library(2000);
  // A fresh copy of every record, as a reload would give, with one real edit and one deletion.
  const after: Record<string, ReturnType<typeof song> | null> = Object.fromEntries(Object.entries(before).map(([uri, track]) => [uri, { ...track }]));
  after.s7 = song(4);
  delete after.s9;
  const full = editChanges(before, after);
  expect(Object.keys(full).sort()).toEqual(["s7", "s9"]);
  const stringify = vi.spyOn(JSON, "stringify");
  try {
    expect(editChanges(before, after, ["s7", "s9"])).toEqual(full);
    // Two annotations per named song, nothing for the other 1,998.
    expect(stringify).toHaveBeenCalledTimes(4);
  } finally {
    stringify.mockRestore();
  }
});

it("skips unchanged records by reference in a full compare", () => {
  const before = library(2000);
  const after = { ...before, s3: song(2) };
  const stringify = vi.spyOn(JSON, "stringify");
  try {
    expect(Object.keys(editChanges(before, after))).toEqual(["s3"]);
    expect(stringify).toHaveBeenCalledTimes(2);
  } finally {
    stringify.mockRestore();
  }
});

it("records changes to linked releases and to songs already in the session when a save names its songs", () => {
  const session = history.select("bulk", ["a", "b"]);
  history.record(session, { a: song(1), b: song(1), linked: song(1) }, { a: song(2), b: song(1), linked: song(2) }, "saved", ["a", "linked"]);
  expect(Object.keys(history.getSnapshot().undo[0].changes).sort()).toEqual(["a", "linked"]);
  // "b" is in the session, so it is compared even when the save does not name it.
  history.record(session, { a: song(2), b: song(1) }, { a: song(2), b: song(3) }, "saved", []);
  expect(Object.keys(history.getSnapshot().undo[1].changes)).toEqual(["b"]);
});
