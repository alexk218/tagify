import { useCallback } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { clearConfirmedMembershipBaselines } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import {
  showSmartPlaylistSyncErrorNotification,
  showSmartPlaylistSyncSuccessNotification,
} from "@/features/smart-playlists/utils/smartPlaylist.notifications";
import {
  createSmartPlaylistRecipeBundle,
  downloadSmartPlaylistRecipeBundle,
} from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import {
  mergeImportedSmartPlaylists,
  prepareSmartPlaylistImport,
  SmartPlaylistImportSummary,
} from "@/features/smart-playlists/utils/smartPlaylist.import";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { TagTaxonomy, TrackData } from "@/types/tagData";

interface UseSmartPlaylistActionsOptions {
  smartPlaylists: SmartPlaylistCriteria[];
  updateSmartPlaylistsImmediate: (
    updater: (prev: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[],
  ) => Promise<SmartPlaylistCriteria[]>;
  replaceSmartPlaylists: (playlists: SmartPlaylistCriteria[]) => Promise<void>;
  refreshSmartPlaylists: () => Promise<void>;
}

export function useSmartPlaylistActions({
  smartPlaylists,
  updateSmartPlaylistsImmediate,
  replaceSmartPlaylists,
  refreshSmartPlaylists,
}: UseSmartPlaylistActionsOptions) {
  const createSmartPlaylist = useCallback(
    async (criteria: SmartPlaylistCriteria) => {
      await updateSmartPlaylistsImmediate((playlists) => [...playlists, criteria]);
    },
    [updateSmartPlaylistsImmediate],
  );

  const syncMultipleTracksWithSmartPlaylists = useCallback(
    async (trackUpdates: Record<string, TrackData | null>): Promise<void> => {
      await smartPlaylistSyncService.syncTracks(trackUpdates);
      await refreshSmartPlaylists();
    },
    [refreshSmartPlaylists],
  );

  const syncTrackWithSmartPlaylists = useCallback(
    async (trackUri: string, trackData: TrackData | null): Promise<void> => {
      await smartPlaylistSyncService.syncTrack(trackUri, trackData);
      await refreshSmartPlaylists();
    },
    [refreshSmartPlaylists],
  );

  const syncSmartPlaylistFull = useCallback(
    async (playlist: SmartPlaylistCriteria): Promise<void> => {
      if (!playlist.isActive) {
        return;
      }

      try {
        const summary = await smartPlaylistSyncService.reconcilePlaylist(
          playlist.playlistId,
        );
        await refreshSmartPlaylists();

        if (summary.failedPlaylistNames.length > 0) {
          showSmartPlaylistSyncErrorNotification(playlist.playlistName);
          return;
        }
        showSmartPlaylistSyncSuccessNotification(
          playlist.playlistName,
          summary.addedCount,
          summary.removedCount,
          summary.metadataUpdatedCount,
          summary.duplicatesRemovedCount,
        );
      } catch (error) {
        console.error(
          `Critical error syncing smart playlist ${playlist.playlistName}:`,
          error,
        );
        showSmartPlaylistSyncErrorNotification(playlist.playlistName);
      }
    },
    [refreshSmartPlaylists],
  );

  const exportSmartPlaylists = useCallback(async (taxonomy: TagTaxonomy, selected?: SmartPlaylistCriteria[]) => {
    try {
      downloadSmartPlaylistRecipeBundle(await createSmartPlaylistRecipeBundle(selected ?? smartPlaylists, taxonomy));
      Spicetify.showNotification("Smart playlist setups saved to Downloads");
    } catch (error) {
      console.error("Smart playlist export failed", error);
      throw error;
    }
  }, [smartPlaylists]);

  const importSmartPlaylists = useCallback(
    async (
      backupData: SmartPlaylistCriteria[],
    ): Promise<SmartPlaylistImportSummary> => {
      let playlistsToImport: SmartPlaylistCriteria[];
      let summary: SmartPlaylistImportSummary;
      try {
        const currentPlaylists =
          await spotifyApiService.getAllUserPlaylistReferencesStrict();
        const prepared = prepareSmartPlaylistImport(
          backupData,
          currentPlaylists,
        );
        playlistsToImport = prepared.playlists;
        summary = {
          importedCount: prepared.playlists.length,
          relinkedCount: prepared.relinkedCount,
          unresolvedCount: prepared.unresolvedCount,
          verificationUnavailable: false,
        };
      } catch (error) {
        console.error("Could not verify imported smart playlists:", error);
        playlistsToImport = backupData.map((playlist) => ({
          ...playlist,
          playlistId: "",
          isActive: false,
          lastSyncAt: 0,
          smartPlaylistTrackUris: [],
        }));
        summary = {
          importedCount: backupData.length,
          relinkedCount: 0,
          unresolvedCount: backupData.length,
          verificationUnavailable: true,
        };
      }
      await replaceSmartPlaylists(mergeImportedSmartPlaylists(smartPlaylists, playlistsToImport));
      clearConfirmedMembershipBaselines();
      return summary;
    },
    [replaceSmartPlaylists, smartPlaylists],
  );

  return {
    syncSmartPlaylistFull,
    syncMultipleTracksWithSmartPlaylists,
    syncTrackWithSmartPlaylists,
    createSmartPlaylist,
    exportSmartPlaylists,
    importSmartPlaylists,
  };
}
