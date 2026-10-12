import { expect, it } from "vitest";
import { detachInconsistentRecordingGroups, expandRecordingEdits, normalizeRecordingIdentity, sameRecording } from "../recordingReuse";
const identity = { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 180000, name: "Song (Original Mix)" };
it("requires a valid recording code, the same artists, duration, and full version name", () => {
  expect(normalizeRecordingIdentity(identity)).toEqual(identity);
  expect(sameRecording(identity, { ...identity, durationMs: 180900, name: "  song (original mix) " })).toBe(true);
  for (const change of [{ isrc: "USABC2400002", durationMs: 180001 }, { artistIds: ["b".repeat(22)] }, { durationMs: 190000 }, { name: "Song (Live)" }, { name: "Song (Remastered)" }]) expect(sameRecording(identity, { ...identity, ...change })).toBe(false);
  expect(normalizeRecordingIdentity({ ...identity, isrc: "unknown" })).toBeUndefined();
});
it("keeps independent restored annotations and timestamps when an old local link conflicts", () => {
  const a = { rating: 3, energy: 4, bpm: 120, tagIds: [], recordingGroupId: "group", recordingIdentity: identity, dateModified: 20 };
  const b = { ...a, rating: 5, dateModified: 30 };
  const restored = detachInconsistentRecordingGroups({ a, b });
  expect(restored.a).toEqual({ ...a, recordingGroupId: undefined });
  expect(restored.b).toEqual({ ...b, recordingGroupId: undefined });
});
it("copies changed annotations across links, preserving each release's details and separate fields", () => {
  const a = { rating: 3, energy: 4, bpm: 120, tagIds: ["a"], recordingGroupId: "group", recordingIdentity: identity, name: "A", dateModified: 20 };
  const b = { ...a, name: "B", bpm: 121 };
  const result = expandRecordingEdits({ a, b }, { a: { ...a, rating: 5, tagIds: [] } });
  expect(result.b).toMatchObject({ rating: 5, energy: 4, tagIds: [], bpm: 121, name: "B" });
  expect(expandRecordingEdits({ a, b }, { a: { ...a, albumName: "Enriched" } })).not.toHaveProperty("b");
  expect(() => expandRecordingEdits({ a, b }, { a: { ...a, rating: 1 }, b: { ...b, rating: 2 } })).toThrow("different changes");
});

it("retains reviewed different-code links but detaches unconfirmed or conflicting restores", async () => {
  const { recordingDisplayKeys } = await import("../recordingLibrary");
  const a = { rating: 3, energy: 4, bpm: 120, tagIds: [], recordingGroupId: "group", recordingGroupConfirmed: true, recordingIdentity: identity, dateModified: 20 };
  const b = { ...a, recordingIdentity: { ...identity, isrc: "USABC2400002", durationMs: 180500 }, dateModified: 30 };
  const uris = ["a", "b"].map(id => `spotify:track:${id.repeat(22)}`);
  expect(detachInconsistentRecordingGroups({ a, b })).toEqual({ a, b });
  expect(recordingDisplayKeys({ [uris[0]]: a, [uris[1]]: b }).size).toBe(2);
  expect(expandRecordingEdits({ a, b }, { b: { ...b, energy: 8 } }).a?.energy).toBe(8);
  for (const changed of [{ ...b, rating: 5 }, { ...b, recordingGroupConfirmed: undefined }, { ...b, recordingIdentity: { ...b.recordingIdentity, name: "Song (Live)" } }]) {
    const result = detachInconsistentRecordingGroups({ a, b: changed });
    expect(result.a.recordingGroupId).toBeUndefined();
    expect(result.a.recordingGroupConfirmed).toBeUndefined();
    expect(result.b.dateModified).toBe(30);
    expect(recordingDisplayKeys({ [uris[0]]: a, [uris[1]]: changed }).size).toBe(0);
  }
});


it("rejects a restored chain of near matches even when every copy matches the first", () => {
  const a = { rating: 3, energy: 4, bpm: null, tagIds: [], recordingGroupId: "group", recordingIdentity: identity, dateModified: 20 };
  const b = { ...a, recordingIdentity: { ...identity, durationMs: 179100 }, dateModified: 30 };
  const c = { ...a, recordingIdentity: { ...identity, durationMs: 180900 }, dateModified: 40 };
  const restored = detachInconsistentRecordingGroups({ a, b, c });
  expect(Object.values(restored).map(track => track.recordingGroupId)).toEqual([undefined, undefined, undefined]);
  expect(Object.values(restored).map(track => track.dateModified)).toEqual([20, 30, 40]);
  expect(() => expandRecordingEdits({ a, b, c }, { a: { ...a, rating: 5 } })).toThrow("saved copies have changed");
});
