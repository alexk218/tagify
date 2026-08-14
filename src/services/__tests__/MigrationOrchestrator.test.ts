import { beforeEach, describe, expect, it, vi } from "vitest";

const { indexedDBStorageMock } = vi.hoisted(() => ({
  indexedDBStorageMock: {
    init: vi.fn(),
    getTrackCount: vi.fn(),
    getPlaylistCount: vi.fn(),
    getArtistCount: vi.fn(),
    getTaxonomy: vi.fn(),
    loadAll: vi.fn(),
  },
}));

vi.mock("@/services/storage/IndexedDBStorageService", () => ({
  indexedDBStorage: indexedDBStorageMock,
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

describe("MigrationOrchestrator", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
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
    indexedDBStorageMock.loadAll.mockResolvedValue(null);

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(false);
    expect(result.isFreshInstall).toBe(false);
    expect(result.error).toContain("unexpectedly empty after IndexedDB migration");
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
    indexedDBStorageMock.loadAll.mockResolvedValue(defaultTagData);

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
    indexedDBStorageMock.loadAll.mockResolvedValue(artistOnlyData);

    const result = await migrationOrchestrator.initialize();

    expect(result.success).toBe(true);
    expect(result.dataSource).toBe("indexedDB");
    expect(result.trackCount).toBe(0);
    expect(Object.keys(result.data.artists)).toEqual([
      "spotify:artist:artist-only",
    ]);
  });
});
