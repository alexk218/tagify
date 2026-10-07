import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedDBStorageService, indexedDBStorage } from "../IndexedDBStorageService";
import { TAGIFY_DATABASE_VERSION } from "@/services/sync/SyncLocalState";
import { defaultTagData } from "@/constants/defaultTagData";

const accountId = "account-with-incomplete-replica";
const databaseName = `tagify-db:${accountId}`;
const originalDateModified = "2025-04-12T10:20:30.000Z";

async function createIncompleteAccountDatabase(): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 9);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("tracks", { keyPath: "uri" });
      request.result.createObjectStore("metadata", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("tracks", "readwrite");
    transaction.objectStore("tracks").put({
      uri: "spotify:track:preserved",
      dateModified: originalDateModified,
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

describe("account database schema recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.setItem("tagify:sync:account-id", accountId);
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("creates the complete schema for a newly paired account", async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, TAGIFY_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        IndexedDBStorageService.createSchema(request.result, request.transaction ?? undefined);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    expect(database.objectStoreNames.contains("smartPlaylists")).toBe(true);
    expect(database.objectStoreNames.contains("community-policy")).toBe(true);
    expect(database.objectStoreNames.contains("sync-outbox")).toBe(true);
    database.close();
  });

  it("repairs an existing account database so a newly created Spotify playlist can be saved", async () => {
    await createIncompleteAccountDatabase();

    expect(await indexedDBStorage.init()).toBe(true);
    const smartPlaylist = {
      id: "smart-playlist:test",
      playlistId: "spotify:playlist:test",
      playlistName: "New Smart Playlist",
      criteria: {
        includeTagClauses: [],
        clauseConnectors: [],
        ratingFilters: [],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
      },
      isActive: true,
      createdAt: 1,
      lastSyncAt: 0,
      smartPlaylistTrackUris: [],
    };

    expect(await indexedDBStorage.saveSmartPlaylists([smartPlaylist])).toBe(true);
    expect(await indexedDBStorage.getAllSmartPlaylists()).toMatchObject([
      { id: smartPlaylist.id, playlistId: smartPlaylist.playlistId },
    ]);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const track = await new Promise<{ dateModified: string }>((resolve, reject) => {
      const request = database.transaction("tracks").objectStore("tracks").get("spotify:track:preserved");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(track.dateModified).toBe(originalDateModified);
    database.close();
  });

  it("does not erase a local smart playlist when an older cloud snapshot has no rule document", async () => {
    expect(await indexedDBStorage.init()).toBe(true);
    const smartPlaylist = {
      id: "five-stars",
      playlistId: "2rHTLOgs7Ygr6rp76Hw5n9",
      playlistName: "5★",
      criteria: {
        includeTagClauses: [], clauseConnectors: [], ratingFilters: [5],
        energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null,
      },
      isActive: true,
      createdAt: 1,
      lastSyncAt: 0,
      smartPlaylistTrackUris: [],
    };
    expect(await indexedDBStorage.saveSmartPlaylists([smartPlaylist])).toBe(true);

    const restored = await indexedDBStorage.replaceCloudReplica(defaultTagData, {
      key: "replica-manifest", accountId, libraryId: "library-a", storageSchemaVersion: 1,
      protocolVersion: 2, appliedCursor: 1, snapshotChecksum: null,
      appStateAppliedAt: null, initializedAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    }, [], []);

    expect(restored).toBe(true);
    expect(await indexedDBStorage.getAllSmartPlaylists()).toMatchObject([
      { id: "five-stars", criteria: { ratingFilters: [5] } },
    ]);
  });

  it("rejects a damaged cloud rule document without touching existing rules", async () => {
    expect(await indexedDBStorage.init()).toBe(true);
    const smartPlaylist = {
      id: "five-stars", playlistId: "2rHTLOgs7Ygr6rp76Hw5n9", playlistName: "5★",
      criteria: {
        includeTagClauses: [], clauseConnectors: [], ratingFilters: [5],
        energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null,
      },
      isActive: true, createdAt: 1, lastSyncAt: 0, smartPlaylistTrackUris: [],
    };
    expect(await indexedDBStorage.saveSmartPlaylists([smartPlaylist])).toBe(true);

    const restored = await indexedDBStorage.replaceCloudReplica(defaultTagData, {
      key: "replica-manifest", accountId, libraryId: "library-a", storageSchemaVersion: 1,
      protocolVersion: 2, appliedCursor: 1, snapshotChecksum: null,
      appStateAppliedAt: null, initializedAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    }, [], [{
      domain: "smart-playlists", value: [{ playlistName: "5★" }],
      revision: 1, updatedAt: "2026-09-23T00:00:00.000Z",
    }]);

    expect(restored).toBe(false);
    expect(await indexedDBStorage.getAllSmartPlaylists()).toMatchObject([
      { id: "five-stars", criteria: { ratingFilters: [5] } },
    ]);
  });

  it("keeps existing rules when a replacement contains an invalid rule", async () => {
    expect(await indexedDBStorage.init()).toBe(true);
    const smartPlaylist = {
      id: "five-stars", playlistId: "2rHTLOgs7Ygr6rp76Hw5n9", playlistName: "5★",
      criteria: {
        includeTagClauses: [], clauseConnectors: [], ratingFilters: [5],
        energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null,
      },
      isActive: true, createdAt: 1, lastSyncAt: 0, smartPlaylistTrackUris: [],
    };
    expect(await indexedDBStorage.saveSmartPlaylists([smartPlaylist])).toBe(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await indexedDBStorage.saveSmartPlaylists([{ playlistName: "damaged" } as never])).toBe(false);
    } finally {
      error.mockRestore();
    }
    expect(await indexedDBStorage.getAllSmartPlaylists()).toMatchObject([
      { id: "five-stars", isActive: true },
    ]);
  });
});
