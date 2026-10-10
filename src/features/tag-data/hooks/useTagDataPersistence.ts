import { PRIVATE_NOTES_CHANGED_EVENT } from "@/services/sync/PrivateNotes";
import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef } from "react";
import { ArtistData, PlaylistData, TagDataStructure, TrackData } from "@/types/tagData";
import { dispatchTagDataUpdatedEvent } from "../utils/tagData.events";
import { isAutomaticFileBackupDue, maybeDownloadAutomaticTagDataFileBackup } from "../utils/tagData.backup";
import { readCompleteBackupContents } from "../utils/tagData.backupContents";
import { persistTagDataDiff } from "../utils/tagData.persistence";
import { rebaseTagData, reuseUnchanged } from "../utils/tagData.rebase";
import { isLocalPersistencePaused, registerLocalPersistenceFlusher } from "@/services/sync/SyncLocalState";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";

interface ApplyPersistedSnapshotOptions {
  updateLastSaved?: boolean;
  skipNextAutoSave?: boolean;
}

/** Records another part of Tagify already saved; null means it was removed. */
export interface SavedRecordChanges {
  tracks?: Record<string, TrackData | null>;
  playlists?: Record<string, PlaylistData | null>;
  artists?: Record<string, ArtistData | null>;
}

interface UseTagDataPersistenceOptions {
  tagData: TagDataStructure;
  isLoading: boolean;
  initRef: MutableRefObject<boolean>;
  latestTagDataRef: MutableRefObject<TagDataStructure>;
  setTagData: Dispatch<SetStateAction<TagDataStructure>>;
  setLastSaved: Dispatch<SetStateAction<Date | null>>;
  saveTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  pendingSaveRef: MutableRefObject<TagDataStructure | null>;
  skipNextAutoSaveRef: MutableRefObject<boolean>;
  persistedDataRef: MutableRefObject<TagDataStructure | null>;
}

const SAVE_DELAY_MS = 100;
// A failed save keeps the edit on screen and retries until it succeeds.
const SAVE_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];

function withSavedRecords(data: TagDataStructure, changes: SavedRecordChanges): TagDataStructure {
  const next = { ...data };
  for (const key of ["tracks", "playlists", "artists"] as const) {
    const records = changes[key];
    if (!records) continue;
    const updated: Record<string, TrackData | PlaylistData | ArtistData> = { ...data[key] };
    for (const [uri, record] of Object.entries(records)) {
      if (record) updated[uri] = record;
      else delete updated[uri];
    }
    (next as Record<typeof key, unknown>)[key] = updated;
  }
  return next;
}

export function useTagDataPersistence({
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
}: UseTagDataPersistenceOptions) {
  const lastScheduledTrackStateRef = useRef(latestTagDataRef.current);
  const persistenceInFlightRef = useRef<Promise<void> | null>(null);
  const saveFailuresRef = useRef(0);

  const runAutomaticFileBackup = useCallback((_data: TagDataStructure): void => {
    // Reading and packing the whole library is costly; only do it when a
    // backup file is actually due, not after every edit.
    if (!isAutomaticFileBackupDue()) return;
    void Promise.all([indexedDBStorage.loadAll(), readCompleteBackupContents()]).then(([persistedData, contents]) => {
      if (!persistedData) return;
      const fileBackupResult = maybeDownloadAutomaticTagDataFileBackup(persistedData, contents);
      if (fileBackupResult.status === "created") {
        console.log(
          `Tagify: Automatic file backup saved: ${fileBackupResult.metadata.filename}`,
        );
      } else if (fileBackupResult.status === "failed") {
        console.warn(
          "Tagify: Failed to create automatic file backup",
          fileBackupResult.error,
        );
      }
    }).catch((error) => {
      console.warn("Tagify: Failed to create automatic file backup", error);
    });
  }, []);

  useEffect(() => {
    const backupNotes = (event: Event) => {
      if ((event as CustomEvent<{ dataChanged?: boolean }>).detail?.dataChanged !== false) runAutomaticFileBackup(latestTagDataRef.current);
    };
    window.addEventListener(PRIVATE_NOTES_CHANGED_EVENT, backupNotes);
    return () => window.removeEventListener(PRIVATE_NOTES_CHANGED_EVENT, backupNotes);
  }, [runAutomaticFileBackup, latestTagDataRef]);

  /** Replaces the library outright: first load, import, reset, or restore. */
  const applyPersistedSnapshot = useCallback(
    (
      data: TagDataStructure,
      options: ApplyPersistedSnapshotOptions = {},
    ): void => {
      const { updateLastSaved = true, skipNextAutoSave = true } = options;

      if (skipNextAutoSave) {
        skipNextAutoSaveRef.current = true;
      }

      persistedDataRef.current = data;
      lastScheduledTrackStateRef.current = data;
      latestTagDataRef.current = data;
      pendingSaveRef.current = null;
      setTagData(data);

      if (updateLastSaved) {
        setLastSaved(new Date());
      }
    },
    [
      latestTagDataRef,
      pendingSaveRef,
      persistedDataRef,
      setLastSaved,
      setTagData,
      skipNextAutoSaveRef,
    ],
  );

  /**
   * Shows a newer saved copy of the library and keeps every edit made on this
   * device since `base`, the saved library as this page knew it when the
   * newer copy was read.
   */
  const showSaved = useCallback(
    (saved: TagDataStructure, base: TagDataStructure): void => {
      const next = rebaseTagData(base, latestTagDataRef.current, saved);
      persistedDataRef.current = saved;
      lastScheduledTrackStateRef.current = saved;
      if (pendingSaveRef.current) pendingSaveRef.current = rebaseTagData(base, pendingSaveRef.current, saved);
      latestTagDataRef.current = next;
      setTagData(next);
    },
    [latestTagDataRef, pendingSaveRef, persistedDataRef, setTagData],
  );

  const showSavedLibrary = useCallback(
    (loaded: TagDataStructure, base: TagDataStructure): void => showSaved(reuseUnchanged(base, loaded), base),
    [showSaved],
  );

  /** Shows records another part of Tagify already saved, keeping unsaved edits. */
  const showSavedRecords = useCallback(
    (changes: SavedRecordChanges): void => {
      const base = persistedDataRef.current ?? latestTagDataRef.current;
      showSaved(withSavedRecords(base, changes), base);
    },
    [latestTagDataRef, persistedDataRef, showSaved],
  );

  const flushPendingPersistence = useCallback(
    async (): Promise<void> => {
      while (true) {
        if (!persistedDataRef.current) return;
        if (isLocalPersistencePaused()) {
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
          return;
        }

        if (persistenceInFlightRef.current) {
          await persistenceInFlightRef.current;
          continue;
        }

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        // Undo can be clicked before React's persistence effect sees the last edit.
        if (latestTagDataRef.current !== lastScheduledTrackStateRef.current) pendingSaveRef.current = latestTagDataRef.current;
        const dataToSave = pendingSaveRef.current;
        lastScheduledTrackStateRef.current = latestTagDataRef.current;
        if (!dataToSave) return;

        const base = persistedDataRef.current;
        const persistence = (async () => {
          const saved = await persistTagDataDiff(base, dataToSave);
          if (!saved) throw new Error("Tagify: Failed to save pending changes to IndexedDB");
          if (pendingSaveRef.current === dataToSave) pendingSaveRef.current = null;
          runAutomaticFileBackup(dataToSave);
          // A newer saved copy may have been shown while this save ran.
          persistedDataRef.current = rebaseTagData(base, dataToSave, persistedDataRef.current ?? base);
          setLastSaved(new Date());
          dispatchTagDataUpdatedEvent("save");
        })();
        persistenceInFlightRef.current = persistence;
        try {
          await persistence;
        } finally {
          if (persistenceInFlightRef.current === persistence) persistenceInFlightRef.current = null;
        }
      }
    },
    [
      pendingSaveRef,
      persistedDataRef,
      latestTagDataRef,
      runAutomaticFileBackup,
      saveTimeoutRef,
      setLastSaved,
    ],
  );

  const scheduleSave = useCallback(
    function schedule(delay: number) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        void flushPendingPersistence().then(
          () => {
            if (saveFailuresRef.current > 0) Spicetify.showNotification("Your latest changes are saved");
            saveFailuresRef.current = 0;
          },
          (error) => {
            console.error(error);
            const failures = ++saveFailuresRef.current;
            if (failures === 1) {
              Spicetify.showNotification("Tagify couldn't save your latest changes yet. Keep Spotify open while it tries again.", true);
            }
            if (!saveTimeoutRef.current) schedule(SAVE_RETRY_DELAYS_MS[Math.min(failures, SAVE_RETRY_DELAYS_MS.length) - 1]);
          },
        );
      }, delay);
    },
    [flushPendingPersistence, saveTimeoutRef],
  );

  const debouncedPersist = useCallback(
    (data: TagDataStructure) => {
      // An older render's effect must not mark a newer optimistic edit as scheduled.
      if (latestTagDataRef.current === data) lastScheduledTrackStateRef.current = data;
      if (isLocalPersistencePaused()) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingSaveRef.current = data;
        return;
      }
      pendingSaveRef.current = data;
      scheduleSave(SAVE_DELAY_MS);
    },
    [scheduleSave, pendingSaveRef, saveTimeoutRef, latestTagDataRef],
  );

  useEffect(() => registerLocalPersistenceFlusher(flushPendingPersistence), [flushPendingPersistence]);

  useEffect(() => {
    const resume = () => {
      if (isLocalPersistencePaused()) return;
      void flushPendingPersistence().catch((error) => {
        console.error(error);
        scheduleSave(SAVE_RETRY_DELAYS_MS[0]);
      });
    };
    window.addEventListener("tagify:localPersistence", resume);
    return () => window.removeEventListener("tagify:localPersistence", resume);
  }, [flushPendingPersistence, scheduleSave]);

  // Without a saved library to compare against (it couldn't be opened),
  // changes can't be saved; say so once instead of dropping them silently.
  const unsavableShownRef = useRef<TagDataStructure | null>(null);
  useEffect(() => {
    if (isLoading || !initRef.current || persistedDataRef.current) {
      unsavableShownRef.current = null;
      return;
    }
    if (!unsavableShownRef.current) {
      unsavableShownRef.current = tagData;
      return;
    }
    if (tagData !== unsavableShownRef.current) {
      unsavableShownRef.current = tagData;
      Spicetify.showNotification("Tagify can't save changes right now, so that change wasn't saved. Try again after Tagify reopens your library.", true);
    }
  }, [initRef, isLoading, persistedDataRef, tagData]);

  useEffect(() => {
    if (!isLoading && initRef.current && persistedDataRef.current) {
      if (skipNextAutoSaveRef.current) {
        skipNextAutoSaveRef.current = false;
        // A user edit can be batched with a restored snapshot in one render.
        // Only skip the snapshot itself, never the edit that follows it.
        if (tagData === persistedDataRef.current) {
          runAutomaticFileBackup(tagData);
          return;
        }
      }
      // Showing a saved copy with no unsaved edits has nothing to write.
      if (tagData === persistedDataRef.current && !pendingSaveRef.current) return;

      debouncedPersist(tagData);
    }
  }, [
    debouncedPersist,
    initRef,
    isLoading,
    pendingSaveRef,
    runAutomaticFileBackup,
    skipNextAutoSaveRef,
    tagData,
  ]);

  useEffect(
    () => () => {
      // Spotify can unmount the Tagify page immediately after a user saves.
      // Do not cancel the final debounced IndexedDB write on navigation.
      void flushPendingPersistence().catch((error) => console.error(error));
    },
    [flushPendingPersistence],
  );

  return {
    applyPersistedSnapshot,
    showSavedLibrary,
    showSavedRecords,
  };
}
