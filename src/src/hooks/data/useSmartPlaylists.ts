import { useCallback, useEffect, useRef, useState } from "react";
import { TagDataStructure, TrackData } from "@/hooks/data/useTagData";
import { spotifyApiService } from "@/services/SpotifyApiService";

interface SyncOperation {
  id: string;
  type: "single" | "multiple";
  execute: () => Promise<void>;
}

export interface SmartPlaylistCriteria {
  playlistId: string;
  playlistName: string;
  criteria: {
    activeTagFilters: {
      categoryId: string;
      subcategoryId: string;
      tagId: string;
    }[];
    excludedTagFilters: {
      categoryId: string;
      subcategoryId: string;
      tagId: string;
    }[];
    ratingFilters: number[];
    energyMinFilter: number | null;
    energyMaxFilter: number | null;
    bpmMinFilter: number | null;
    bpmMaxFilter: number | null;
    isOrFilterMode: boolean;
  };
  isActive: boolean;
  createdAt: number;
  lastSyncAt: number;
  smartPlaylistTrackUris: string[];
}

interface UseSmartPlaylistProps {
  tagData: TagDataStructure;
}

const SMART_PLAYLIST_KEY = "tagify:smartPlaylists";

export function useSmartPlaylists({ tagData }: UseSmartPlaylistProps) {
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylistCriteria[]>(
    []
  );

  // Single queue processor promise to prevent race conditions
  const queueProcessorRef = useRef<Promise<void> | null>(null);
  const smartPlaylistsRef = useRef<SmartPlaylistCriteria[]>([]);
  const syncQueueRef = useRef<SyncOperation[]>([]);

  // keep ref in sync with state
  useEffect(() => {
    smartPlaylistsRef.current = smartPlaylists;
  }, [smartPlaylists]);

  // Process sync operations sequentially
  const processSyncQueue = useCallback(async () => {
    // If processor is already running, wait for it to complete
    if (queueProcessorRef.current) {
      await queueProcessorRef.current;
      return;
    }

    // Start processing if queue has items
    if (syncQueueRef.current.length === 0) {
      return;
    }

    // Create the processor promise that processes ONE operation at a time
    queueProcessorRef.current = (async () => {
      try {
        while (syncQueueRef.current.length > 0) {
          const operation = syncQueueRef.current.shift()!;

          const startTime = Date.now();

          try {
            // Fully await each operation before moving to next
            await operation.execute();
          } catch (error) {
            const duration = Date.now() - startTime;
            console.error(
              `FAILED operation ${operation.id} after ${duration}ms:`,
              error
            );
          }
        }
      } finally {
        queueProcessorRef.current = null;
      }
    })();

    // Wait for the entire queue to complete
    await queueProcessorRef.current;
  }, []);

  // Thread-safe state updater using functional updates
  const updateSmartPlaylistsImmediate = useCallback(
    (updater: (prev: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[]) => {
      const currentPlaylists = smartPlaylistsRef.current;
      const updated = updater(currentPlaylists);

      if (currentPlaylists.length > 0 && updated.length === 0) {
        return currentPlaylists;
      }

      // Update ref immediately - this is the source of truth
      smartPlaylistsRef.current = updated;

      // Update React state
      setSmartPlaylists(updated);

      // Save to localStorage
      try {
        localStorage.setItem(SMART_PLAYLIST_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error("Error saving smart playlist data:", error);
      }

      return updated;
    },
    []
  );

  // Load smart playlists on mount
  useEffect(() => {
    try {
      const savedSmartPlaylists = localStorage.getItem(SMART_PLAYLIST_KEY);
      if (savedSmartPlaylists) {
        const parsed = JSON.parse(savedSmartPlaylists);

        if (!Array.isArray(parsed) || parsed.length === 0) {
          return;
        }

        // Filter out corrupted playlists
        const validPlaylists = Array.isArray(parsed)
          ? parsed.filter(
              (playlist) =>
                playlist &&
                typeof playlist.playlistId === "string" &&
                typeof playlist.playlistName === "string" &&
                typeof playlist.isActive === "boolean" &&
                playlist.criteria &&
                Array.isArray(playlist.criteria.activeTagFilters)
            )
          : [];

        setSmartPlaylists(validPlaylists);
        smartPlaylistsRef.current = validPlaylists;
      }
    } catch (error) {
      console.error("Error loading smart playlists:", error);
    }
  }, []);

  const updatePlaylistTrackUris = useCallback(
    (playlistId: string, newTrackUris: string[]) => {
      updateSmartPlaylistsImmediate((playlists) =>
        playlists.map((playlist) =>
          playlist.playlistId === playlistId
            ? {
                ...playlist,
                smartPlaylistTrackUris: newTrackUris,
                lastSyncAt: Date.now(),
              }
            : playlist
        )
      );
    },
    [updateSmartPlaylistsImmediate]
  );

  const createSmartPlaylist = (criteria: SmartPlaylistCriteria) => {
    setSmartPlaylists((prev) => {
      const newPlaylists = [...prev, criteria];

      try {
        localStorage.setItem(SMART_PLAYLIST_KEY, JSON.stringify(newPlaylists));
      } catch (error) {
        console.error("Error saving smart playlist data:", error);
      }

      return newPlaylists;
    });
  };

  const evaluateTrackMatchesCriteria = (
    trackData: TrackData,
    criteria: SmartPlaylistCriteria["criteria"]
  ): boolean => {
    // Tag filters - include logic
    const matchesIncludeTags =
      criteria.activeTagFilters.length === 0 ||
      (criteria.isOrFilterMode
        ? // OR logic - track must have ANY of the selected tags
          criteria.activeTagFilters.some((filterTag) =>
            trackData.tags.some(
              (trackTag) =>
                trackTag.categoryId === filterTag.categoryId &&
                trackTag.subcategoryId === filterTag.subcategoryId &&
                trackTag.tagId === filterTag.tagId
            )
          )
        : // AND logic - track must have ALL of the selected tags
          criteria.activeTagFilters.every((filterTag) =>
            trackData.tags.some(
              (trackTag) =>
                trackTag.categoryId === filterTag.categoryId &&
                trackTag.subcategoryId === filterTag.subcategoryId &&
                trackTag.tagId === filterTag.tagId
            )
          ));

    // Exclude tags - track must NOT have ANY of these tags
    const matchesExcludeTags =
      criteria.excludedTagFilters.length === 0 ||
      !criteria.excludedTagFilters.some((filterTag) =>
        trackData.tags.some(
          (trackTag) =>
            trackTag.categoryId === filterTag.categoryId &&
            trackTag.subcategoryId === filterTag.subcategoryId &&
            trackTag.tagId === filterTag.tagId
        )
      );

    // Rating filter
    const matchesRating =
      criteria.ratingFilters.length === 0 ||
      (trackData.rating > 0 &&
        criteria.ratingFilters.includes(trackData.rating));

    // Energy range filter
    const matchesEnergyMin =
      criteria.energyMinFilter === null ||
      trackData.energy >= criteria.energyMinFilter;
    const matchesEnergyMax =
      criteria.energyMaxFilter === null ||
      trackData.energy <= criteria.energyMaxFilter;

    // BPM range filter
    const matchesBpmMin =
      criteria.bpmMinFilter === null ||
      (trackData.bpm !== null && trackData.bpm >= criteria.bpmMinFilter);
    const matchesBpmMax =
      criteria.bpmMaxFilter === null ||
      (trackData.bpm !== null && trackData.bpm <= criteria.bpmMaxFilter);

    return (
      matchesIncludeTags &&
      matchesExcludeTags &&
      matchesRating &&
      matchesEnergyMin &&
      matchesEnergyMax &&
      matchesBpmMin &&
      matchesBpmMax
    );
  };

  const cleanupDeletedSmartPlaylists = async (): Promise<void> => {
    if (smartPlaylists.length === 0) {
      return;
    }

    try {
      const allUserPlaylistIds: string[] =
        await spotifyApiService.getAllUserPlaylists();

      // if API call failed, don't delete all your smart playlists
      if (!allUserPlaylistIds || allUserPlaylistIds.length === 0) {
        return;
      }

      const validPlaylists: SmartPlaylistCriteria[] = smartPlaylists.filter(
        (sp: SmartPlaylistCriteria) =>
          allUserPlaylistIds.includes(sp.playlistId)
      );

      if (validPlaylists.length !== smartPlaylists.length) {
        setSmartPlaylists(validPlaylists);
        localStorage.setItem(
          SMART_PLAYLIST_KEY,
          JSON.stringify(validPlaylists)
        );
        Spicetify.showNotification(
          `Cleaned up ${
            smartPlaylists.length - validPlaylists.length
          } deleted smart playlist(s)`,
          false,
          3000
        );
      }
    } catch (error) {
      console.error(`Problem fetching or processing playlists:`, error);
    }
  };

  const syncMultipleTracksWithSmartPlaylists = useCallback(
    async (trackUpdates: Record<string, TrackData | null>): Promise<void> => {
      const operationId = `multi-${Date.now()}-${Math.random()}`;

      const syncOperation: SyncOperation = {
        id: operationId,
        type: "multiple",
        execute: async () => {
          // Get current state at execution time (from ref - the source of truth)
          const currentPlaylists = smartPlaylistsRef.current;

          if (!currentPlaylists || currentPlaylists.length === 0) {
            return;
          }

          // Process each playlist sequentially to avoid conflicts
          for (const playlist of currentPlaylists) {
            if (!playlist?.playlistId || !playlist.isActive) {
              continue;
            }

            // Get the most current state for this playlist
            const currentPlaylistData = smartPlaylistsRef.current.find(
              (p) => p.playlistId === playlist.playlistId
            );
            if (!currentPlaylistData) continue;

            let trackUris = [
              ...(currentPlaylistData.smartPlaylistTrackUris || []),
            ];
            let hasChanges = false;

            // Process each track update for this playlist
            for (const [trackUri, trackData] of Object.entries(trackUpdates)) {
              const isCurrentlyTracked = trackUris.includes(trackUri);
              if (!trackData) {
                // Track deleted - remove from playlist
                if (isCurrentlyTracked) {
                  const success =
                    await spotifyApiService.removeTrackFromPlaylist(
                      trackUri,
                      playlist.playlistId
                    );
                  if (success) {
                    trackUris = trackUris.filter((uri) => uri !== trackUri);
                    hasChanges = true;
                    // Update state immediately so next operation sees the change
                    updatePlaylistTrackUris(playlist.playlistId, trackUris);
                    showTrackRemovedNotification(playlist.playlistName);
                  }
                }
              } else {
                const matches = evaluateTrackMatchesCriteria(
                  trackData,
                  playlist.criteria
                );

                if (matches && !isCurrentlyTracked) {
                  // ADD TRACK
                  const result =
                    await spotifyApiService.addTrackToSpotifyPlaylist(
                      trackUri,
                      playlist.playlistId
                    );
                  if (result.success && !trackUris.includes(trackUri)) {
                    trackUris.push(trackUri);
                    hasChanges = true;
                    // Update state immediately
                    updatePlaylistTrackUris(playlist.playlistId, trackUris);
                    showTrackAddedNotification(
                      trackUri,
                      playlist.playlistName,
                      result.wasAdded
                    );
                  }
                } else if (!matches && isCurrentlyTracked) {
                  // REMOVE TRACK
                  const success =
                    await spotifyApiService.removeTrackFromPlaylist(
                      trackUri,
                      playlist.playlistId
                    );
                  if (success) {
                    trackUris = trackUris.filter((uri) => uri !== trackUri);
                    hasChanges = true;
                    // Update state immediately
                    updatePlaylistTrackUris(playlist.playlistId, trackUris);
                    showTrackRemovedNotification(playlist.playlistName);
                  }
                }
              }
            }

            if (hasChanges) {
              // Final validation to ensure consistency
              try {
                const actualTrackUris =
                  await spotifyApiService.getAllTrackUrisInPlaylist(
                    playlist.playlistId
                  );
                if (actualTrackUris && actualTrackUris.length >= 0) {
                  updatePlaylistTrackUris(playlist.playlistId, actualTrackUris);
                }
              } catch (error) {
                console.error(
                  `[${operationId}] Validation failed for ${playlist.playlistName}:`,
                  error
                );
              }
            }
          }
        },
      };

      syncQueueRef.current.push(syncOperation);
      processSyncQueue();
    },
    [updatePlaylistTrackUris, processSyncQueue]
  );

  const syncTrackWithSmartPlaylists = useCallback(
    async (trackUri: string, trackData: TrackData | null): Promise<void> => {
      const operationId = `single-${Date.now()}-${Math.random()}`;

      const syncOperation: SyncOperation = {
        id: operationId,
        type: "single",
        execute: async () => {
          const currentPlaylists = smartPlaylistsRef.current;
          if (!currentPlaylists || currentPlaylists.length === 0) {
            return;
          }

          // Process each playlist sequentially
          for (const playlist of currentPlaylists) {
            if (!playlist?.playlistId || !playlist.isActive) {
              continue;
            }

            // Get current state for this playlist
            const currentPlaylistData = smartPlaylistsRef.current.find(
              (p) => p.playlistId === playlist.playlistId
            );
            if (!currentPlaylistData) continue;

            const isCurrentlyTracked = (
              currentPlaylistData.smartPlaylistTrackUris || []
            ).includes(trackUri);
            let trackUris = [
              ...(currentPlaylistData.smartPlaylistTrackUris || []),
            ];

            if (!trackData) {
              // Track deleted - remove from playlist
              if (isCurrentlyTracked) {
                const success = await spotifyApiService.removeTrackFromPlaylist(
                  trackUri,
                  playlist.playlistId
                );
                if (success) {
                  trackUris = trackUris.filter((uri) => uri !== trackUri);
                  updatePlaylistTrackUris(playlist.playlistId, trackUris);
                  showTrackRemovedNotification(playlist.playlistName);
                }
              }
            } else {
              const matches = evaluateTrackMatchesCriteria(
                trackData,
                playlist.criteria
              );

              if (matches && !isCurrentlyTracked) {
                // ADD TRACK
                const result =
                  await spotifyApiService.addTrackToSpotifyPlaylist(
                    trackUri,
                    playlist.playlistId
                  );
                if (result.success && !trackUris.includes(trackUri)) {
                  trackUris.push(trackUri);
                  updatePlaylistTrackUris(playlist.playlistId, trackUris);
                  showTrackAddedNotification(
                    trackUri,
                    playlist.playlistName,
                    result.wasAdded
                  );
                }
              } else if (!matches && isCurrentlyTracked) {
                // REMOVE TRACK
                const success = await spotifyApiService.removeTrackFromPlaylist(
                  trackUri,
                  playlist.playlistId
                );
                if (success) {
                  trackUris = trackUris.filter((uri) => uri !== trackUri);
                  updatePlaylistTrackUris(playlist.playlistId, trackUris);
                  showTrackRemovedNotification(playlist.playlistName);
                }
              }
            }
          }
        },
      };

      syncQueueRef.current.push(syncOperation);
      processSyncQueue();
    },
    [updatePlaylistTrackUris, processSyncQueue]
  );

  const syncSmartPlaylistFull = async (
    playlist: SmartPlaylistCriteria
  ): Promise<void> => {
    try {
      if (!playlist.isActive) {
        return;
      }

      const allTrackUrisInPlaylist =
        await spotifyApiService.getAllTrackUrisInPlaylist(playlist.playlistId);

      if (!allTrackUrisInPlaylist || allTrackUrisInPlaylist.length === 0) {
        return;
      }

      const trackOccurrences = new Map<string, number>();
      const duplicateUris = new Set<string>();

      allTrackUrisInPlaylist.forEach((trackUri) => {
        const count = trackOccurrences.get(trackUri) || 0;
        trackOccurrences.set(trackUri, count + 1);

        if (count > 0) {
          duplicateUris.add(trackUri);
        }
      });

      // DEDUPLICATION PROCESS
      let duplicatesRemovedCount = 0;
      for (const trackUri of duplicateUris) {
        const originalCount = trackOccurrences.get(trackUri) || 0;

        try {
          // Remove ALL instances
          const removeSuccess = await spotifyApiService.removeTrackFromPlaylist(
            trackUri,
            playlist.playlistId
          );

          if (removeSuccess) {
            try {
              // Re-add exactly ONE instance
              const addResult =
                await spotifyApiService.addTrackToSpotifyPlaylist(
                  trackUri,
                  playlist.playlistId
                );

              if (addResult.success && addResult.wasAdded) {
                // We removed (originalCount) and added back 1, so net removal is (originalCount - 1)
                duplicatesRemovedCount += originalCount - 1;
              } else {
                console.error(
                  `Failed to re-add deduplicated track: ${trackUri}`
                );
                Spicetify.showNotification(
                  `⚠️ Track lost during deduplication: ${trackUri}`,
                  true,
                  5000
                );
              }
            } catch (addError) {
              console.error(`API error re-adding track ${trackUri}:`, addError);
              Spicetify.showNotification(
                `⚠️ Failed to restore track after deduplication`,
                true,
                5000
              );
            }
          }
        } catch (removeError) {
          console.error(
            `API error removing duplicates for ${trackUri}:`,
            removeError
          );
          // Continue with other tracks
        }
      }

      // GET FRESH PLAYLIST STATE after deduplication
      let currentTrackUrisInPlaylist: string[] = [];
      try {
        currentTrackUrisInPlaylist =
          await spotifyApiService.getAllTrackUrisInPlaylist(
            playlist.playlistId
          );
      } catch (error) {
        console.error(
          `Failed to fetch playlist state after deduplication:`,
          error
        );
        Spicetify.showNotification(
          `⚠️ Error syncing "${playlist.playlistName}"`,
          true,
          5000
        );
        return;
      }

      // SMART PLAYLIST SYNC LOGIC
      const matchingTrackUris: string[] = [];
      Object.entries(tagData.tracks).forEach(([trackUri, trackData]) => {
        const matches: boolean = evaluateTrackMatchesCriteria(
          trackData,
          playlist.criteria
        );
        if (matches) {
          matchingTrackUris.push(trackUri);
        }
      });

      // Use FRESH state for sync calculations
      const tracksToAdd = matchingTrackUris.filter(
        (uri) => !currentTrackUrisInPlaylist.includes(uri)
      );
      const tracksToRemove = currentTrackUrisInPlaylist.filter(
        (uri) => !matchingTrackUris.includes(uri)
      );

      let addedCount = 0;
      let removedCount = 0;

      // Remove tracks that no longer match criteria
      for (const trackUri of tracksToRemove) {
        try {
          const success = await spotifyApiService.removeTrackFromPlaylist(
            trackUri,
            playlist.playlistId
          );
          if (success) {
            removedCount++;
          }
        } catch (error) {
          console.error(`Failed to remove track ${trackUri}:`, error);
        }
      }

      // Add tracks that now match criteria
      for (const trackUri of tracksToAdd) {
        try {
          const result = await spotifyApiService.addTrackToSpotifyPlaylist(
            trackUri,
            playlist.playlistId
          );
          if (result.success && result.wasAdded) {
            addedCount++;
          }
        } catch (error) {
          console.error(`Failed to add track ${trackUri}:`, error);
        }
      }

      // Update local state
      const updatedPlaylists = smartPlaylists.map((p) => {
        if (p.playlistId === playlist.playlistId) {
          return {
            ...playlist,
            smartPlaylistTrackUris: matchingTrackUris,
            lastSyncAt: Date.now(),
          };
        }
        return p;
      });

      setSmartPlaylists(updatedPlaylists);

      // User notification
      if (duplicatesRemovedCount > 0 || addedCount > 0 || removedCount > 0) {
        const messageParts: string[] = [];

        if (addedCount > 0) messageParts.push(`+${addedCount} tracks`);
        if (removedCount > 0) messageParts.push(`-${removedCount} tracks`);
        if (duplicatesRemovedCount > 0)
          messageParts.push(`-${duplicatesRemovedCount} duplicates`);

        const message = `✅ Synced "${
          playlist.playlistName
        }": ${messageParts.join(", ")}`;
        Spicetify.showNotification(message, false, 10000);
      } else {
        Spicetify.showNotification(
          `✅ "${playlist.playlistName}" is already in sync`,
          false,
          5000
        );
      }

      console.log(`Full sync completed for playlist: ${playlist.playlistName}`);
    } catch (error) {
      console.error(
        `Critical error in syncSmartPlaylistFull for ${playlist.playlistName}:`,
        error
      );
      Spicetify.showNotification(
        `❌ Failed to sync "${playlist.playlistName}"`,
        true,
        5000
      );
    }
  };

  const showTrackAddedNotification = (
    trackUri: string,
    playlistName: string,
    wasAdded: boolean
  ) => {
    if (trackUri.startsWith("spotify:local:")) {
      Spicetify.showNotification(
        `🎵 Local file matches "${playlistName}" criteria but must be added manually`,
        true,
        5000
      );
    } else if (wasAdded) {
      Spicetify.showNotification(
        `✅ Added track to smart playlist "${playlistName}"`,
        false,
        3000
      );
    }
  };

  const showTrackRemovedNotification = (playlistName: string) => {
    Spicetify.showNotification(
      `❌ Track removed from smart playlist "${playlistName}"`,
      false,
      3000
    );
  };

  const exportSmartPlaylists = () => {
    const jsonData = JSON.stringify(smartPlaylists, null, 2);
    const blob = new Blob([jsonData], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `tagify-smart-playlists-${
      new Date().toISOString().split("T")[0]
    }.json`;
    a.click();

    URL.revokeObjectURL(url);

    Spicetify.showNotification("Backup saved in 'Downloads' folder");
  };

  const importSmartPlaylists = (backupData: SmartPlaylistCriteria[]) => {
    setSmartPlaylists(backupData);
  };

  return {
    syncSmartPlaylistFull,
    syncMultipleTracksWithSmartPlaylists,
    syncTrackWithSmartPlaylists,
    createSmartPlaylist,
    cleanupDeletedSmartPlaylists,
    smartPlaylists,
    setSmartPlaylists,
    exportSmartPlaylists,
    importSmartPlaylists,
  };
}
