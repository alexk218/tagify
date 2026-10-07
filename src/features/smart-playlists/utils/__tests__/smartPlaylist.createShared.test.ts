import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { defaultTagData } from "@/constants/defaultTagData";
import { createSharedSmartPlaylist } from "../smartPlaylist.createShared";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import type { SmartPlaylistCriteria } from "../../model/smartPlaylist.types";

const setup: SmartPlaylistCriteria = { id: "new-shared", playlistId: "", playlistName: "New shared mix", isActive: false, createdAt: 1, lastSyncAt: 0, smartPlaylistTrackUris: [], source: { recipeId: "share", revision: 1 },
  criteria: { includeTagClauses: [], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null } };
const summary = { addedCount: 0, removedCount: 0, metadataUpdatedCount: 0, duplicatesRemovedCount: 0, failedPlaylistNames: [] };

describe("creating a playlist from a shared setup", () => {
  beforeEach(async () => { vi.stubGlobal("indexedDB", new IDBFactory()); indexedDBStorage.resetConnection(); await indexedDBStorage.init(); vi.spyOn(storageService, "isReady").mockReturnValue(true); await indexedDBStorage.saveAll({ ...defaultTagData, smartPlaylists: [setup] }); });
  afterEach(() => { indexedDBStorage.resetConnection(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("saves the new connection before any Spotify sync and coalesces double clicks", async () => {
    const create = vi.spyOn(spotifyApiService, "createPrivatePlaylist").mockResolvedValue("new-spotify");
    const sync = vi.spyOn(smartPlaylistSyncService, "reconcilePlaylist").mockImplementation(async () => { expect((await indexedDBStorage.getAllSmartPlaylists())[0]).toMatchObject({ playlistId: "new-spotify", isActive: true }); return summary; });
    await Promise.all([createSharedSmartPlaylist(setup.id!), createSharedSmartPlaylist(setup.id!)]);
    expect(create).toHaveBeenCalledOnce(); expect(sync).toHaveBeenCalledOnce();
    await createSharedSmartPlaylist(setup.id!); expect(create).toHaveBeenCalledOnce();
  });
  it("retries against the same created playlist after a local save failure", async () => {
    const create = vi.spyOn(spotifyApiService, "createPrivatePlaylist").mockResolvedValue("created-but-unsaved");
    const save = vi.spyOn(indexedDBStorage, "saveSmartPlaylists").mockResolvedValueOnce(false);
    const sync = vi.spyOn(smartPlaylistSyncService, "reconcilePlaylist").mockResolvedValue(summary);
    await expect(createSharedSmartPlaylist(setup.id!)).rejects.toThrow("same playlist");
    expect(sync).not.toHaveBeenCalled(); expect((await indexedDBStorage.getAllSmartPlaylists())[0].playlistId).toBe("");
    save.mockRestore(); await createSharedSmartPlaylist(setup.id!);
    expect(create).toHaveBeenCalledOnce(); expect(sync).toHaveBeenCalledWith("created-but-unsaved");
  });
  it("leaves the saved setup unchanged when Spotify creation fails", async () => {
    vi.spyOn(spotifyApiService, "createPrivatePlaylist").mockRejectedValue(new Error("Spotify is offline"));
    await expect(createSharedSmartPlaylist(setup.id!)).rejects.toThrow("offline");
    expect((await indexedDBStorage.getAllSmartPlaylists())[0]).toMatchObject({ playlistId: "", isActive: false });
  });
  it("recovers a created connection saved before a previous session ended", async () => {
    const key = `tagify:shared-playlist-creation:${getTagifyDatabaseName()}:${setup.id}`;
    localStorage.setItem(key, "recovered-playlist");
    const create = vi.spyOn(spotifyApiService, "createPrivatePlaylist");
    const sync = vi.spyOn(smartPlaylistSyncService, "reconcilePlaylist").mockResolvedValue(summary);
    await expect(createSharedSmartPlaylist(setup.id!)).resolves.toMatchObject({ playlistId: "recovered-playlist", isActive: true });
    expect(create).not.toHaveBeenCalled(); expect(sync).toHaveBeenCalledWith("recovered-playlist");
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("requests a private, non-collaborative playlist using Spotify’s current endpoint", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "NewSpotifyId" }) }); vi.stubGlobal("fetch", request);
    await expect(spotifyApiService.createPrivatePlaylist("My mix", "Five stars")).resolves.toBe("NewSpotifyId");
    expect(request).toHaveBeenCalledWith("https://api.spotify.com/v1/me/playlists", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "My mix", description: "Five stars", public: false, collaborative: false }) }));
  });
});
