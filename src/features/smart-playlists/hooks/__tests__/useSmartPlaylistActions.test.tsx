import * as playlistStorage from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { storageService } from "@/services/storage/StorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { useSmartPlaylistActions } from "../useSmartPlaylistActions";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";

const importedPlaylist: SmartPlaylistCriteria = {
  playlistId: "old-id",
  playlistName: "House Mix",
  isActive: true,
  createdAt: 1,
  lastSyncAt: 2,
  smartPlaylistTrackUris: ["spotify:track:old"],
  criteria: {
    includeTagClauses: [],
    clauseConnectors: [],
    ratingFilters: [],
    energyMinFilter: null,
    energyMaxFilter: null,
    bpmMinFilter: null,
    bpmMaxFilter: null,
  },
};

describe("useSmartPlaylistActions imports", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(storageService, "loadAllStrict").mockResolvedValue(defaultTagData);
  });

  it("waits for a relinked import to be saved before reporting success", async () => {
    vi.spyOn(spotifyApiService, "getAllUserPlaylistReferencesStrict").mockResolvedValue([
      { playlistId: "current-id", playlistName: "House Mix" },
    ]);
    let finishSaving!: () => void;
    const save = new Promise<void>((resolve) => { finishSaving = resolve; });
    const updateSmartPlaylistsImmediate = vi.fn();
    const saving = vi.spyOn(playlistStorage, "updateSmartPlaylistsInStorage").mockImplementation(async (updater) => { await save; return updater([]); });
    const { result } = renderHook(() => useSmartPlaylistActions({
      smartPlaylists: [],
      updateSmartPlaylistsImmediate,
      replaceSmartPlaylists: vi.fn(),
      refreshSmartPlaylists: vi.fn(),
    }));

    let completed = false;
    const importing = result.current.importSmartPlaylists([importedPlaylist]).then((summary) => {
      completed = true;
      return summary;
    });
    await vi.waitFor(() => expect(saving).toHaveBeenCalledTimes(1));
    expect(completed).toBe(false);
    expect(saving.mock.calls[0][0]([])[0]).toMatchObject({
      playlistId: "current-id",
      isActive: true,
      smartPlaylistTrackUris: [],
    });

    await act(async () => finishSaving());
    await expect(importing).resolves.toMatchObject({
      importedCount: 1,
      relinkedCount: 1,
      verificationUnavailable: false,
    });
  });

  it("does not claim import success when saving fails", async () => {
    vi.spyOn(spotifyApiService, "getAllUserPlaylistReferencesStrict").mockResolvedValue([]);
    const updateSmartPlaylistsImmediate = vi.fn();
    const saving = vi.spyOn(playlistStorage, "updateSmartPlaylistsInStorage").mockRejectedValue(new Error("storage full"));
    const { result } = renderHook(() => useSmartPlaylistActions({
      smartPlaylists: [],
      updateSmartPlaylistsImmediate,
      replaceSmartPlaylists: vi.fn(),
      refreshSmartPlaylists: vi.fn(),
    }));

    await expect(result.current.importSmartPlaylists([importedPlaylist])).rejects.toThrow("storage full");
    expect(saving).toHaveBeenCalledTimes(1);
  });

  it("keeps uncertain matches inactive when Spotify verification fails", async () => {
    vi.spyOn(spotifyApiService, "getAllUserPlaylistReferencesStrict").mockRejectedValue(new Error("offline"));
    const update = vi.spyOn(playlistStorage, "updateSmartPlaylistsInStorage").mockImplementation(async (updater) => updater([]));
    const { result } = renderHook(() => useSmartPlaylistActions({ smartPlaylists: [], updateSmartPlaylistsImmediate: vi.fn(), replaceSmartPlaylists: vi.fn(), refreshSmartPlaylists: vi.fn() }));
    const summary = await result.current.importSmartPlaylists([importedPlaylist]);
    expect(summary).toMatchObject({ unresolvedCount: 1, verificationUnavailable: true });
    expect(update.mock.calls[0][0]([])[0]).toMatchObject({ playlistId: "", isActive: false });
  });
  it("requires the matching tags before restoring rules, without changing existing playlists", async () => {
    const update = vi.spyOn(playlistStorage, "updateSmartPlaylistsInStorage");
    const { result } = renderHook(() => useSmartPlaylistActions({ smartPlaylists: [], updateSmartPlaylistsImmediate: vi.fn(), replaceSmartPlaylists: vi.fn(), refreshSmartPlaylists: vi.fn() }));
    await expect(result.current.importSmartPlaylists([{ ...importedPlaylist, criteria: { ...importedPlaylist.criteria, includeTagClauses: [{ tagIds: ["missing"], excludedTagIds: [], operator: "AND" }] } }])).rejects.toThrow("Import your tag backup first");
    expect(update).not.toHaveBeenCalled();
  });

  it("shows only a failure when Spotify could not read the selected playlist", async () => {
    vi.spyOn(smartPlaylistSyncService, "reconcilePlaylist").mockResolvedValue({
      addedCount: 0,
      removedCount: 0,
      metadataUpdatedCount: 0,
      duplicatesRemovedCount: 0,
      failedPlaylistNames: ["House Mix"],
    });
    const notify = vi.spyOn(Spicetify, "showNotification").mockImplementation(() => {});
    const { result } = renderHook(() => useSmartPlaylistActions({
      smartPlaylists: [importedPlaylist],
      updateSmartPlaylistsImmediate: vi.fn(),
      replaceSmartPlaylists: vi.fn(),
      refreshSmartPlaylists: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => result.current.syncSmartPlaylistFull(importedPlaylist));

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][1]).toBe(true);
  });
});
