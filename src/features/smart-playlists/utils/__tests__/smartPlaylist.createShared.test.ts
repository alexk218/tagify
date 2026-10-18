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
  it("creates a private playlist with its description on desktop, without the Web API", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    const createPlaylist = vi.fn().mockResolvedValue("spotify:playlist:NewSpotifyId");
    const setBasePermission = vi.fn().mockResolvedValue(undefined), updateDetails = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("Spicetify", { ...Spicetify, Platform: { ...Spicetify.Platform, RootlistAPI: { createPlaylist, remove: vi.fn() },
      PlaylistPermissionsAPI: { setBasePermission, getBasePermission: vi.fn().mockResolvedValue("BLOCKED") }, PlaylistAPI: { ...Spicetify.Platform.PlaylistAPI, updateDetails } } });
    await expect(spotifyApiService.createPrivatePlaylist("My mix", "Five stars")).resolves.toBe("NewSpotifyId");
    expect(setBasePermission).toHaveBeenCalledWith("spotify:playlist:NewSpotifyId", "BLOCKED");
    expect(updateDetails).toHaveBeenCalledWith("spotify:playlist:NewSpotifyId", { description: "Five stars" });
    expect(request).not.toHaveBeenCalled();
  });
  it("removes a new playlist again rather than leaving it public", async () => {
    vi.useFakeTimers();
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("Spicetify", { ...Spicetify, Platform: { ...Spicetify.Platform, RootlistAPI: { createPlaylist: vi.fn().mockResolvedValue("spotify:playlist:Stuck"), remove },
      PlaylistPermissionsAPI: { setBasePermission: vi.fn().mockResolvedValue(undefined), getBasePermission: vi.fn().mockResolvedValue("VIEWER") } } });
    const result = expect(spotifyApiService.createPrivatePlaylist("My mix")).rejects.toThrow("removed it");
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(remove).toHaveBeenCalledWith([{ uri: "spotify:playlist:Stuck" }]);
    vi.useRealTimers();
  });
  it("tells the user to fix a playlist that stayed public when Spotify won't remove it either", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Spicetify", { ...Spicetify, Platform: { ...Spicetify.Platform, RootlistAPI: { createPlaylist: vi.fn().mockResolvedValue("spotify:playlist:Stuck"), remove: vi.fn().mockRejectedValue(new Error("offline")) },
      PlaylistPermissionsAPI: { setBasePermission: vi.fn().mockResolvedValue(undefined), getBasePermission: vi.fn().mockResolvedValue("VIEWER") } } });
    const result = expect(spotifyApiService.createPrivatePlaylist("My mix")).rejects.toThrow("Make it private or delete it in Spotify");
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    vi.useRealTimers();
  });
});
