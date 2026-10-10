import { IDBFactory, IDBTransaction as FakeIDBTransaction } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import type { PublicationPolicyV1 } from "@tagify/community-contracts";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { indexedDBStorage } from "../IndexedDBStorageService";
import { buildTagifyBackupEnvelopeV2, extractTagDataFromBackup, validateTagDataBackup } from "@/features/tag-data/utils/tagData.backup";
import { normalizeTagDataStructure } from "@/features/tag-data/utils/tagData.schema";

const uri = `spotify:track:${"a".repeat(22)}`;
const song: TrackData = { name: "Song", artists: "Artist", rating: 4, energy: 6, bpm: 120, tagIds: [], dateModified: 1_000 };
const library = (tracks: Record<string, TrackData>): TagDataStructure => ({ ...defaultTagData, tracks, smartPlaylists: [] });

/** Waits briefly; a save that never settles reports "still waiting" instead of hanging the test. */
function settled<T>(promise: Promise<T>): Promise<T | "still waiting"> {
  return Promise.race([promise, new Promise<"still waiting">((resolve) => setTimeout(() => resolve("still waiting"), 1_000))]);
}

/**
 * Makes the next readwrite transactions fail while committing, as browsers do
 * when the device runs out of space: every request succeeds, then only
 * `abort` fires (no `error` event and no `complete`).
 */
function failCommits() {
  type FakeTransactionInternals = {
    _start(): void;
    _abort(name: string): void;
    _requests: Array<{ request: { readyState: string } }>;
    _state: string;
    mode: IDBTransactionMode;
  };
  const prototype = FakeIDBTransaction.prototype as unknown as FakeTransactionInternals;
  const start = prototype._start;
  return vi.spyOn(prototype, "_start").mockImplementation(function (this: FakeTransactionInternals) {
    const pending = this._requests.some(({ request }) => request.readyState !== "done");
    if (!pending && this.mode === "readwrite" && this._state !== "finished") {
      this._abort("QuotaExceededError");
      return;
    }
    start.call(this);
  });
}

async function writeOnlyLegacyCategories(categories: unknown[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(getTagifyDatabaseName());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("categories", "readwrite");
    transaction.objectStore("categories").clear();
    transaction.objectStore("categories").put({ id: "categories", data: categories });
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
  db.close();
}

const legacyCategories = [{
  id: "genre",
  name: "Genre",
  subcategories: [{ id: "electronic", name: "Electronic", tags: [{ id: "house", name: "House" }] }],
}];

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll(library({ [uri]: song }))).toBe(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  indexedDBStorage.resetConnection();
  vi.unstubAllGlobals();
});

describe("saving when the device can't finish a save", () => {
  it("reports every failed write instead of leaving it waiting forever", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    failCommits();
    const playlistUri = `spotify:playlist:${"p".repeat(22)}`;
    const artistUri = `spotify:artist:${"r".repeat(22)}`;
    const results = {
      saveAll: await settled(indexedDBStorage.saveAll(library({}))),
      saveTrackChanges: await settled(indexedDBStorage.saveTrackChanges(new Map([[uri, { ...song, rating: 5 }]]))),
      deleteTrack: await settled(indexedDBStorage.deleteTrack(uri)),
      savePlaylist: await settled(indexedDBStorage.savePlaylist(playlistUri, { rating: 3, energy: 0, tagIds: [] })),
      deletePlaylist: await settled(indexedDBStorage.deletePlaylist(playlistUri)),
      saveArtist: await settled(indexedDBStorage.saveArtist(artistUri, { rating: 3, energy: 0, tagIds: [] })),
      deleteArtist: await settled(indexedDBStorage.deleteArtist(artistUri)),
      saveTaxonomy: await settled(indexedDBStorage.saveTaxonomy(createEmptyTaxonomy())),
      clearAll: await settled(indexedDBStorage.clearAll()),
      restoreCommunityBackupState: await settled(indexedDBStorage.restoreCommunityBackupState({
        publicationPolicy: null, ownerIdentityMapping: null, installations: [],
      })),
      saveCommunityPublicationPolicy: await settled(indexedDBStorage.saveCommunityPublicationPolicy({} as PublicationPolicyV1)),
    };

    expect(results).toEqual(Object.fromEntries(Object.keys(results).map((name) => [name, false])));
    vi.restoreAllMocks();
    expect((await indexedDBStorage.loadAllStrict()).tracks[uri]).toMatchObject({ rating: 4, dateModified: 1_000 });
  });

  it("keeps the saved library when replacing it fails partway", async () => {
    const unstorable = { ...song, name: (() => "not storable") as unknown as string };

    expect(await indexedDBStorage.saveAll(library({ "spotify:track:new": song, "spotify:track:bad": unstorable }))).toBe(false);

    expect(Object.keys((await indexedDBStorage.loadAllStrict()).tracks)).toEqual([uri]);
  });

  it("keeps Community details when restoring them fails partway", async () => {
    const policy = { version: 1 } as unknown as PublicationPolicyV1;
    expect(await indexedDBStorage.saveCommunityPublicationPolicy(policy)).toBe(true);

    expect(await indexedDBStorage.restoreCommunityBackupState({
      publicationPolicy: null,
      ownerIdentityMapping: null,
      // An installation without its identity can't be stored.
      installations: [{} as never],
    })).toBe(false);

    expect(await indexedDBStorage.getCommunityPublicationPolicy()).toEqual(policy);
  });
});

describe("telling an unreadable library apart from an empty one", () => {
  it("reports counts it can't read instead of zero", async () => {
    indexedDBStorage.resetConnection();
    vi.spyOn(indexedDBStorage, "init").mockResolvedValue(false);

    await expect(indexedDBStorage.getTrackCount()).rejects.toThrow();
    await expect(indexedDBStorage.getPlaylistCount()).rejects.toThrow();
    await expect(indexedDBStorage.getArtistCount()).rejects.toThrow();
    await expect(indexedDBStorage.isInitialized()).rejects.toThrow();
  });

  it("replaces only a library confirmed empty in the same step", async () => {
    const olderCopy = library({ "spotify:track:older": song });

    expect(await indexedDBStorage.saveAll(olderCopy, "migration", { onlyIfEmpty: true })).toBe(false);
    expect(Object.keys((await indexedDBStorage.loadAllStrict()).tracks)).toEqual([uri]);

    // The user's own tags count as content even without saved songs.
    const ownTags = createEmptyTaxonomy();
    ownTags.categoryOrder = ["mine"];
    ownTags.categoriesById.mine = { id: "mine", name: "Mine", subcategoryIds: [], childIds: [] };
    expect(await indexedDBStorage.saveAll({ ...library({}), taxonomy: ownTags })).toBe(true);
    expect(await indexedDBStorage.saveAll(olderCopy, "migration", { onlyIfEmpty: true })).toBe(false);
    expect((await indexedDBStorage.getTaxonomy()).categoryOrder).toEqual(["mine"]);

    // Tagify's starting tags alone are an empty library.
    expect(await indexedDBStorage.saveAll(library({}))).toBe(true);
    expect(await indexedDBStorage.saveAll(olderCopy, "migration", { onlyIfEmpty: true })).toBe(true);
    expect(Object.keys((await indexedDBStorage.loadAllStrict()).tracks)).toEqual(["spotify:track:older"]);
  });
});

describe("libraries saved by an older Tagify", () => {
  beforeEach(async () => {
    await writeOnlyLegacyCategories(legacyCategories);
  });

  it("adds a quick tag to the saved tags instead of starting from none", async () => {
    const before = await indexedDBStorage.getTaxonomy();
    const categoryId = before.categoryOrder[0];

    const tag = await indexedDBStorage.createQuickTag("Chill", categoryId);

    const after = await indexedDBStorage.getTaxonomy();
    expect(after.categoryOrder).toEqual(before.categoryOrder);
    expect(Object.keys(after.tagsById)).toEqual(expect.arrayContaining([...Object.keys(before.tagsById), tag.id]));
  });

  it("never replaces the saved tags with a new Quick tags category", async () => {
    const before = await indexedDBStorage.getTaxonomy();

    await indexedDBStorage.createQuickTag("Chill", "").catch(() => undefined);

    const after = await indexedDBStorage.getTaxonomy();
    expect(after.categoryOrder).toEqual(before.categoryOrder);
    expect(Object.values(after.categoriesById).map((category) => category.name)).not.toContain("Quick tags");
    expect(Object.keys(after.tagsById)).toEqual(expect.arrayContaining(Object.keys(before.tagsById)));
  });

  it("undoes a bulk tag removal using the saved tags", async () => {
    const [houseId] = Object.keys((await indexedDBStorage.getTaxonomy()).tagsById);
    expect(await indexedDBStorage.saveTrack(uri, { ...song, tagIds: [houseId] })).toBe(true);
    await indexedDBStorage.applyBulkTagUpdates([{ trackUri: uri, toAdd: [], toRemove: [houseId] }]);

    const result = await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);

    expect(result.skippedFields).toBe(0);
    expect((await indexedDBStorage.getTrack(uri))?.tagIds).toEqual([houseId]);
  });
});

describe("fields from a newer Tagify", () => {
  it("keeps fields this version doesn't know through load and save", async () => {
    const newer = { ...song, mood: "calm", lyricsSync: { offsetMs: 120 } } as TrackData;
    expect(await indexedDBStorage.saveAll(library({ [uri]: newer }))).toBe(true);

    const loaded = await indexedDBStorage.loadAllStrict();
    expect(loaded.tracks[uri]).toMatchObject({ mood: "calm", lyricsSync: { offsetMs: 120 }, dateModified: 1_000 });

    expect(await indexedDBStorage.saveAll(loaded)).toBe(true);
    expect((await indexedDBStorage.loadAllStrict()).tracks[uri]).toMatchObject({ mood: "calm", lyricsSync: { offsetMs: 120 }, dateModified: 1_000 });
  });

  it("keeps fields this version doesn't know through a backup file and import", async () => {
    const playlistUri = `spotify:playlist:${"p".repeat(22)}`;
    const newer = {
      ...library({ [uri]: { ...song, mood: "calm" } as TrackData }),
      playlists: { [playlistUri]: { rating: 3, energy: 0, tagIds: [], coverColor: "#123456" } },
      smartPlaylists: [{
        id: "smart-1", playlistId: "p1", playlistName: "Calm", isActive: true, createdAt: 1, lastSyncAt: 0, smartPlaylistTrackUris: [],
        sortOrder: "energy",
        criteria: { includeTagClauses: [], clauseConnectors: [], ratingFilters: [], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null },
      }],
    } as unknown as TagDataStructure;
    expect(await indexedDBStorage.saveAll(newer)).toBe(true);

    const file = JSON.parse(JSON.stringify(buildTagifyBackupEnvelopeV2(await indexedDBStorage.loadAllStrict())));
    expect(await indexedDBStorage.clearAll()).toBe(true);
    validateTagDataBackup(file);
    expect(await indexedDBStorage.saveAll(normalizeTagDataStructure(extractTagDataFromBackup(file)))).toBe(true);

    const imported = await indexedDBStorage.loadAllStrict();
    expect(imported.tracks[uri]).toMatchObject({ mood: "calm", dateModified: 1_000 });
    expect(imported.playlists[playlistUri]).toMatchObject({ coverColor: "#123456" });
    expect(imported.smartPlaylists?.[0]).toMatchObject({ sortOrder: "energy" });
  });
});
