import { getTagifyDatabaseName, flushLocalPersistence } from "@/services/sync/SyncLocalState";
import { storageService } from "@/services/storage/StorageService";
import { useCallback } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { clearConfirmedMembershipBaseline, updateSmartPlaylistsInStorage } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { describeSmartPlaylistCheckFailure } from "@/features/smart-playlists/utils/smartPlaylist.checkFailure";
import {
  showSmartPlaylistSyncErrorNotification,
  showSmartPlaylistSyncSuccessNotification,
} from "@/features/smart-playlists/utils/smartPlaylist.notifications";
import {
  createSmartPlaylistRecipeBundle,
  downloadSmartPlaylistRecipeBundle,
} from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import {
  downloadPersonalSmartPlaylistBackup,
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
          showSmartPlaylistSyncErrorNotification(playlist.playlistName, summary.checkFailure);
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
        showSmartPlaylistSyncErrorNotification(playlist.playlistName, describeSmartPlaylistCheckFailure(error));
      }
    },
    [refreshSmartPlaylists],
  );

  const exportSmartPlaylists = useCallback(async (taxonomy: TagTaxonomy, selected?: SmartPlaylistCriteria[], personalBackup = false) => {
    try {
      if (personalBackup) downloadPersonalSmartPlaylistBackup(selected ?? smartPlaylists);
      else downloadSmartPlaylistRecipeBundle(await createSmartPlaylistRecipeBundle(selected ?? smartPlaylists, taxonomy));
      Spicetify.showNotification(personalBackup ? "Smart Playlist backup saved to Downloads" : "Smart playlist setups saved to Downloads");
    } catch (error) {
      console.error("Smart playlist export failed", error);
      throw error;
    }
  }, [smartPlaylists]);

  const importSmartPlaylists = useCallback(
    async (
      backupData: SmartPlaylistCriteria[],
    ): Promise<SmartPlaylistImportSummary> => {
      const account = getTagifyDatabaseName();
      const checkAccount = () => { if (getTagifyDatabaseName() !== account) throw new Error("Your Spotify account changed. Return to the account where you started restoring this backup."); };
      await flushLocalPersistence();
      const library = await storageService.loadAllStrict();
      checkAccount();
      if (backupData.some((playlist) => playlist.criteria.includeTagClauses.some((clause) =>
        [...clause.tagIds, ...clause.excludedTagIds].some((id) => !library.taxonomy.tagsById[id])))) {
        throw new Error("This backup uses tags that aren’t in your library. Import your tag backup first, then restore these Smart Playlists.");
      }
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
      checkAccount();
      const saved = await updateSmartPlaylistsInStorage((current) => { checkAccount(); return mergeImportedSmartPlaylists(current, playlistsToImport); });
      playlistsToImport.forEach(clearConfirmedMembershipBaseline);
      window.dispatchEvent(new CustomEvent("tagify:smartPlaylistsUpdated", { detail: { playlists: saved } }));
      return summary;
    },
    [],
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
