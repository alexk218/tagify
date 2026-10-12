import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { defaultTagData } from "@/constants/defaultTagData";
import { connectExistingSmartPlaylist } from "../smartPlaylist.connectExisting";
import { clearConfirmedMembershipBaselines } from "../smartPlaylist.storage";
import type { SmartPlaylistCriteria } from "../../model/smartPlaylist.types";

const setup: SmartPlaylistCriteria = { id: "shared", playlistId: "", playlistName: "Shared stars", isActive: false, createdAt: 1, lastSyncAt: 0, smartPlaylistTrackUris: [], source: { recipeId: "share", revision: 1 },
  criteria: { includeTagClauses: [], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null } };
const selected = { playlistId: "existing", playlistName: "My favourites" };
const oldSong = "spotify:track:old";
const matchingSong = "spotify:track:matching";
const tracks = {
  [oldSong]: { rating: 1, tagIds: [], energy: 2, bpm: null, dateModified: 10 },
  [matchingSong]: { rating: 5, tagIds: [], energy: 3, bpm: null, dateModified: 20 },
};

describe("connecting shared rules to an existing playlist", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); indexedDBStorage.resetConnection();
    await indexedDBStorage.init(); vi.spyOn(storageService, "isReady").mockReturnValue(true);
    clearConfirmedMembershipBaselines();
    await indexedDBStorage.saveAll({ ...defaultTagData, tracks, smartPlaylists: [setup] });
    vi.spyOn(spotifyApiService, "getAllUserPlaylistReferencesStrict").mockResolvedValue([selected]);
  });
  afterEach(() => { indexedDBStorage.resetConnection(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("reuses Spotify, syncs membership, and preserves historical songs' annotations and timestamps", async () => {
    let members = [oldSong];
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockImplementation(async () => [...members]);
    const create = vi.spyOn(spotifyApiService, "createPrivatePlaylist");
    const update = vi.spyOn(spotifyApiService, "updatePlaylistTracks").mockImplementation(async (_id, additions, removals) => {
      const added = additions.filter(uri => !members.includes(uri));
      const removed = removals.filter(uri => members.includes(uri));
      members = [...members.filter(uri => !removed.includes(uri)), ...added];
      return { added, removed, success: true };
    });
    await Promise.all([connectExistingSmartPlaylist(setup.id!, selected), connectExistingSmartPlaylist(setup.id!, selected)]);
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("existing", [matchingSong], [oldSong], [oldSong], expect.objectContaining({ priority: "foreground", feature: "smart-playlists" }));
    expect(members).toEqual([matchingSong]);
    const saved = await indexedDBStorage.loadAllStrict();
    expect(saved.smartPlaylists?.[0]).toMatchObject({ playlistId: "existing", playlistName: "My favourites", isActive: true, source: setup.source });
    expect(saved.tracks[oldSong]).toMatchObject(tracks[oldSong]);
    expect(saved.tracks[matchingSong]).toMatchObject(tracks[matchingSong]);
  });

  it("does not save or sync when Spotify membership cannot be read", async () => {
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockRejectedValue(new Error("offline"));
    const sync = vi.spyOn(smartPlaylistSyncService, "reconcilePlaylist");
    await expect(connectExistingSmartPlaylist(setup.id!, selected)).rejects.toThrow("couldn’t read");
    expect(sync).not.toHaveBeenCalled();
    expect((await indexedDBStorage.getAllSmartPlaylists())[0]).toMatchObject({ playlistId: "", isActive: false });
  });

  it("refuses an existing playlist already managed by another setup", async () => {
    await indexedDBStorage.saveSmartPlaylists([setup, { ...setup, id: "other", playlistId: "existing" }]);
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockResolvedValue([]);
    const sync = vi.spyOn(smartPlaylistSyncService, "reconcilePlaylist");
    await expect(connectExistingSmartPlaylist(setup.id!, selected)).rejects.toThrow("already uses");
    expect(sync).not.toHaveBeenCalled();
    expect((await indexedDBStorage.getAllSmartPlaylists()).find((playlist) => playlist.id === setup.id)?.playlistId).toBe("");
  });

  it("stops before saving or syncing if the account changes during Spotify verification", async () => {
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockImplementation(async () => { localStorage.setItem("tagify:sync:account-id", "different-account"); return []; });
    const save = vi.spyOn(indexedDBStorage, "saveSmartPlaylists");
    const sync = vi.spyOn(smartPlaylistSyncService, "reconcilePlaylist");
    await expect(connectExistingSmartPlaylist(setup.id!, selected)).rejects.toThrow("account changed");
    expect(save).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled();
    localStorage.removeItem("tagify:sync:account-id");
    expect((await indexedDBStorage.getAllSmartPlaylists()).find((playlist) => playlist.id === setup.id)?.playlistId).toBe("");
  });

  it("does not sync until the connection is saved, and allows retry after a save failure", async () => {
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockResolvedValue([]);
    const save = vi.spyOn(indexedDBStorage, "saveSmartPlaylists").mockResolvedValueOnce(false);
    const sync = vi.spyOn(smartPlaylistSyncService, "reconcilePlaylist").mockResolvedValue({ addedCount: 0, removedCount: 0, duplicatesRemovedCount: 0, metadataUpdatedCount: 0, failedPlaylistNames: [] });
    await expect(connectExistingSmartPlaylist(setup.id!, selected)).rejects.toThrow("save");
    expect(sync).not.toHaveBeenCalled(); save.mockRestore();
    await connectExistingSmartPlaylist(setup.id!, selected);
    expect(sync).toHaveBeenCalledWith("existing");
  });
});
