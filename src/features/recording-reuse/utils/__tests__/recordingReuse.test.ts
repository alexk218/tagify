import { expect, it } from "vitest";
import { detachInconsistentRecordingGroups, expandRecordingEdits, normalizeRecordingIdentity, sameRecording } from "../recordingReuse";
const identity = { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 180000, name: "Song (Original Mix)" };
it("requires a valid recording code, the same artists, duration, and full version name", () => {
  expect(normalizeRecordingIdentity(identity)).toEqual(identity);
  expect(sameRecording(identity, { ...identity, durationMs: 180900, name: "  song (original mix) " })).toBe(true);
  for (const change of [{ isrc: "USABC2400002" }, { artistIds: ["b".repeat(22)] }, { durationMs: 190000 }, { name: "Song (Live)" }, { name: "Song (Remastered)" }]) expect(sameRecording(identity, { ...identity, ...change })).toBe(false);
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
  expect(() => expandRecordingEdits({ a, b }, { a: { ...a, rating: 1 }, b: { ...b, rating: 2 } })).toThrow("Unlink");
});
