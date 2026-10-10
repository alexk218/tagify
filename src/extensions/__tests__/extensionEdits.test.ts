import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import {
  editSavedEntity,
  editSavedTrack,
  EDIT_NOT_SAVED_MESSAGE,
  getEditErrorMessage,
  LIBRARY_UNAVAILABLE_MESSAGE,
  LibraryUnavailableError,
  readSavedLibrary,
  saveTrackEdits,
} from "../extensionEdits";

const song: TrackData = {
  name: "Slide", artists: "Low", rating: 3, energy: 4, bpm: 120, camelotKey: "8A",
  tagIds: ["rock"], dateCreated: 1_000, dateModified: 1_000,
};

describe("editing a saved song", () => {
  it("changes only the edited value and records the edit time", () => {
    expect(editSavedTrack(song, { rating: 4.5 }, 2_000)).toEqual({ ...song, rating: 4.5, dateModified: 2_000 });
    expect(editSavedTrack(song, { addTagIds: ["jazz"] }, 2_000)).toEqual({ ...song, tagIds: ["rock", "jazz"], dateModified: 2_000 });
    expect(editSavedTrack(song, { removeTagIds: ["rock"] }, 2_000)).toEqual({ ...song, tagIds: [], dateModified: 2_000 });
  });

  it("leaves a song and its Last Updated time alone when nothing changes", () => {
    expect(editSavedTrack(song, { addTagIds: ["rock"] }, 2_000)).toBeUndefined();
    expect(editSavedTrack(song, { rating: 3 }, 2_000)).toBeUndefined();
    expect(editSavedTrack(song, { rating: 4.25, energy: 11 }, 2_000)).toBeUndefined();
    expect(editSavedTrack(null, { rating: 0 }, 2_000)).toBeUndefined();
  });

  it("keeps a rating it can't show when only tags change", () => {
    const imported = { ...song, rating: 4.25 };
    expect(editSavedTrack(imported, { addTagIds: ["jazz"] }, 2_000)).toMatchObject({ rating: 4.25, tagIds: ["rock", "jazz"] });
  });

  it("clears a value only when the saved song already has it", () => {
    expect(editSavedTrack(song, { toggleRating: 3 }, 2_000)).toMatchObject({ rating: 0 });
    expect(editSavedTrack(song, { toggleRating: 4 }, 2_000)).toMatchObject({ rating: 4 });
    expect(editSavedTrack(song, { toggleEnergy: 4 }, 2_000)).toMatchObject({ energy: 0 });
  });

  it("removes a song left without ratings or tags, unless its releases are linked", () => {
    const rated = { ...song, energy: 0, tagIds: [] };
    expect(editSavedTrack(rated, { rating: 0 }, 2_000)).toBeNull();
    expect(editSavedTrack({ ...rated, recordingGroupId: "group" }, { rating: 0 }, 2_000)).toMatchObject({ rating: 0 });
  });

  it("starts a new song from its details", () => {
    expect(editSavedTrack(null, { rating: 4 }, 2_000, { name: "Slide", artists: "Low" })).toEqual({
      name: "Slide", artists: "Low", bpm: null, camelotKey: null, rating: 4, energy: 0, tagIds: [],
      dateCreated: 2_000, dateModified: 2_000,
    });
  });

  it("edits playlists and artists the same way", () => {
    const album = { name: "Double Negative", rating: 0, energy: 0, tagIds: ["rock"], dateModified: 1_000 };
    expect(editSavedEntity(album, { toggleRating: 4 }, 2_000)).toMatchObject({ rating: 4, tagIds: ["rock"], dateModified: 2_000 });
    expect(editSavedEntity(album, { removeTagIds: ["rock"] }, 2_000)).toBeNull();
    expect(editSavedEntity(null, { toggleEnergy: 6 }, 2_000, { name: "Low" })).toMatchObject({ name: "Low", energy: 6, dateCreated: 2_000 });
  });

  it("explains failures in plain language", () => {
    expect(getEditErrorMessage(new LibraryUnavailableError())).toBe(LIBRARY_UNAVAILABLE_MESSAGE);
    expect(getEditErrorMessage(new Error("Transaction aborted"))).toBe(EDIT_NOT_SAVED_MESSAGE);
  });
});

describe("saving edits to the saved library", () => {
  const first = `spotify:track:${"f".repeat(22)}`;
  const second = `spotify:track:${"g".repeat(22)}`;
  const tagId = (name: string) =>
    Object.values(defaultTagData.taxonomy.tagsById).find((tag) => tag.name === name)!.id;
  const [rock, pop, jazz] = [tagId("Rock"), tagId("Pop"), tagId("Jazz")];

  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    indexedDBStorage.resetConnection();
    localStorage.setItem("tagify:idb-migration-status", JSON.stringify({ status: "completed" }));
    expect(await indexedDBStorage.init()).toBe(true);
    expect(await indexedDBStorage.saveAll({
      ...JSON.parse(JSON.stringify(defaultTagData)),
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      tracks: { [first]: { ...song, tagIds: [rock] }, [second]: { ...song, tagIds: [pop], rating: 1 } },
    } as TagDataStructure)).toBe(true);
    expect((await storageService.initialize()).status).toBe("ready");
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("adds a tag to each selected song's saved tags and can undo it", async () => {
    const saved = await saveTrackEdits([first, second, first], { addTagIds: [jazz] }, { undoable: true });

    expect(saved[first]?.tagIds).toEqual([rock, jazz]);
    expect(saved[second]?.tagIds).toEqual([pop, jazz]);
    const entry = await indexedDBStorage.getLatestBulkUndo();
    expect(Object.keys(entry!.changes).sort()).toEqual([first, second].sort());

    await indexedDBStorage.undoBulkTagUpdate(entry!.id);
    const { tracks } = await indexedDBStorage.loadAllStrict();
    expect(tracks[first].tagIds).toEqual([rock]);
    expect(tracks[second].tagIds).toEqual([pop]);
  });

  it("doesn't add single-song edits to the bulk undo history", async () => {
    await saveTrackEdits([first], { rating: 5 });
    expect(await indexedDBStorage.getLatestBulkUndo()).toBeNull();
  });

  it("returns linked releases that changed with the edited song", async () => {
    const identity = { isrc: "USRC17607839", artistIds: ["low"], durationMs: 200_000, name: "Slide" };
    await indexedDBStorage.saveTracks(new Map([
      [first, { ...song, recordingIdentity: identity, recordingGroupId: "group" }],
      [second, { ...song, recordingIdentity: identity, recordingGroupId: "group" }],
    ]));

    const saved = await saveTrackEdits([first], { rating: 5 });
    expect(saved[first]?.rating).toBe(5);
    expect(saved[second]?.rating).toBe(5);
  });

  it("reports a library that can't be read instead of an empty one", async () => {
    vi.spyOn(indexedDBStorage, "loadAllStrict").mockRejectedValueOnce(new Error("read failed"));
    await expect(readSavedLibrary()).rejects.toBeInstanceOf(LibraryUnavailableError);
  });
});
