import { describe, expect, it } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { mergeTagIds, rebaseRecord, rebaseTagData } from "../tagData.rebase";

const track = (tagIds: string[], extra: Partial<TrackData> = {}): TrackData => ({
  rating: 0, energy: 0, bpm: null, tagIds, dateModified: 1, ...extra,
});

describe("mergeTagIds", () => {
  it("keeps tags another edit added at the same time", () => {
    expect(mergeTagIds(["a"], ["a", "b"], ["a", "c"])).toEqual(["a", "c", "b"]);
  });

  it("removes only the tags this edit removed", () => {
    expect(mergeTagIds(["a", "b"], ["a"], ["a", "b", "c"])).toEqual(["a", "c"]);
  });

  it("uses the edited order when nothing else changed", () => {
    expect(mergeTagIds(["a", "b"], ["b", "a"], ["a", "b"])).toEqual(["b", "a"]);
  });
});

describe("rebaseRecord", () => {
  it("applies only the fields this edit changed", () => {
    const before = track(["a"], { rating: 3 });
    const edited = track(["a"], { rating: 5 });
    const current = track(["a", "b"], { rating: 3, bpm: 120 });
    expect(rebaseRecord(before, edited, current)).toEqual(track(["a", "b"], { rating: 5, bpm: 120 }));
  });

  it("never replaces a value someone changed meanwhile when asked to keep it", () => {
    const before = track([], { bpm: null });
    const filled = track([], { bpm: 72 });
    const current = track(["a"], { bpm: 128 });
    expect(rebaseRecord(before, filled, current, { keepConcurrentChanges: true })).toEqual(track(["a"], { bpm: 128 }));
  });

  it("combines a new record with one created elsewhere at the same time", () => {
    expect(rebaseRecord(undefined, track(["a"], { rating: 4 }), track(["b"]))?.tagIds).toEqual(["b", "a"]);
  });

  it("keeps an edited record that was removed elsewhere", () => {
    const edited = track(["a", "b"]);
    expect(rebaseRecord(track(["a"]), edited, undefined)).toBe(edited);
  });
});

describe("rebaseTagData", () => {
  const library = (tracks: Record<string, TrackData>): TagDataStructure => ({ ...defaultTagData, tracks });

  it("re-applies unsaved edits to a newer saved library", () => {
    const base = library({ x: track(["a"]), y: track([]) });
    const local = { ...base, tracks: { ...base.tracks, x: track(["a", "b"]) } };
    const incoming = library({ x: track(["a", "c"]), y: track(["remote"]) });
    expect(rebaseTagData(base, local, incoming).tracks).toEqual({ x: track(["a", "c", "b"]), y: track(["remote"]) });
  });

  it("returns the saved library itself when there is nothing unsaved", () => {
    const base = library({ x: track(["a"]) });
    const incoming = library({ x: track(["a", "c"]) });
    expect(rebaseTagData(base, base, incoming)).toBe(incoming);
  });

  it("keeps a local removal", () => {
    const base = library({ x: track(["a"]) });
    const local = library({});
    expect(rebaseTagData(base, local, library({ x: track(["a"], { rating: 2 }) })).tracks).toEqual({});
  });
});
