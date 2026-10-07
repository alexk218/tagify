import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "../IndexedDBStorageService";
import type { ReplicaManifest } from "@/services/sync/SyncLocalState";
import type { TagDataStructure } from "@/types/tagData";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";

const accountId = "account-cloud-refresh";
const manifest: ReplicaManifest = {
  key: "replica-manifest", accountId, libraryId: "library-a", storageSchemaVersion: TAG_DATA_SCHEMA_VERSION,
  protocolVersion: 2, appliedCursor: 4, snapshotChecksum: null,
  appStateAppliedAt: null, initializedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
};
const PLAYLIST = "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M";
const ARTIST = "spotify:artist:0OdUWJ0sBjDrqHygGUXeCF";
const LOCAL_FILE = "spotify:local:Artist:Album:Song:215";
const LEGACY_PLAYLIST = "spotify:user:alex:playlist:37i9dQZF1DXcBWIGoYBM5M";

function taxonomyWithTagAndColor() {
  const taxonomy = createEmptyTaxonomy();
  taxonomy.categoryOrder = ["genre"];
  taxonomy.categoriesById.genre = { id: "genre", name: "Genre", subcategoryIds: [], childIds: ["house"] };
  taxonomy.childrenByParentId = { genre: ["house"] };
  taxonomy.tagsById.house = {
    id: "house", name: "House", parentId: "genre", subcategoryId: "genre", accentId: "custom:warm",
    source: { type: "community", publicTagKey: "house-key", publicTagName: "House", importedAt: "2026-01-01T00:00:00.000Z" },
  };
  taxonomy.customAccentsById["custom:warm"] = { id: "custom:warm", name: "Warm", color: "#ff8800", themeId: "sunset", createdAt: 11, updatedAt: 22 };
  taxonomy.colorThemesById.sunset = { id: "sunset", name: "Sunset", colorIds: ["custom:warm"], createdAt: 33, updatedAt: 44 };
  taxonomy.colorThemeOrder = ["sunset"];
  taxonomy.ungroupedColorIds = [];
  return taxonomy;
}

function cloudTaxonomy() {
  const taxonomy = taxonomyWithTagAndColor();
  delete taxonomy.tagsById.house.source;
  taxonomy.customAccentsById["custom:warm"] = { id: "custom:warm", name: "Warm", color: "#ff8800" };
  taxonomy.colorThemesById.sunset = { id: "sunset", name: "Sunset", colorIds: ["custom:warm"] };
  return taxonomy;
}

describe("cloud replica refresh", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.setItem("tagify:sync:account-id", accountId);
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps device-only details and records the cloud copy cannot hold", async () => {
    expect(await indexedDBStorage.init()).toBe(true);
    const local: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: taxonomyWithTagAndColor(),
      tracks: {
        [LOCAL_FILE]: { rating: 4, energy: 6, bpm: 120, tagIds: ["house"], dateCreated: 100, dateModified: 200, name: "Song" },
      },
      playlists: {
        [PLAYLIST]: { rating: 3, energy: 5, tagIds: [], dateCreated: 300, dateModified: 400, name: "Focus", imageUrl: "https://i.scdn.co/a" },
        [LEGACY_PLAYLIST]: { rating: 2, energy: 0, tagIds: ["house"], dateCreated: 500, dateModified: 600 },
      },
      artists: {
        [ARTIST]: { rating: 5, energy: 0, tagIds: ["house"], dateCreated: 700, dateModified: 800, name: "Artist", genres: ["house"] },
      },
      smartPlaylists: [],
    };
    expect(await indexedDBStorage.saveAll(local)).toBe(true);

    const fromCloud: TagDataStructure = {
      schemaVersion: TAG_DATA_SCHEMA_VERSION,
      taxonomy: cloudTaxonomy(),
      tracks: {},
      playlists: { [PLAYLIST]: { rating: 4, energy: 5, tagIds: ["house"] } },
      artists: { [ARTIST]: { rating: 5, energy: 0, tagIds: ["house"] } },
      smartPlaylists: [],
    };
    expect(await indexedDBStorage.replaceCloudReplica(fromCloud, manifest, [], [])).toBe(true);

    const restored = await indexedDBStorage.loadAllStrict();
    expect(restored.tracks[LOCAL_FILE]).toMatchObject({ rating: 4, tagIds: ["house"], dateCreated: 100, dateModified: 200, name: "Song" });
    expect(restored.playlists[PLAYLIST]).toMatchObject({ rating: 4, tagIds: ["house"], dateCreated: 300, dateModified: 400, name: "Focus", imageUrl: "https://i.scdn.co/a" });
    expect(restored.playlists[LEGACY_PLAYLIST]).toMatchObject({ rating: 2, tagIds: ["house"], dateModified: 600 });
    expect(restored.artists[ARTIST]).toMatchObject({ dateCreated: 700, dateModified: 800, name: "Artist", genres: ["house"] });
    expect(restored.taxonomy.tagsById.house.source?.publicTagKey).toBe("house-key");
    expect(restored.taxonomy.customAccentsById["custom:warm"]).toMatchObject({ themeId: "sunset", createdAt: 11, updatedAt: 22 });
    expect(restored.taxonomy.colorThemesById.sunset).toMatchObject({ createdAt: 33, updatedAt: 44 });
  });
});
