import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { PlaylistData, TagDataStructure, TrackData } from "@/types/tagData";
import { indexedDBStorage } from "../IndexedDBStorageService";
import { storageService } from "../StorageService";

const uri = `spotify:track:${"c".repeat(22)}`;
const albumUri = `spotify:album:${"d".repeat(22)}`;
const song: TrackData = { name: "Song", artists: "Artist", rating: 3, energy: 0, bpm: null, tagIds: ["rock"], dateModified: 10 };
const album: PlaylistData = { name: "Unknown Album", rating: 0, energy: 0, tagIds: ["rock"], dateModified: 10 } as PlaylistData;

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { [uri]: song }, playlists: { [albumUri]: album } } as TagDataStructure)).toBe(true);
});
afterEach(() => { indexedDBStorage.resetConnection(); vi.unstubAllGlobals(); });

it("keeps tags saved by two editors working from the same copy", async () => {
  await indexedDBStorage.saveTracks(new Map([[uri, { ...song, tagIds: ["rock", "pop"] }]]), { [uri]: song });
  await indexedDBStorage.saveTracks(new Map([[uri, { ...song, tagIds: ["rock", "jazz"], rating: 5 }]]), { [uri]: song });
  expect((await indexedDBStorage.loadAllStrict()).tracks[uri]).toMatchObject({ tagIds: ["rock", "pop", "jazz"], rating: 5 });
});

it("fills missing details without touching tags, ratings, or Last Updated", async () => {
  await indexedDBStorage.saveTracks(new Map([[uri, { ...song, tagIds: ["rock", "pop"], rating: 4, dateModified: 20 }]]), { [uri]: song });
  await indexedDBStorage.saveTracks(new Map([[uri, { ...song, bpm: 90, camelotKey: "8A" }]]), { [uri]: song }, { keepConcurrentChanges: true });
  await indexedDBStorage.savePlaylists(new Map([[albumUri, { ...album, tagIds: ["rock", "pop"], dateModified: 20 }]]), { [albumUri]: album });
  await indexedDBStorage.savePlaylists(new Map([[albumUri, { ...album, name: "Double Negative" }]]), { [albumUri]: album }, { keepConcurrentChanges: true });

  const saved = await indexedDBStorage.loadAllStrict();
  expect(saved.tracks[uri]).toMatchObject({ tagIds: ["rock", "pop"], rating: 4, bpm: 90, camelotKey: "8A", dateModified: 20 });
  expect(saved.playlists[albumUri]).toMatchObject({ tagIds: ["rock", "pop"], name: "Double Negative", dateModified: 20 });
});

it("reports a failed read instead of an empty library", async () => {
  vi.spyOn(storageService, "isReady").mockReturnValue(true);
  vi.spyOn(indexedDBStorage, "loadAllStrict").mockRejectedValueOnce(new Error("read failed"));
  await expect(storageService.loadAll()).rejects.toThrow("read failed");
  vi.restoreAllMocks();
});

it("changes a saved track from its current saved record", async () => {
  await indexedDBStorage.saveTracks(new Map([[uri, { ...song, tagIds: ["rock", "pop"] }]]), { [uri]: song });
  const result = await indexedDBStorage.patchTracks({
    [uri]: (current) => current && { ...current, rating: 5 },
    "spotify:track:untouched": () => undefined,
  });
  expect(result).toEqual({ [uri]: expect.objectContaining({ tagIds: ["rock", "pop"], rating: 5 }) });
  expect((await indexedDBStorage.loadAllStrict()).tracks[uri]).toMatchObject({ tagIds: ["rock", "pop"], rating: 5 });
});

it("keeps a song the page removed when a tag was added to it elsewhere meanwhile", async () => {
  const { persistTagDataDiff } = await import("@/features/tag-data/utils/tagData.persistence");
  const before = await indexedDBStorage.loadAllStrict();
  await indexedDBStorage.saveTracks(new Map([[uri, { ...song, tagIds: ["rock", "lofi"] }]]), { [uri]: song });
  const other = `spotify:track:${"f".repeat(22)}`;
  await indexedDBStorage.saveTracks(new Map([[other, { ...song, name: "Other" }]]));
  const withOther = { ...before, tracks: { ...before.tracks, [other]: { ...song, name: "Other" } } };

  expect(await persistTagDataDiff(withOther, { ...withOther, tracks: {} })).toBe(true);

  const saved = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(saved[uri]).toMatchObject({ tagIds: ["lofi"], rating: 0 });
  expect(saved[other]).toBeUndefined();
});
