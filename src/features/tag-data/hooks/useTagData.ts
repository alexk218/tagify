import { restorePrivateNotesBackup } from "@/services/sync/PrivateNotes";
import { extractPrivateNotesFromBackup } from "../utils/tagData.backup";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { restoreLocalDurableAppState } from "@/services/sync/DurableAppState";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { smartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import { prepareSmartPlaylistImport } from "@/features/smart-playlists";
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
import { dispatchTagDataUpdatedEvent, isUnshownTagDataUpdate, TAG_DATA_UPDATED_EVENT } from "../utils/tagData.events";
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

  const { applyPersistedSnapshot, showSavedLibrary, showSavedRecords } = useTagDataPersistence({
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

  const queuedReloadRef = useRef<Promise<void> | null>(null);
  const lastReloadRef = useRef<Promise<void>>(Promise.resolve());

  /**
   * Shows the latest saved library (changes from sync, the extension, or
   * background updates) without undoing edits that are not saved yet.
   * Reloads run one at a time; requests made before a reload starts share it.
   */
  const refreshPersistedTagData = useCallback((): Promise<void> => {
    if (queuedReloadRef.current) return queuedReloadRef.current;
    const reload = async () => {
      queuedReloadRef.current = null;
      const account = getTagifyDatabaseName();
      try {
        await flushLocalPersistence();
      } catch (error) {
        // Unsaved edits stay in memory and are kept below; saving retries.
        console.error("Tagify: Could not save a recent edit before showing saved changes", error);
      }
      const base = persistedDataRef.current;
      if (!base) return;
      const saved = await storageService.loadAllStrict();
      if (account !== getTagifyDatabaseName()) return;
      showSavedLibrary(saved, base);
    };
    const queued = lastReloadRef.current.then(reload, reload);
    queuedReloadRef.current = queued;
    lastReloadRef.current = queued.catch(() => undefined);
    return queued;
  }, [showSavedLibrary]);

  const { loadTagData, retryMigration } = useTagDataInitialization({
    initRef,
    setIsLoading,
    setStorageError,
    setMigrationProgress,
    setOrchestratorResult,
    applyPersistedSnapshot,
    refreshPersistedTagData,
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
    refreshPersistedTagData,
    tagData,
    setTagData,
    latestTagDataRef,
    onSyncTrack,
    onSyncMultipleTracks,
    emitUserTrackAddedEvent,
  });

  const {
    addTagPlaylist,
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
    addTagArtist,
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

  // The extension saved these records already; show them without undoing
  // edits on this page that are not saved yet.
  const applyShortcutTrackUpdate = useCallback(
    (trackUri: string, trackData: TrackData | null) => {
      if (!trackUri) {
        return;
      }

      const trackExistedBefore = Object.prototype.hasOwnProperty.call(
        latestTagDataRef.current.tracks,
        trackUri,
      );
      if (trackData === null && !trackExistedBefore) return;
      const currentTrack = latestTagDataRef.current.tracks[trackUri];
      if (trackData && currentTrack && areTrackDataEqual(currentTrack, trackData)) return;

      showSavedRecords({ tracks: { [trackUri]: trackData } });

      if (trackData && !trackExistedBefore) {
        emitUserTrackAddedEvent([trackUri]);
      }
    },
    [emitUserTrackAddedEvent, latestTagDataRef, showSavedRecords],
  );

  const applyShortcutPlaylistUpdate = useCallback(
    (playlistUri: string, playlistData: PlaylistData | null) => {
      if (!playlistUri) return;
      if (playlistData === null && !(playlistUri in latestTagDataRef.current.playlists)) return;
      showSavedRecords({ playlists: { [playlistUri]: playlistData } });
    },
    [latestTagDataRef, showSavedRecords],
  );

  const applyShortcutArtistUpdate = useCallback(
    (artistUri: string, artistData: ArtistData | null) => {
      if (!artistUri) return;
      if (artistData === null && !(artistUri in latestTagDataRef.current.artists)) return;
      showSavedRecords({ artists: { [artistUri]: artistData } });
    },
    [latestTagDataRef, showSavedRecords],
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
        const { result: normalizedBackupData, failedPlaylistNames } = await smartPlaylistSyncService.restoreLibrary(async () => {
          const databaseName = getTagifyDatabaseName();
          const checkAccount = () => {
            if (getTagifyDatabaseName() !== databaseName) throw new Error("Your Spotify account changed. Return to the account where you started importing your backup.");
          };
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
            try {
              const currentPlaylists =
                await spotifyApiService.getAllUserPlaylistReferencesStrict();
              normalizedBackupData.smartPlaylists = prepareSmartPlaylistImport(
                normalizedBackupData.smartPlaylists ?? [],
                currentPlaylists,
                { keepSavedMembership: true },
              ).playlists;
            } catch (error) {
              console.warn(
                "Could not verify imported smart-playlist bindings; membership will be re-confirmed later",
                error,
              );
            }
          }

          checkAccount();
          const success = await indexedDBStorage.saveAll(normalizedBackupData);
          checkAccount();
          if (!success) {
            throw new Error("Failed to save imported data to storage");
          }
          // Show the imported library as soon as it is saved, even if restoring
          // the remaining details below fails.
          applyPersistedSnapshot(normalizedBackupData);

          return normalizedBackupData;
        });
        applyPersistedSnapshot(await indexedDBStorage.loadAllStrict());
        const privateNotes = extractPrivateNotesFromBackup(backupData);
        const communityState = extractCommunityStateFromBackup(backupData);
        if (communityState && hasCommunityBackupState(communityState) &&
            !(await indexedDBStorage.restoreCommunityBackupState(communityState))) {
          throw new Error("Tag data imported, but Community provenance could not be restored");
        }
        if (privateNotes) await restorePrivateNotesBackup(privateNotes);
        const appState = extractAppStateFromBackup(backupData);
        if (appState) await restoreLocalDurableAppState(appState);

        dispatchTagDataUpdatedEvent("import");

        Spicetify.showNotification(
          `Imported ${Object.keys(normalizedBackupData.tracks).length} tracks and ${
            Object.keys(normalizedBackupData.playlists).length
          } playlists, ${Object.keys(normalizedBackupData.artists).length} artists, and ${
            normalizedBackupData.smartPlaylists?.length ?? 0
          } smart playlists successfully!`,
        );
        if (failedPlaylistNames.length) {
          Spicetify.showNotification("Your backup is imported and your Smart Playlist connections are kept. Spotify couldn’t check every playlist yet; enabled playlists will be checked again automatically.", true);
        }
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
    // Sync, the extension, and Smart Playlists save changes this page has not
    // shown yet; show them without undoing edits that are not saved yet.
    const showSavedChanges = (event: Event) => {
      if (!initRef.current || !isUnshownTagDataUpdate((event as CustomEvent).detail)) return;
      void refreshPersistedTagData().catch((error) => console.error("Tagify: Could not show saved changes", error));
    };
    window.addEventListener(TAG_DATA_UPDATED_EVENT, showSavedChanges);
    return () => window.removeEventListener(TAG_DATA_UPDATED_EVENT, showSavedChanges);
  }, [refreshPersistedTagData]);

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
    addTagPlaylist,
    toggleTagPlaylist,
    setPlaylistRating,
    setPlaylistEnergy,
    refreshPlaylistMetadata,
    findPlaylistTagName,
    addTagArtist,
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
