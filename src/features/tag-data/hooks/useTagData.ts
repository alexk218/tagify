import { useCallback, useEffect, useRef, useState } from "react";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { flushLocalPersistence } from "@/services/sync/SyncLocalState";
import { restoreLocalDurableAppState } from "@/services/sync/DurableAppState";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { prepareSmartPlaylistImport, clearConfirmedMembershipBaselines } from "@/features/smart-playlists";
import {
  OrchestratorProgress,
  OrchestratorResult,
} from "@/services/MigrationOrchestrator";
import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TrackData,
} from "@/types/tagData";
import { buildExportData } from "../utils/tagData.export";
import {
  backupIncludesSmartPlaylists,
  downloadSafetyTagDataBackup,
  downloadTagDataBackup,
  extractAppStateFromBackup,
  extractCommunityStateFromBackup,
  extractTagDataFromBackup,
  hasCommunityBackupState,
  validateTagDataBackup,
} from "../utils/tagData.backup";
import { readCompleteBackupContents } from "../utils/tagData.backupContents";
import { areTrackDataEqual } from "../utils/tagData.helpers";
import { dispatchTagDataUpdatedEvent } from "../utils/tagData.events";
import { normalizeTagDataStructure } from "../utils/tagData.schema";
import type {
  UseTagDataOptions,
  UserTrackAddedEvent,
} from "../model/useTagData.types";
import { useTagDataInitialization } from "./useTagDataInitialization";
import { useTagDataPersistence } from "./useTagDataPersistence";
import { useTagDataArtistActions } from "./useTagDataArtistActions";
import { useTagDataPlaylistActions } from "./useTagDataPlaylistActions";
import { useTagDataTrackActions } from "./useTagDataTrackActions";

export type {
  UseTagDataOptions,
  UserTrackAddedEvent,
  SmartPlaylistCriteria,
} from "../model/useTagData.types";

export function useTagData(options: UseTagDataOptions = {}) {
  const { onSyncTrack, onSyncMultipleTracks } = options;

  const [tagData, setTagData] = useState<TagDataStructure>(defaultTagData);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [lastUserTrackAddedEvent, setLastUserTrackAddedEvent] =
    useState<UserTrackAddedEvent | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<TagDataStructure | null>(null);
  const skipNextAutoSaveRef = useRef(false);
  const persistedDataRef = useRef<TagDataStructure | null>(null);
  const latestTagDataRef = useRef<TagDataStructure>(defaultTagData);
  const userTrackAddedEventCounterRef = useRef(0);

  const [orchestratorResult, setOrchestratorResult] =
    useState<OrchestratorResult | null>(null);
  const [migrationProgress, setMigrationProgress] =
    useState<OrchestratorProgress | null>(null);
  const initRef = useRef(false);

  const emitUserTrackAddedEvent = useCallback((trackUris: string[] = []) => {
    userTrackAddedEventCounterRef.current += 1;
    const eventId = userTrackAddedEventCounterRef.current;
    // React can batch several manual saves into one render. Keep enough distinct
    // additions for the survey milestone rather than losing all but the last.
    setLastUserTrackAddedEvent((previous) => ({
      eventId,
      trackUris: [...new Set([...(previous?.trackUris ?? []), ...trackUris])].slice(0, 5),
    }));
  }, []);

  const { applyPersistedSnapshot } = useTagDataPersistence({
    tagData,
    isLoading,
    initRef,
    latestTagDataRef,
    setTagData,
    setLastSaved,
    saveTimeoutRef,
    pendingSaveRef,
    skipNextAutoSaveRef,
    persistedDataRef,
  });

  const refreshPersistedTagData = useCallback(async () => {
    applyPersistedSnapshot(await storageService.loadAllStrict());
  }, [applyPersistedSnapshot]);

  const { loadTagData, retryMigration } = useTagDataInitialization({
    initRef,
    setIsLoading,
    setStorageError,
    setMigrationProgress,
    setOrchestratorResult,
    applyPersistedSnapshot,
  });

  const {
    toggleTagSingleTrack,
    setRating,
    setEnergy,
    setBpm,
    setCamelotKey,
    updateBpm,
    applyBatchTagUpdates,
    replaceTaxonomy,
    findTagName,
  } = useTagDataTrackActions({
    tagData,
    setTagData,
    latestTagDataRef,
    onSyncTrack,
    onSyncMultipleTracks,
    emitUserTrackAddedEvent,
  });

  const {
    toggleTagPlaylist,
    setPlaylistRating,
    setPlaylistEnergy,
    refreshPlaylistMetadata,
    findPlaylistTagName,
  } = useTagDataPlaylistActions({
    tagData,
    setTagData,
    latestTagDataRef,
  });

  const {
    toggleTagArtist,
    setArtistRating,
    setArtistEnergy,
    refreshArtistMetadata,
    findArtistTagName,
  } = useTagDataArtistActions({
    tagData,
    setTagData,
    latestTagDataRef,
  });

  const applyShortcutTrackUpdate = useCallback(
    (trackUri: string, trackData: TrackData | null) => {
      if (!trackUri) {
        return;
      }

      const currentData = latestTagDataRef.current;
      const trackExistedBefore = Object.prototype.hasOwnProperty.call(
        currentData.tracks,
        trackUri,
      );

      if (trackData === null) {
        if (!trackExistedBefore) {
          return;
        }

        const { [trackUri]: _removedTrack, ...remainingTracks } = currentData.tracks;
        const nextData = {
          ...currentData,
          tracks: remainingTracks,
        };

        applyPersistedSnapshot(nextData);
        return;
      }

      const currentTrack = trackExistedBefore ? currentData.tracks[trackUri] : null;
      if (currentTrack && areTrackDataEqual(currentTrack, trackData)) {
        return;
      }

      const nextData = {
        ...currentData,
        tracks: {
          ...currentData.tracks,
          [trackUri]: trackData,
        },
      };

      applyPersistedSnapshot(nextData);

      if (!trackExistedBefore) {
        emitUserTrackAddedEvent([trackUri]);
      }
    },
    [applyPersistedSnapshot, emitUserTrackAddedEvent, latestTagDataRef],
  );

  const applyShortcutPlaylistUpdate = useCallback(
    (playlistUri: string, playlistData: PlaylistData | null) => {
      if (!playlistUri) {
        return;
      }

      const currentData = latestTagDataRef.current;
      const playlistExistedBefore = Object.prototype.hasOwnProperty.call(
        currentData.playlists,
        playlistUri,
      );

      if (playlistData === null) {
        if (!playlistExistedBefore) {
          return;
        }

        const { [playlistUri]: _removedPlaylist, ...remainingPlaylists } =
          currentData.playlists;
        applyPersistedSnapshot({
          ...currentData,
          playlists: remainingPlaylists,
        });
        return;
      }

      applyPersistedSnapshot({
        ...currentData,
        playlists: {
          ...currentData.playlists,
          [playlistUri]: playlistData,
        },
      });
    },
    [applyPersistedSnapshot, latestTagDataRef],
  );

  const applyShortcutArtistUpdate = useCallback(
    (artistUri: string, artistData: ArtistData | null) => {
      if (!artistUri) {
        return;
      }

      const currentData = latestTagDataRef.current;
      const artistExistedBefore = Object.prototype.hasOwnProperty.call(
        currentData.artists,
        artistUri,
      );

      if (artistData === null) {
        if (!artistExistedBefore) {
          return;
        }

        const { [artistUri]: _removedArtist, ...remainingArtists } =
          currentData.artists;
        applyPersistedSnapshot({
          ...currentData,
          artists: remainingArtists,
        });
        return;
      }

      applyPersistedSnapshot({
        ...currentData,
        artists: {
          ...currentData.artists,
          [artistUri]: artistData,
        },
      });
    },
    [applyPersistedSnapshot, latestTagDataRef],
  );

  /** Downloads the current library before it is replaced, and stops if that fails. */
  const saveSafetyBackup = useCallback(async (reason: "before-import" | "before-reset") => {
    await flushLocalPersistence();
    const current = await indexedDBStorage.loadAllStrict();
    try {
      if (downloadSafetyTagDataBackup(current, await readCompleteBackupContents(), reason)) {
        Spicetify.showNotification("Your current library was saved to Downloads first");
      }
    } catch (error) {
      console.error("Tagify: Could not save a copy of the current library", error);
      throw new Error("Tagify couldn't save a copy of your current library first, so nothing was changed. Please try again.");
    }
  }, []);

  const exportTagData = useCallback(async () => {
    try {
      const data = await indexedDBStorage.loadAll();

      if (!data) {
        throw new Error("No tag data found");
      }

      downloadTagDataBackup(data, await readCompleteBackupContents());
      Spicetify.showNotification("Backup saved to Downloads folder");
    } catch (error) {
      console.error("Failed to export tag data:", error);
      Spicetify.showNotification("Failed to export backup", true);
    }
  }, []);

  const importTagData = useCallback(
    async (backupData: unknown) => {
      try {
        validateTagDataBackup(backupData);
        const normalizedBackupData = normalizeTagDataStructure(
          extractTagDataFromBackup(backupData),
        );
        // Files made before Smart Playlists were part of backups say nothing
        // about them; keep the current rules instead of clearing them.
        if (!backupIncludesSmartPlaylists(backupData)) {
          normalizedBackupData.smartPlaylists = await indexedDBStorage.getAllSmartPlaylists();
        }
        await saveSafetyBackup("before-import");

        if ((normalizedBackupData.smartPlaylists?.length ?? 0) > 0) {
          clearConfirmedMembershipBaselines();
          try {
            const currentPlaylists =
              await spotifyApiService.getAllUserPlaylistReferencesStrict();
            normalizedBackupData.smartPlaylists = prepareSmartPlaylistImport(
              normalizedBackupData.smartPlaylists ?? [],
              currentPlaylists,
            ).playlists;
          } catch (error) {
            console.warn(
              "Could not verify imported smart-playlist bindings; membership will be re-confirmed later",
              error,
            );
            normalizedBackupData.smartPlaylists =
              (normalizedBackupData.smartPlaylists ?? []).map((playlist) => ({
                ...playlist,
                lastSyncAt: 0,
                smartPlaylistTrackUris: [],
              }));
          }
        }

        const success = await indexedDBStorage.saveAll(normalizedBackupData);
        if (!success) {
          throw new Error("Failed to save imported data to storage");
        }

        const communityState = extractCommunityStateFromBackup(backupData);
        if (communityState && hasCommunityBackupState(communityState) &&
            !(await indexedDBStorage.restoreCommunityBackupState(communityState))) {
          throw new Error("Tag data imported, but Community provenance could not be restored");
        }
        const appState = extractAppStateFromBackup(backupData);
        if (appState) await restoreLocalDurableAppState(appState);

        applyPersistedSnapshot(normalizedBackupData);
        dispatchTagDataUpdatedEvent("import");

        Spicetify.showNotification(
          `Imported ${Object.keys(normalizedBackupData.tracks).length} tracks and ${
            Object.keys(normalizedBackupData.playlists).length
          } playlists, ${Object.keys(normalizedBackupData.artists).length} artists, and ${
            normalizedBackupData.smartPlaylists?.length ?? 0
          } smart playlists successfully!`,
        );
      } catch (error) {
        console.error("Failed to import tag data:", error);
        Spicetify.showNotification(
          error instanceof Error ? error.message : "Failed to import backup",
          true,
        );
        throw error;
      }
    },
    [applyPersistedSnapshot],
  );

  const resetTagData = useCallback(async () => {
    try {
      const resetData = JSON.parse(JSON.stringify(defaultTagData)) as TagDataStructure;
      await saveSafetyBackup("before-reset");

      const success = await indexedDBStorage.saveAll(resetData, "reset");
      if (!success) {
        throw new Error("Failed to reset tag data in storage");
      }

      applyPersistedSnapshot(resetData);
      dispatchTagDataUpdatedEvent("import");
    } catch (error) {
      console.error("Failed to reset tag data:", error);
      throw error;
    }
  }, [applyPersistedSnapshot]);

  const exportData = useCallback(
    () => buildExportData(tagData),
    [tagData],
  );

  useEffect(() => {
    loadTagData();
  }, [loadTagData]);

  useEffect(() => {
    const prepare = () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
      pendingSaveRef.current = null;
    };
    const rehydrate = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; origin?: string }>).detail;
      if (detail?.type !== "sync" || detail.origin !== "remote") return;
      // Save an edit made while the update was applied before reloading. While
      // a full restore pauses saving, the flush is skipped and the stale
      // in-memory copy is discarded instead.
      void flushLocalPersistence()
        .catch((error) => console.error("Tagify: Could not save a recent edit before showing synced changes", error))
        .then(() => {
          prepare();
          return storageService.loadAll();
        })
        .then((data) => applyPersistedSnapshot(data, { skipNextAutoSave: true }));
    };
    window.addEventListener("tagify:prepareRemoteRestore", prepare);
    window.addEventListener("tagify:dataUpdated", rehydrate);
    return () => {
      window.removeEventListener("tagify:prepareRemoteRestore", prepare);
      window.removeEventListener("tagify:dataUpdated", rehydrate);
    };
  }, [applyPersistedSnapshot, pendingSaveRef, saveTimeoutRef]);

  useEffect(() => {
    latestTagDataRef.current = tagData;
  }, [tagData]);

  return {
    tagData,
    setTagData,
    isLoading,
    lastSaved,
    loadTagData,
    refreshPersistedTagData,
    applyShortcutTrackUpdate,
    applyShortcutPlaylistUpdate,
    applyShortcutArtistUpdate,
    lastUserTrackAddedEvent,
    migrationProgress,
    storageError,
    orchestratorResult,
    retryMigration,

    toggleTagSingleTrack,
    setRating,
    setEnergy,
    setBpm,
    setCamelotKey,
    updateBpm,
    applyBatchTagUpdates,
    findTagName,
    toggleTagPlaylist,
    setPlaylistRating,
    setPlaylistEnergy,
    refreshPlaylistMetadata,
    findPlaylistTagName,
    toggleTagArtist,
    setArtistRating,
    setArtistEnergy,
    refreshArtistMetadata,
    findArtistTagName,

    replaceTaxonomy,

    exportData,
    exportTagData,
    importTagData,
    resetTagData,
  };
}
