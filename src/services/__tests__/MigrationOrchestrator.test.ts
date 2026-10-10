import { beforeEach, describe, expect, it, vi } from "vitest";

const { indexedDBStorageMock } = vi.hoisted(() => ({
  indexedDBStorageMock: {
    init: vi.fn(),
    getTrackCount: vi.fn(),
    getPlaylistCount: vi.fn(),
    getArtistCount: vi.fn(),
    getAllSmartPlaylists: vi.fn(),
    getTaxonomy: vi.fn(),
    loadAll: vi.fn(),
    loadAllStrict: vi.fn(),
    saveAll: vi.fn(),
    saveTrackChanges: vi.fn(),
  },
}));

vi.mock("@/services/storage/IndexedDBStorageService", () => ({
  indexedDBStorage: indexedDBStorageMock,
}));

// Recovering a linked device waits for Spotify sign-in; these tests are unlinked.
vi.mock("@/services/sync/SyncInstallRecovery", () => ({
  restoreDesktopSyncConfiguration: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/services/SpotifyService", () => ({
  spotifyService: {
    getTrack: vi.fn(),
  },
}));

vi.mock("@/services/AudioFeaturesService", () => ({
  audioFeaturesService: {
    getAudioFeatures: vi.fn(),
  },
}));

import { migrationOrchestrator } from "../MigrationOrchestrator";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure } from "@/types/tagData";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";

const emptyLibrary = (): TagDataStructure => ({
  ...defaultTagData, taxonomy: createEmptyTaxonomy(), tracks: {}, playlists: {}, artists: {}, smartPlaylists: [],
});

describe("MigrationOrchestrator", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    indexedDBStorageMock.saveTrackChanges.mockResolvedValue(true);
    indexedDBStorageMock.getAllSmartPlaylists.mockResolvedValue([]);
    indexedDBStorageMock.saveAll.mockResolvedValue(true);
  });

  it("keeps existing smart-playlist rules when migration flags are missing after reinstall", async () => {
    const rule = {
      id: "smart-playlist:alt:1",
      playlistId: "alt",
      playlistName: "Alt",
      criteria: { includeTagClauses: [], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null },
      isActive: true,
      createdAt: 1,
      lastSyncAt: 0,
      smartPlaylistTrackUris: [],
    };
    window.localStorage.setItem("tagify:tagData", JSON.stringify({
      ...defaultTagData,
      smartPlaylists: [],
    }));
    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    indexedDBStorageMock.getPlaylistCount.mockResolvedValue(0);
    indexedDBStorageMock.getArtistCount.mockResolvedValue(0);
    indexedDBStorageMock.getAllSmartPlaylists.mockResolvedValue([rule]);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue({ ...defaultTagData.taxonomy, categoryOrder: [] });
    indexedDBStorageMock.loadAllStrict.mockResolvedValue({ ...emptyLibrary(), smartPlaylists: [rule] });

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(true);
    expect(result.dataSource).toBe("indexedDB");
    expect(result.data.smartPlaylists).toMatchObject([rule]);
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
  });

  it("reports an error instead of treating previously migrated empty storage as a fresh install", async () => {
    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({
        version: "1.0.0",
        migrations: {
          storageToIndexedDB: true,
        },
      }),
    );

    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    indexedDBStorageMock.getPlaylistCount.mockResolvedValue(0);
    indexedDBStorageMock.getArtistCount.mockResolvedValue(0);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue({
      categoryOrder: [],
      categoriesById: {},
      subcategoriesById: {},
      tagsById: {},
      customAccentsById: {},
    });
    indexedDBStorageMock.loadAllStrict.mockResolvedValue(emptyLibrary());

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(false);
    expect(result.isFreshInstall).toBe(false);
    expect(result.error).toContain("couldn't find your saved library");
    expect(result.error).not.toMatch(/IndexedDB|localStorage|migration/i);
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
  });

  it("does not revive stale localStorage when a paired account replica is wiped", async () => {
    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({
        version: "3.0.0-beta.1",
        migrations: {
          cleanupEmptyTracks: true,
          addTrackMetadata: true,
          removeTrackInfoCache: true,
          storageToIndexedDB: true,
        },
      }),
    );
    window.localStorage.setItem(
      "tagify:sync:configuration",
      JSON.stringify({
        accountId: "account-a",
        libraryId: "library-a",
        deviceId: "device-a",
        apiBaseUrl: "https://community.example.test",
      }),
    );
    window.localStorage.setItem(
      "tagify:tagData",
      JSON.stringify({
        ...defaultTagData,
        tracks: {
          "spotify:track:stale": {
            rating: 5,
            energy: 0,
            bpm: null,
            camelotKey: null,
            tagIds: ["legacy"],
          },
        },
      }),
    );

    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    indexedDBStorageMock.getPlaylistCount.mockResolvedValue(0);
    indexedDBStorageMock.getArtistCount.mockResolvedValue(0);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue({
      categoryOrder: [],
      categoriesById: {},
      subcategoriesById: {},
      tagsById: {},
      customAccentsById: {},
    });
    indexedDBStorageMock.loadAllStrict.mockResolvedValue(emptyLibrary());

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(true);
    expect(result.isFreshInstall).toBe(false);
    expect(result.dataSource).toBe("indexedDB");
    expect(result.trackCount).toBe(0);
    expect(result.data.tracks).toEqual({});
  });

  it("asks before restoring the older copy when the saved library was cleared", async () => {
    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({
        version: "3.0.0-beta.1",
        migrations: { cleanupEmptyTracks: true, addTrackMetadata: true, removeTrackInfoCache: true, storageToIndexedDB: true },
      }),
    );
    window.localStorage.setItem(
      "tagify:tagData",
      JSON.stringify({
        ...defaultTagData,
        tracks: { "spotify:track:kept": { rating: 4, energy: 0, bpm: null, camelotKey: null, tagIds: [], dateModified: 1_234 } },
      }),
    );
    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.loadAllStrict.mockResolvedValue(emptyLibrary());
    indexedDBStorageMock.getTrackCount.mockResolvedValue(1);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });

    const asked = await migrationOrchestrator.initialize();

    expect(asked).toMatchObject({ success: false, fallbackMode: true, olderCopy: { trackCount: 1 } });
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);

    const result = await migrationOrchestrator.retryIndexedDBMigration(undefined, { olderCopy: "restore" });

    expect(result.success).toBe(true);
    expect(result.fallbackMode).toBe(false);
    expect(result.restoredOlderCopy).toBe(true);
    expect(result.migrationsRun).toContain("restoredOlderCopy");
    expect(indexedDBStorageMock.saveAll).toHaveBeenCalledWith(expect.objectContaining({
      tracks: { "spotify:track:kept": expect.objectContaining({ rating: 4, dateModified: 1_234 }) },
    }), "migration", { onlyIfEmpty: true });
    // The older copy is never named like the newest backup.
    expect(downloads).toEqual([expect.stringMatching(/^tagify-older-copy-.*\.json$/)]);
    expect(migrationOrchestrator.isFallbackMode()).toBe(false);
  });

  it("starts fresh without the older copy when the user chooses, keeping it as a file", async () => {
    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({ version: "3.0.0", migrations: { cleanupEmptyTracks: true, cleanupInlineEditorEmptyTracks: true, addTrackMetadata: true, removeTrackInfoCache: true, storageToIndexedDB: true } }),
    );
    window.localStorage.setItem("tagify:tagData", JSON.stringify({
      ...defaultTagData,
      tracks: { "spotify:track:old": { rating: 4, energy: 0, bpm: null, tagIds: [] } },
    }));
    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.loadAllStrict.mockResolvedValue(emptyLibrary());
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });

    const result = await migrationOrchestrator.initialize(undefined, { olderCopy: "start-fresh" });

    expect(result).toMatchObject({ success: true, fallbackMode: false, trackCount: 0 });
    expect(result.restoredOlderCopy).toBe(false);
    expect(result.data.taxonomy.categoryOrder).toEqual(defaultTagData.taxonomy.categoryOrder);
    expect(indexedDBStorageMock.saveAll).toHaveBeenCalledWith(expect.objectContaining({ tracks: {} }), "migration", { onlyIfEmpty: true });
    expect(downloads).toEqual([expect.stringMatching(/^tagify-older-copy-/)]);
  });

  it("never writes when the saved library can't be opened, and makes nothing the saved baseline", async () => {
    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({ version: "3.0.0", migrations: { cleanupEmptyTracks: true, cleanupInlineEditorEmptyTracks: true, addTrackMetadata: true, removeTrackInfoCache: true, storageToIndexedDB: true } }),
    );
    window.localStorage.setItem("tagify:tagData", JSON.stringify({
      ...defaultTagData,
      tracks: { "spotify:track:old": { rating: 4, energy: 0, bpm: null, tagIds: [] } },
    }));
    indexedDBStorageMock.init.mockResolvedValue(false);

    const result = await migrationOrchestrator.initialize();

    expect(result).toMatchObject({ success: false, fallbackMode: true, isFreshInstall: false });
    expect(result.data.tracks).toEqual({});
    expect(result.error).not.toMatch(/IndexedDB|localStorage|migration/i);
    expect(indexedDBStorageMock.init).toHaveBeenCalledTimes(3);
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
    expect(migrationOrchestrator.isFallbackMode()).toBe(true);
  });

  it("treats a failed read as unavailable, not as an empty library", async () => {
    window.localStorage.setItem("tagify:tagData", JSON.stringify({
      ...defaultTagData,
      tracks: { "spotify:track:old": { rating: 4, energy: 0, bpm: null, tagIds: [] } },
    }));
    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.loadAllStrict.mockRejectedValue(new Error("UnknownError"));

    const result = await migrationOrchestrator.initialize();

    expect(result).toMatchObject({ success: false, fallbackMode: true });
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
  });

  it("does not forget that the library already moved when trying again", async () => {
    const migrations = { cleanupEmptyTracks: true, cleanupInlineEditorEmptyTracks: true, addTrackMetadata: true, removeTrackInfoCache: true, storageToIndexedDB: true };
    window.localStorage.setItem("tagify:migrations", JSON.stringify({ version: "3.0.0", migrations }));
    window.localStorage.setItem("tagify:tagData", JSON.stringify({
      ...defaultTagData,
      tracks: { "spotify:track:old": { rating: 4, energy: 0, bpm: null, tagIds: [] } },
    }));
    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.loadAllStrict.mockResolvedValue(emptyLibrary());

    const result = await migrationOrchestrator.retryIndexedDBMigration();

    expect(result.olderCopy).toEqual({ trackCount: 1 });
    expect(indexedDBStorageMock.saveAll).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem("tagify:migrations") || "{}").migrations.storageToIndexedDB).toBe(true);
  });

  it("keeps reset tag data empty after restart when legacy localStorage still has tracks", async () => {
    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({
        version: "1.0.0",
        migrations: {
          cleanupEmptyTracks: true,
          addTrackMetadata: true,
          removeTrackInfoCache: true,
          storageToIndexedDB: true,
        },
      }),
    );
    window.localStorage.setItem(
      "tagify:tagData",
      JSON.stringify({
        ...defaultTagData,
        tracks: {
          "spotify:track:legacy": {
            rating: 5,
            energy: 0,
            bpm: null,
            tagIds: ["rock"],
          },
        },
      }),
    );

    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    indexedDBStorageMock.getPlaylistCount.mockResolvedValue(0);
    indexedDBStorageMock.getArtistCount.mockResolvedValue(0);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue(defaultTagData.taxonomy);
    indexedDBStorageMock.loadAllStrict.mockResolvedValue({ ...defaultTagData, smartPlaylists: [] });

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(true);
    expect(result.dataSource).toBe("indexedDB");
    expect(result.trackCount).toBe(0);
    expect(result.data.tracks).toEqual({});
  });

  it("loads migrated artist-only IndexedDB data instead of reporting storage as empty", async () => {
    const firstCategoryId = defaultTagData.taxonomy.categoryOrder[0];
    const firstSubcategoryId =
      defaultTagData.taxonomy.categoriesById[firstCategoryId].subcategoryIds[0];
    const firstTagId =
      defaultTagData.taxonomy.subcategoriesById[firstSubcategoryId].tagIds[0];
    const artistOnlyData = {
      ...defaultTagData,
      artists: {
        "spotify:artist:artist-only": {
          rating: 0,
          energy: 0,
          tagIds: [firstTagId],
          dateCreated: 1783360131809,
          dateModified: 1783360451194,
          name: "Artist Only",
          imageUrl: null,
          followerCount: null,
          genres: [],
        },
      },
    };

    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({
        version: "2.4.0",
        migrations: {
          cleanupEmptyTracks: true,
          addTrackMetadata: true,
          removeTrackInfoCache: true,
          storageToIndexedDB: true,
        },
      }),
    );

    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(0);
    indexedDBStorageMock.getPlaylistCount.mockResolvedValue(0);
    indexedDBStorageMock.getArtistCount.mockResolvedValue(1);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue(artistOnlyData.taxonomy);
    indexedDBStorageMock.loadAllStrict.mockResolvedValue(artistOnlyData);

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(true);
    expect(result.dataSource).toBe("indexedDB");
    expect(result.trackCount).toBe(0);
    expect(Object.keys(result.data.artists)).toEqual([
      "spotify:artist:artist-only",
    ]);
  });

  it("removes empty tracks left by older inline editor builds", async () => {
    const staleTrack = {
      rating: 0,
      energy: 0,
      bpm: 124,
      camelotKey: "8A",
      tagIds: [],
      name: "Stale track",
      artists: "Artist",
    };
    const retainedTrack = {
      ...staleTrack,
      rating: 4,
      name: "Retained track",
    };
    const storedData = {
      ...defaultTagData,
      tracks: {
        "spotify:track:stale": staleTrack,
        "spotify:track:retained": retainedTrack,
      },
    };

    window.localStorage.setItem(
      "tagify:migrations",
      JSON.stringify({
        version: "3.0.0-beta.1",
        migrations: {
          cleanupEmptyTracks: true,
          addTrackMetadata: true,
          removeTrackInfoCache: true,
          storageToIndexedDB: true,
        },
      }),
    );

    indexedDBStorageMock.init.mockResolvedValue(true);
    indexedDBStorageMock.getTrackCount.mockResolvedValue(2);
    indexedDBStorageMock.getPlaylistCount.mockResolvedValue(0);
    indexedDBStorageMock.getArtistCount.mockResolvedValue(0);
    indexedDBStorageMock.getTaxonomy.mockResolvedValue(storedData.taxonomy);
    indexedDBStorageMock.loadAllStrict.mockResolvedValue(storedData);

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(true);
    expect(result.data.tracks).toEqual({
      "spotify:track:retained": retainedTrack,
    });
    expect(indexedDBStorageMock.saveTrackChanges).toHaveBeenCalledWith(
      new Map([["spotify:track:stale", null]]),
    );
    expect(result.migrationsRun).toContain("cleanupInlineEditorEmptyTracks");
  });
});
