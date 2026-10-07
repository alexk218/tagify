import { describe, expect, it } from "vitest";
import {
  chunkLocalFileEntries,
  localFileEntries,
  planIncomingLocalFiles,
  planOutgoingLocalFiles,
} from "../LocalFileBackup";
import type { TrackData } from "@/types/tagData";

const SONG = "spotify:local:My+Band:Demo:Track+One:215";
const OTHER = "spotify:local:My+Band:Demo:Track+Two:180";
const track = (overrides: Partial<TrackData> = {}): TrackData => ({ rating: 4, energy: 6, bpm: 120, camelotKey: "8A", tagIds: ["house"], dateCreated: 100, dateModified: 200, name: "Track One", ...overrides });

describe("local-file backup planning", () => {
  it("backs up only local files, with their tags, ratings, and dates", () => {
    const entries = localFileEntries({ [SONG]: track(), "spotify:track:4uLU6hMCjMI75M1A2tKUQC": track() });
    expect(Object.keys(entries)).toEqual([SONG]);
    expect(entries[SONG]).toMatchObject({ updatedAt: 200, rating: 4, energy: 6, bpm: 120, camelotKey: "8A", tagIds: ["house"], dateCreated: 100, dateModified: 200, name: "Track One" });
  });

  it("restores local files onto a device that has none", () => {
    const remote = localFileEntries({ [SONG]: track() });
    expect(planIncomingLocalFiles(remote, {}, {})).toEqual({ save: { [SONG]: expect.objectContaining({ rating: 4, tagIds: ["house"], dateModified: 200 }) }, remove: [] });
  });

  it("keeps this device's newer edit and takes Community's newer one", () => {
    const remote = localFileEntries({ [SONG]: track({ rating: 2, dateModified: 300 }), [OTHER]: track({ rating: 1, dateModified: 100 }) });
    const plan = planIncomingLocalFiles(remote, { [SONG]: track({ dateModified: 250 }), [OTHER]: track({ rating: 5, dateModified: 400 }) }, {});
    expect(plan.save[SONG]).toMatchObject({ rating: 2, dateModified: 300 });
    expect(plan.save[OTHER]).toBeUndefined();
  });

  it("does not bring back a file removed on this device since the last sync", () => {
    const known = localFileEntries({ [SONG]: track() });
    expect(planIncomingLocalFiles(known, {}, known)).toEqual({ save: {}, remove: [] });
    expect(planOutgoingLocalFiles({}, known, 1_000)).toEqual({ [SONG]: { updatedAt: 1_000, deleted: true } });
  });

  it("applies a newer deletion from another device", () => {
    const plan = planIncomingLocalFiles({ [SONG]: { updatedAt: 500, deleted: true } }, { [SONG]: track() }, localFileEntries({ [SONG]: track() }));
    expect(plan.remove).toEqual([SONG]);
  });

  it("sends only entries that changed since the last sync", () => {
    const known = localFileEntries({ [SONG]: track(), [OTHER]: track() });
    const local = localFileEntries({ [SONG]: track(), [OTHER]: track({ rating: 5, dateModified: 900 }) });
    expect(Object.keys(planOutgoingLocalFiles(local, known, 1_000))).toEqual([OTHER]);
  });

  it("splits a large backup into requests under the size limit", () => {
    const entries = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`spotify:local:A:B:Song+${index}:1`, { updatedAt: index, tagIds: ["x".repeat(200)] }]));
    const chunks = chunkLocalFileEntries(entries, 2_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.reduce((total, chunk) => total + Object.keys(chunk).length, 0)).toBe(50);
    chunks.forEach((chunk) => expect(new TextEncoder().encode(JSON.stringify(chunk)).byteLength).toBeLessThanOrEqual(2_100));
  });
});
