import { MutableRefObject, useCallback } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { evaluateTrackMatchesCriteria } from "@/features/smart-playlists/utils/smartPlaylist.criteria";
import {
  loadSmartPlaylistsFromStorage,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";
import {
  showCleanupDeletedSmartPlaylistsNotification,
  showDeduplicationRestoreErrorNotification,
  showDeduplicationTrackLossNotification,
  showSmartPlaylistSyncErrorNotification,
  showSmartPlaylistSyncSuccessNotification,
  showSmartPlaylistSyncValidationErrorNotification,
  showTrackAddedNotification,
  showTrackRemovedNotification,
} from "@/features/smart-playlists/utils/smartPlaylist.notifications";
import { downloadSmartPlaylistsBackup } from "@/features/smart-playlists/utils/smartPlaylist.transfer";
import {
  calculatePlaylistTrackDelta,
  collectMatchingTrackUris,
  findDuplicateTrackUris,
  withUpdatedPlaylistTrackUris,
} from "@/features/smart-playlists/utils/smartPlaylist.syncUtils";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import {
  SyncOperation,
  UseSmartPlaylistProps,
} from "@/features/smart-playlists/model/useSmartPlaylists.types";
import { TrackData } from "@/types/tagData";

interface UseSmartPlaylistActionsOptions {
  tagDataRef: UseSmartPlaylistProps["tagDataRef"];
  smartPlaylists: SmartPlaylistCriteria[];
  smartPlaylistsRef: MutableRefObject<SmartPlaylistCriteria[]>;
  updateSmartPlaylistsImmediate: (
    updater: (prev: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[],
  ) => SmartPlaylistCriteria[];
  replaceSmartPlaylists: (playlists: SmartPlaylistCriteria[]) => void;
  enqueueSyncOperation: (operation: SyncOperation) => void;
}

export function useSmartPlaylistActions({
  tagDataRef,
  smartPlaylists,
  smartPlaylistsRef,
  updateSmartPlaylistsImmediate,
  replaceSmartPlaylists,
  enqueueSyncOperation,
}: UseSmartPlaylistActionsOptions) {
  const updatePlaylistTrackUris = useCallback(
    (playlistId: string, newTrackUris: string[]) => {
      updateSmartPlaylistsImmediate((playlists) =>
        withUpdatedPlaylistTrackUris(playlists, playlistId, newTrackUris),
      );
    },
    [updateSmartPlaylistsImmediate],
  );

  const createSmartPlaylist = useCallback(
    (criteria: SmartPlaylistCriteria) => {
      updateSmartPlaylistsImmediate((playlists) => [...playlists, criteria]);
    },
    [updateSmartPlaylistsImmediate],
  );

  const cleanupDeletedSmartPlaylists = useCallback(async (): Promise<void> => {
    if (smartPlaylists.length === 0) {
      return;
    }

    try {
      const allUserPlaylistIds = await spotifyApiService.getAllUserPlaylists();

      if (!allUserPlaylistIds || allUserPlaylistIds.length === 0) {
        return;
      }

      const validPlaylists = smartPlaylists.filter((playlist) =>
        allUserPlaylistIds.includes(playlist.playlistId),
      );

      if (validPlaylists.length !== smartPlaylists.length) {
        replaceSmartPlaylists(validPlaylists);
        showCleanupDeletedSmartPlaylistsNotification(
          smartPlaylists.length - validPlaylists.length,
        );
      }
    } catch (error) {
      console.error("Problem fetching or processing playlists:", error);
    }
  }, [replaceSmartPlaylists, smartPlaylists]);

  const syncMultipleTracksWithSmartPlaylists = useCallback(
    async (trackUpdates: Record<string, TrackData | null>): Promise<void> => {
      const operationId = `multi-${Date.now()}-${Math.random()}`;

      const syncOperation: SyncOperation = {
        id: operationId,
        type: "multiple",
        execute: async () => {
          const currentPlaylists = smartPlaylistsRef.current;

          if (!currentPlaylists || currentPlaylists.length === 0) {
            return;
          }

          for (const playlist of currentPlaylists) {
            if (!playlist?.playlistId || !playlist.isActive) {
              continue;
            }

            const currentPlaylistData = smartPlaylistsRef.current.find(
              (candidate) => candidate.playlistId === playlist.playlistId,
            );
            if (!currentPlaylistData) {
              continue;
            }

            let trackUris = [...(currentPlaylistData.smartPlaylistTrackUris || [])];
            let hasChanges = false;

            for (const [trackUri, trackData] of Object.entries(trackUpdates)) {
              const isCurrentlyTracked = trackUris.includes(trackUri);

              if (!trackData) {
                if (!isCurrentlyTracked) {
                  continue;
                }

                const success = await spotifyApiService.removeTrackFromPlaylist(
                  trackUri,
                  playlist.playlistId,
                );

                if (success) {
                  trackUris = trackUris.filter((uri) => uri !== trackUri);
                  hasChanges = true;
                  updatePlaylistTrackUris(playlist.playlistId, trackUris);
                  showTrackRemovedNotification(playlist.playlistName);
                }

                continue;
              }

              const matches = evaluateTrackMatchesCriteria(
                trackData,
                playlist.criteria,
              );

              if (matches && !isCurrentlyTracked) {
                const result = await spotifyApiService.addTrackToSpotifyPlaylist(
                  trackUri,
                  playlist.playlistId,
                );

                if (result.success && !trackUris.includes(trackUri)) {
                  trackUris.push(trackUri);
                  hasChanges = true;
                  updatePlaylistTrackUris(playlist.playlistId, trackUris);
                  showTrackAddedNotification(trackUri, playlist.playlistName);
                }

                continue;
              }

              if (!matches && isCurrentlyTracked) {
                const success = await spotifyApiService.removeTrackFromPlaylist(
                  trackUri,
                  playlist.playlistId,
                );

                if (success) {
                  trackUris = trackUris.filter((uri) => uri !== trackUri);
                  hasChanges = true;
                  updatePlaylistTrackUris(playlist.playlistId, trackUris);
                  showTrackRemovedNotification(playlist.playlistName);
                }
              }
            }

            if (!hasChanges) {
              continue;
            }

            try {
              const actualTrackUris =
                await spotifyApiService.getAllTrackUrisInPlaylist(
                  playlist.playlistId,
                );

              if (actualTrackUris && actualTrackUris.length >= 0) {
                updatePlaylistTrackUris(playlist.playlistId, actualTrackUris);
              }
            } catch (error) {
              console.error(
                `[${operationId}] Validation failed for ${playlist.playlistName}:`,
                error,
              );
            }
          }
        },
      };

      enqueueSyncOperation(syncOperation);
    },
    [enqueueSyncOperation, smartPlaylistsRef, updatePlaylistTrackUris],
  );

  const syncTrackWithSmartPlaylists = useCallback(
    async (trackUri: string, trackData: TrackData | null): Promise<void> => {
      await smartPlaylistSyncService.syncTrack(trackUri, trackData);

      const playlistsFromStorage = loadSmartPlaylistsFromStorage();
      replaceSmartPlaylists(playlistsFromStorage);
    },
    [replaceSmartPlaylists],
  );

  const syncSmartPlaylistFull = useCallback(
    async (playlist: SmartPlaylistCriteria): Promise<void> => {
      try {
        if (!playlist.isActive) {
          return;
        }

        const allTrackUrisInPlaylist =
          await spotifyApiService.getAllTrackUrisInPlaylist(playlist.playlistId);

        if (!allTrackUrisInPlaylist || allTrackUrisInPlaylist.length === 0) {
          return;
        }

        const { occurrences, duplicateUris } =
          findDuplicateTrackUris(allTrackUrisInPlaylist);

        let duplicatesRemovedCount = 0;

        for (const trackUri of duplicateUris) {
          const originalCount = occurrences.get(trackUri) || 0;

          try {
            const removeSuccess = await spotifyApiService.removeTrackFromPlaylist(
              trackUri,
              playlist.playlistId,
            );

            if (!removeSuccess) {
              continue;
            }

            try {
              const addResult = await spotifyApiService.addTrackToSpotifyPlaylist(
                trackUri,
                playlist.playlistId,
              );

              if (addResult.success && addResult.wasAdded) {
                duplicatesRemovedCount += originalCount - 1;
              } else {
                console.error(`Failed to re-add deduplicated track: ${trackUri}`);
                showDeduplicationTrackLossNotification(trackUri);
              }
            } catch (addError) {
              console.error(`API error re-adding track ${trackUri}:`, addError);
              showDeduplicationRestoreErrorNotification();
            }
          } catch (removeError) {
            console.error(
              `API error removing duplicates for ${trackUri}:`,
              removeError,
            );
          }
        }

        let currentTrackUrisInPlaylist: string[] = [];

        try {
          currentTrackUrisInPlaylist =
            await spotifyApiService.getAllTrackUrisInPlaylist(playlist.playlistId);
        } catch (error) {
          console.error(
            "Failed to fetch playlist state after deduplication:",
            error,
          );
          showSmartPlaylistSyncValidationErrorNotification(playlist.playlistName);
          return;
        }

        const matchingTrackUris = collectMatchingTrackUris(
          tagDataRef.current.tracks,
          playlist.criteria,
        );

        const { tracksToAdd, tracksToRemove } = calculatePlaylistTrackDelta(
          currentTrackUrisInPlaylist,
          matchingTrackUris,
        );

        let addedCount = 0;
        let removedCount = 0;

        for (const trackUri of tracksToRemove) {
          try {
            const success = await spotifyApiService.removeTrackFromPlaylist(
              trackUri,
              playlist.playlistId,
            );
            if (success) {
              removedCount += 1;
            }
          } catch (error) {
            console.error(`Failed to remove track ${trackUri}:`, error);
          }
        }

        for (const trackUri of tracksToAdd) {
          try {
            const result = await spotifyApiService.addTrackToSpotifyPlaylist(
              trackUri,
              playlist.playlistId,
            );
            if (result.success && result.wasAdded) {
              addedCount += 1;
            }
          } catch (error) {
            console.error(`Failed to add track ${trackUri}:`, error);
          }
        }

        updatePlaylistTrackUris(playlist.playlistId, matchingTrackUris);

        showSmartPlaylistSyncSuccessNotification(
          playlist.playlistName,
          addedCount,
          removedCount,
          duplicatesRemovedCount,
        );

        console.log(`Full sync completed for playlist: ${playlist.playlistName}`);
      } catch (error) {
        console.error(
          `Critical error in syncSmartPlaylistFull for ${playlist.playlistName}:`,
          error,
        );
        showSmartPlaylistSyncErrorNotification(playlist.playlistName);
      }
    },
    [tagDataRef, updatePlaylistTrackUris],
  );

  const exportSmartPlaylists = useCallback(() => {
    downloadSmartPlaylistsBackup(smartPlaylists);
    Spicetify.showNotification("Backup saved in 'Downloads' folder");
  }, [smartPlaylists]);

  const importSmartPlaylists = useCallback(
    (backupData: SmartPlaylistCriteria[]) => {
      replaceSmartPlaylists(backupData);
    },
    [replaceSmartPlaylists],
  );

  return {
    syncSmartPlaylistFull,
    syncMultipleTracksWithSmartPlaylists,
    syncTrackWithSmartPlaylists,
    createSmartPlaylist,
    cleanupDeletedSmartPlaylists,
    exportSmartPlaylists,
    importSmartPlaylists,
  };
}
