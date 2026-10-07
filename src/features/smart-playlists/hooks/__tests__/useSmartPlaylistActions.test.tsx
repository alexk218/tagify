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
  });

  it("waits for a relinked import to be saved before reporting success", async () => {
    vi.spyOn(spotifyApiService, "getAllUserPlaylistReferencesStrict").mockResolvedValue([
      { playlistId: "current-id", playlistName: "House Mix" },
    ]);
    let finishSaving!: () => void;
    const save = new Promise<void>((resolve) => { finishSaving = resolve; });
    const replaceSmartPlaylists = vi.fn().mockReturnValue(save);
    const { result } = renderHook(() => useSmartPlaylistActions({
      smartPlaylists: [],
      updateSmartPlaylistsImmediate: vi.fn(),
      replaceSmartPlaylists,
      refreshSmartPlaylists: vi.fn(),
    }));

    let completed = false;
    const importing = result.current.importSmartPlaylists([importedPlaylist]).then((summary) => {
      completed = true;
      return summary;
    });
    await vi.waitFor(() => expect(replaceSmartPlaylists).toHaveBeenCalledTimes(1));
    expect(completed).toBe(false);
    expect(replaceSmartPlaylists.mock.calls[0][0][0]).toMatchObject({
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
    const replaceSmartPlaylists = vi.fn().mockRejectedValue(new Error("storage full"));
    const { result } = renderHook(() => useSmartPlaylistActions({
      smartPlaylists: [],
      updateSmartPlaylistsImmediate: vi.fn(),
      replaceSmartPlaylists,
      refreshSmartPlaylists: vi.fn(),
    }));

    await expect(result.current.importSmartPlaylists([importedPlaylist])).rejects.toThrow("storage full");
    expect(replaceSmartPlaylists).toHaveBeenCalledTimes(1);
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
