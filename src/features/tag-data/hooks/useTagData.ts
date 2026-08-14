import { useCallback, useEffect, useRef, useState } from "react";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
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
import { downloadTagDataBackup, validateTagDataBackup } from "../utils/tagData.backup";
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

  const emitUserTrackAddedEvent = useCallback(() => {
    userTrackAddedEventCounterRef.current += 1;
    setLastUserTrackAddedEvent({
      eventId: userTrackAddedEventCounterRef.current,
    });
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
        emitUserTrackAddedEvent();
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

  const exportTagData = useCallback(async () => {
    try {
      const data = await indexedDBStorage.loadAll();

      if (!data) {
        throw new Error("No tag data found");
      }

      downloadTagDataBackup(data);
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
        const normalizedBackupData = normalizeTagDataStructure(backupData);

        const success = await indexedDBStorage.saveAll(normalizedBackupData);
        if (!success) {
          throw new Error("Failed to save imported data to storage");
        }

        applyPersistedSnapshot(normalizedBackupData);
        dispatchTagDataUpdatedEvent("import");

        Spicetify.showNotification(
          `Imported ${Object.keys(normalizedBackupData.tracks).length} tracks and ${
            Object.keys(normalizedBackupData.playlists).length
          } playlists and ${Object.keys(normalizedBackupData.artists).length} artists successfully!`,
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

      const success = await indexedDBStorage.saveAll(resetData);
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
    latestTagDataRef.current = tagData;
  }, [tagData]);

  return {
    tagData,
    setTagData,
    isLoading,
    lastSaved,
    loadTagData,
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
