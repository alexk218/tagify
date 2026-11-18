import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "../IndexedDBStorageService";
import { carryLibraryHistory, libraryHistoryCutoff, stampNewTags, type LibraryHistoryRow } from "../libraryHistory";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import { getTagifyDatabaseName, noteTagMethods, setDesktopSyncConfiguration, setLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { hasCustomTaxonomy } from "@/features/tag-data/utils/tagData.schema";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagTaxonomy, TrackData } from "@/types/tagData";

const song = "spotify:track:song";
const other = "spotify:track:other";
const saved: TrackData = { rating: 4, energy: 5, bpm: 120, tagIds: ["old"], dateCreated: 10, dateModified: 20 };

function startingTaxonomy(): TagTaxonomy {
  const taxonomy = createEmptyTaxonomy();
  taxonomy.categoryOrder = ["genre"];
  taxonomy.categoriesById.genre = { id: "genre", name: "Genre", subcategoryIds: [], childIds: ["old", "new"] };
  taxonomy.tagsById = { old: { id: "old", name: "Old", subcategoryId: "genre" }, new: { id: "new", name: "New", subcategoryId: "genre" } };
  return taxonomy;
}

/** History written since the last call, without store ids, times and whether it was connected (tested below). */
let seen = 0;
async function newRows(): Promise<Array<Omit<LibraryHistoryRow, "id" | "occurredAt" | "live">>> {
  const rows = await indexedDBStorage.getLibraryHistory();
  const fresh = rows.slice(seen);
  seen = rows.length;
  fresh.forEach((row) => expect(typeof row.occurredAt).toBe("number"));
  fresh.forEach((row) => expect(typeof row.live).toBe("boolean"));
  return fresh.map(({ id: _id, occurredAt: _at, live: _live, ...row }) => row);
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("tagify:sync:account-id", "library-history-tests");
  await indexedDBStorage.init();
  await indexedDBStorage.saveTaxonomy(startingTaxonomy());
  await indexedDBStorage.saveTrack(song, saved);
  seen = 0;
  // The first tag list and the first save are this setup; start counting after them.
  await newRows();
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); setLocalPersistencePaused(false); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("songs", () => {
  it("logs a single edit with its method, rating and energy, and never changes dateModified", async () => {
    const edited = { ...saved, tagIds: ["old", "new"], rating: 5, energy: 0, dateModified: 30 };
    noteTagMethods(song, saved.tagIds, edited.tagIds, "typed");
    await indexedDBStorage.saveTrack(song, edited);
    expect(await newRows()).toEqual([
      { kind: "tag_added", uri: song, tagId: "new", method: "typed" },
      { kind: "rating", uri: song, from: 4, to: 5, method: "unknown" },
      { kind: "energy", uri: song, from: 5, to: null, method: "unknown" },
    ]);
    expect(await indexedDBStorage.getTrack(song)).toEqual(edited);
  });

  it("logs bulk tagging and album tags onto songs as bulk, keeping each song's dateModified", async () => {
    await indexedDBStorage.applyBulkTagUpdates([
      { trackUri: song, toAdd: ["new"], toRemove: ["old"], tagMethod: "bulk" },
      { trackUri: other, toAdd: ["new"], toRemove: [], tagMethod: "bulk" },
    ]);
    expect(await newRows()).toEqual([
      { kind: "tag_added", uri: song, tagId: "new", method: "bulk" },
      { kind: "tag_removed", uri: song, tagId: "old", method: "bulk" },
      { kind: "tag_added", uri: other, tagId: "new", method: "bulk" },
    ]);
  });

  it("logs first-run copies as copied and automatic rules as rule, without moving Last Updated", async () => {
    await indexedDBStorage.applyBulkTagUpdates([{ trackUri: other, toAdd: ["old"], toRemove: [], newRating: 3, tagMethod: "copied" }]);
    expect(await newRows()).toEqual([
      { kind: "tag_added", uri: other, tagId: "old", method: "copied" },
      { kind: "rating", uri: other, from: null, to: 3, method: "copied" },
    ]);
    await indexedDBStorage.applyBulkTagUpdates([{ trackUri: song, toAdd: ["new"], toRemove: [], automaticRuleIds: ["rule-1"] }]);
    expect(await newRows()).toEqual([{ kind: "tag_added", uri: song, tagId: "new", method: "rule" }]);
    expect((await indexedDBStorage.getTrack(song))!.dateModified).toBe(20);
  });

  it("logs smart playlist changes as smart_playlist", async () => {
    await indexedDBStorage.patchTracks({ [song]: (current) => ({ ...current!, tagIds: ["new"] }) }, { tagMethod: "smart_playlist" });
    expect(await newRows()).toEqual([
      { kind: "tag_added", uri: song, tagId: "new", method: "smart_playlist" },
      { kind: "tag_removed", uri: song, tagId: "old", method: "smart_playlist" },
    ]);
  });

  it("logs an undo, with no method", async () => {
    await indexedDBStorage.applyBulkTagUpdates([{ trackUri: song, toAdd: ["new"], toRemove: [], tagMethod: "bulk" }]);
    await newRows();
    await indexedDBStorage.undoBulkTagUpdate((await indexedDBStorage.getLatestBulkUndo())!.id);
    expect(await newRows()).toEqual([{ kind: "tag_removed", uri: song, tagId: "new", method: "unknown" }]);
  });

  it("logs nothing for changes from Community, saves that change no annotation, or a song leaving the library", async () => {
    await indexedDBStorage.saveTrack(song, { ...saved, tagIds: ["new"], rating: 1 }, { captureSync: false });
    await indexedDBStorage.saveTrack(song, { ...saved, tagIds: ["new"], rating: 1, name: "Title" });
    await indexedDBStorage.deleteTrack(song);
    expect(await newRows()).toEqual([]);
  });
});

describe("playlists and artists", () => {
  const playlist = "spotify:playlist:list";
  const artist = "spotify:artist:someone";

  it("logs every save path", async () => {
    noteTagMethods(playlist, [], ["old"], "typed");
    await indexedDBStorage.savePlaylist(playlist, { rating: 2, energy: 0, tagIds: ["old"] });
    await indexedDBStorage.savePlaylists(new Map([[playlist, { rating: 2, energy: 4, tagIds: ["old"] }]]));
    await indexedDBStorage.saveArtist(artist, { rating: 0, energy: 0, tagIds: ["new"] });
    await indexedDBStorage.saveArtists(new Map([[artist, { rating: 0, energy: 0, tagIds: [] }]]));
    await indexedDBStorage.addEntityTags(artist, "artist", ["old"]);
    await indexedDBStorage.patchEntities("artist", { [artist]: (current) => ({ ...current!, tagIds: ["old", "new"] }) }, { tagMethod: "bulk" });
    expect(await newRows()).toEqual([
      { kind: "tag_added", uri: playlist, tagId: "old", method: "typed" },
      { kind: "rating", uri: playlist, from: null, to: 2, method: "unknown" },
      { kind: "energy", uri: playlist, from: null, to: 4, method: "unknown" },
      { kind: "tag_added", uri: artist, tagId: "new", method: "unknown" },
      { kind: "tag_removed", uri: artist, tagId: "new", method: "unknown" },
      { kind: "tag_added", uri: artist, tagId: "old", method: "unknown" },
      { kind: "tag_added", uri: artist, tagId: "new", method: "bulk" },
    ]);
  });

  it("logs nothing for changes from Community or a removed item", async () => {
    await indexedDBStorage.savePlaylist(playlist, { rating: 2, energy: 0, tagIds: ["old"] }, { captureSync: false });
    await indexedDBStorage.saveArtist(artist, { rating: 2, energy: 0, tagIds: ["old"] }, { captureSync: false });
    await indexedDBStorage.deletePlaylist(playlist);
    expect(await newRows()).toEqual([]);
  });
});

describe("tag list", () => {
  it("logs tags created, renamed and deleted, with names, and records when a tag was created", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T22:15:00Z"));
    const tag = await indexedDBStorage.createQuickTag("Late night", "genre");
    expect((await indexedDBStorage.getTaxonomy()).tagsById[tag.id].createdAt).toBe(Date.parse("2026-11-14T22:15:00Z"));
    expect(await newRows()).toEqual([{ kind: "tag_created", tagId: tag.id, tagName: "Late night", method: "unknown" }]);

    await indexedDBStorage.saveTaxonomy((current) => ({
      ...current,
      tagsById: { ...current.tagsById, [tag.id]: { ...current.tagsById[tag.id], name: "After hours" } },
    }));
    await indexedDBStorage.saveTaxonomy((current) => {
      const { old: _old, ...tagsById } = current.tagsById;
      return { ...current, tagsById, subcategoriesById: { ...current.subcategoriesById, folder: { id: "folder", name: "Folder", tagIds: [] } } };
    });
    expect(await newRows()).toEqual([
      { kind: "tag_renamed", tagId: tag.id, tagName: "After hours", method: "unknown" },
      { kind: "tag_deleted", tagId: "old", method: "unknown" },
    ]);
    // A rename keeps when the tag was created.
    expect((await indexedDBStorage.getTaxonomy()).tagsById[tag.id].createdAt).toBe(Date.parse("2026-11-14T22:15:00Z"));
  });

  it("logs tags added from another member's tag list as copied, and their removal on undo", async () => {
    const taxonomy = startingTaxonomy();
    taxonomy.tagsById.shared = { id: "shared", name: "Shared", subcategoryId: "genre" };
    const rollbackId = await indexedDBStorage.applyCommunityTaxonomy(taxonomy, {
      installationId: "install-1",
    } as Parameters<typeof indexedDBStorage.applyCommunityTaxonomy>[1], startingTaxonomy());
    expect(await newRows()).toEqual([{ kind: "tag_created", tagId: "shared", tagName: "Shared", method: "copied" }]);
    expect(typeof (await indexedDBStorage.getTaxonomy()).tagsById.shared.createdAt).toBe("number");
    await indexedDBStorage.rollbackCommunityTaxonomy(rollbackId!);
    expect(await newRows()).toEqual([{ kind: "tag_deleted", tagId: "shared", method: "unknown" }]);
  });

  it("doesn't log or date the first tag list a library saves", () => {
    const starter = startingTaxonomy();
    expect(stampNewTags(null, starter)).toBe(starter);
  });

  it("keeps starter tags counted as starter tags when they carry a creation time", () => {
    const starter = defaultTagData.taxonomy;
    const [firstTagId] = Object.keys(starter.tagsById);
    const dated = { ...starter, tagsById: { ...starter.tagsById, [firstTagId]: { ...starter.tagsById[firstTagId], createdAt: 1 } } };
    expect(hasCustomTaxonomy(dated)).toBe(hasCustomTaxonomy(starter));
  });
});

describe("whole-library replacements", () => {
  it("writes one snapshot row for a backup import and a reset, and keeps the history", async () => {
    await indexedDBStorage.saveAll({
      ...defaultTagData,
      taxonomy: startingTaxonomy(),
      tracks: { [song]: { ...saved, tagIds: ["new"] }, [other]: { ...saved, tagIds: ["old", "new"] } },
    }, "import");
    expect(await newRows()).toEqual([{ kind: "snapshot", method: "unknown", reason: "import" }]);
    await indexedDBStorage.clearAll();
    expect(await newRows()).toEqual([{ kind: "snapshot", method: "unknown", reason: "reset" }]);
    // The setup's three rows are still there: replacing the library never clears its history.
    expect((await indexedDBStorage.getLibraryHistory()).length).toBe(5);
  });
});

describe("retention", () => {
  it("keeps the current and previous calendar year", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2024, 11, 31, 23, 0));
    await indexedDBStorage.saveTrack(song, { ...saved, rating: 1 });
    vi.setSystemTime(new Date(2025, 0, 1, 0, 30));
    await indexedDBStorage.saveTrack(song, { ...saved, rating: 2 });
    vi.setSystemTime(new Date(2026, 10, 14));
    await indexedDBStorage.saveTrack(song, { ...saved, rating: 3 });

    expect(libraryHistoryCutoff()).toBe(new Date(2025, 0, 1).getTime());
    expect(await indexedDBStorage.trimLibraryHistory()).toBe(1);
    // The setup's rating (4, today) is kept; the 2024 one is gone.
    expect((await indexedDBStorage.getLibraryHistory()).filter((row) => row.kind === "rating").map((row) => row.to)).toEqual([4, 2, 3]);
  });

  it("trims when the library opens", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2023, 5, 1));
    await indexedDBStorage.saveTrack(song, { ...saved, rating: 1 });
    vi.setSystemTime(new Date(2026, 10, 14));
    indexedDBStorage.resetConnection();
    await indexedDBStorage.init();
    await vi.waitFor(async () => expect((await indexedDBStorage.getLibraryHistory()).filter((row) => row.kind === "rating").map((row) => row.to)).toEqual([4]));
  });
});

describe("upgrade", () => {
  it("adds the history store to a library saved by the previous version, keeping its songs", async () => {
    indexedDBStorage.resetConnection();
    const factory = new IDBFactory();
    vi.stubGlobal("indexedDB", factory);
    const name = getTagifyDatabaseName();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(name, 12);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("tracks", { keyPath: "uri" }).put({ uri: song, ...saved });
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    await indexedDBStorage.init();
    expect(await indexedDBStorage.getTrack(song)).toEqual(saved);
    await indexedDBStorage.saveTrack(song, { ...saved, rating: 2 });
    expect((await indexedDBStorage.getLibraryHistory()).map(({ kind, to }) => ({ kind, to }))).toEqual([{ kind: "rating", to: 2 }]);
  });
});

describe("connected to Community (for the catch-up)", () => {
  const connection = {
    accountId: "library-history-tests", libraryId: "123e4567-e89b-42d3-a456-426614174004", deviceId: "123e4567-e89b-42d3-a456-426614174005",
    apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example", supabasePublishableKey: "key",
    accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
  };
  const liveFlags = async () => (await indexedDBStorage.getLibraryHistory()).slice(seen).map((row) => [row.kind, row.live]);

  it("marks each row with whether the change also went to Community as it was saved, leaving the save as it was", async () => {
    await indexedDBStorage.saveTrack(song, { ...saved, rating: 2 });
    expect(await liveFlags()).toEqual([["rating", false]]);
    seen++;

    setDesktopSyncConfiguration(connection);
    const edited = { ...saved, rating: 3, tagIds: ["old", "new"], dateModified: 99 };
    await indexedDBStorage.saveTrack(song, edited);
    const taxonomy = startingTaxonomy();
    taxonomy.tagsById.new = { ...taxonomy.tagsById.new, name: "Newer" };
    await indexedDBStorage.saveTaxonomy(taxonomy);
    expect(await liveFlags()).toEqual([["tag_added", true], ["rating", true], ["tag_renamed", true]]);
    seen += 3;
    expect(await indexedDBStorage.getTrack(song)).toEqual(edited);

    // While the library is being replaced, edits aren't sent as they happen.
    setLocalPersistencePaused(true);
    await indexedDBStorage.saveTrack(song, { ...saved, rating: 1 });
    expect(await liveFlags()).toEqual([["tag_removed", false], ["rating", false]]);
  });

  it("reads rows after a given row, oldest first, a page at a time", async () => {
    for (const rating of [1, 2, 3, 4, 5]) await indexedDBStorage.saveTrack(song, { ...saved, rating: rating === 4 ? 4.5 : rating });
    const all = await indexedDBStorage.getLibraryHistory();
    const first = await indexedDBStorage.getLibraryHistoryAfter(0, 2);
    expect(first).toEqual(all.slice(0, 2));
    expect(await indexedDBStorage.getLibraryHistoryAfter(first[1].id!, 100)).toEqual(all.slice(2));
    expect(await indexedDBStorage.getLibraryHistoryAfter(all.at(-1)!.id!, 100)).toEqual([]);
  });

  it("carries the history kept before connecting into another database once", async () => {
    await indexedDBStorage.saveTrack(song, { ...saved, rating: 2 });
    const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const before = await indexedDBStorage.getLibraryHistory();
    indexedDBStorage.resetConnection();
    localStorage.setItem("tagify:sync:account-id", "carried");
    expect(await indexedDBStorage.init()).toBe(true);
    const source = await open("tagify-db:library-history-tests");
    const target = await open(getTagifyDatabaseName());
    try {
      expect(await carryLibraryHistory(source, target)).toBe(before.length);
      expect(await carryLibraryHistory(source, target)).toBe(0);
    } finally { source.close(); target.close(); }
    const strip = (rows: LibraryHistoryRow[]) => rows.map(({ id: _id, ...row }) => row);
    expect(strip(await indexedDBStorage.getLibraryHistory())).toEqual(strip(before));
  });
});
