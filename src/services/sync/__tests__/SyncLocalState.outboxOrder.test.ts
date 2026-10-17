import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import type { TrackData } from "@/types/tagData";
import { setDesktopSyncConfiguration, type LocalSyncIntent } from "../SyncLocalState";
import { coalesceOutboxIntents } from "../SyncRuntime";
import { readStore, syncConfiguration } from "./fakeCommunity";

const SONG = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const track = (tagIds: string[]): TrackData => ({ rating: 0, energy: 0, bpm: null, camelotKey: null, tagIds, dateModified: 1_000 });

describe("queued changes keep the order they were made in", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    setDesktopSyncConfiguration(syncConfiguration("outbox-order-device"));
    expect(await storageService.switchAccountDatabase()).toBe(true);
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends a song's latest tags when it was cleared and tagged again within one millisecond", async () => {
    expect(await indexedDBStorage.saveTrack(SONG, track(["tag_calm"]))).toBe(true);
    // Deleting a folder clears the song, then the song is tagged again, all in one
    // millisecond (here even one before the first edit, as a clock can step back).
    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
    expect(await indexedDBStorage.deleteTrack(SONG)).toBe(true);
    expect(await indexedDBStorage.saveTrack(SONG, track(["tag_house"]))).toBe(true);
    expect(await indexedDBStorage.saveTrack(SONG, track(["tag_house", "tag_deep"]))).toBe(true);

    const outbox = (await readStore<LocalSyncIntent>("sync-outbox")).sort((left, right) => left.createdAt - right.createdAt);
    expect(new Set(outbox.map((intent) => intent.createdAt)).size).toBe(outbox.length);
    const [group] = coalesceOutboxIntents(outbox).groups;
    expect(group.intent.type).toBe("entity.replace");
    expect([...(group.intent as Extract<LocalSyncIntent, { type: "entity.replace" }>).desired.tagIds].sort()).toEqual(["tag_deep", "tag_house"]);
  });
});
