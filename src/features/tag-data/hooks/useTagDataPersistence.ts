import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef } from "react";
import { TagDataStructure } from "@/types/tagData";
import { dispatchTagDataUpdatedEvent } from "../utils/tagData.events";
import { maybeDownloadAutomaticTagDataFileBackup } from "../utils/tagData.backup";
import { readCompleteBackupContents } from "../utils/tagData.backupContents";
import { persistTagDataDiff } from "../utils/tagData.persistence";
import { isLocalPersistencePaused, registerLocalPersistenceFlusher } from "@/services/sync/SyncLocalState";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";

interface ApplyPersistedSnapshotOptions {
  updateLastSaved?: boolean;
  skipNextAutoSave?: boolean;
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
  const persistenceInFlightRef = useRef<Promise<void> | null>(null);

  const runAutomaticFileBackup = useCallback((_data: TagDataStructure): void => {
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
      latestTagDataRef.current = data;
      setTagData(data);

      if (updateLastSaved) {
        setLastSaved(new Date());
      }
    },
    [
      latestTagDataRef,
      persistedDataRef,
      setLastSaved,
      setTagData,
      skipNextAutoSaveRef,
    ],
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
        const dataToSave = pendingSaveRef.current;
        if (!dataToSave) return;

        const persistence = (async () => {
          const saved = await persistTagDataDiff(persistedDataRef.current, dataToSave);
          if (!saved) throw new Error("Tagify: Failed to save pending changes to IndexedDB");
          if (pendingSaveRef.current === dataToSave) pendingSaveRef.current = null;
          runAutomaticFileBackup(dataToSave);
          persistedDataRef.current = dataToSave;
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
      runAutomaticFileBackup,
      saveTimeoutRef,
      setLastSaved,
    ],
  );

  const debouncedPersist = useCallback(
    (data: TagDataStructure) => {
      if (isLocalPersistencePaused()) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        pendingSaveRef.current = data;
        return;
      }
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      pendingSaveRef.current = data;
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        void flushPendingPersistence().catch((error) => console.error(error));
      }, 100);
    },
    [flushPendingPersistence, pendingSaveRef, saveTimeoutRef],
  );

  useEffect(() => registerLocalPersistenceFlusher(flushPendingPersistence), [flushPendingPersistence]);

  useEffect(() => {
    const resume = () => {
      if (!isLocalPersistencePaused()) {
        void flushPendingPersistence().catch((error) => console.error(error));
      }
    };
    window.addEventListener("tagify:localPersistence", resume);
    return () => window.removeEventListener("tagify:localPersistence", resume);
  }, [flushPendingPersistence]);

  useEffect(() => {
    if (!isLoading && initRef.current && persistedDataRef.current) {
      if (skipNextAutoSaveRef.current) {
        skipNextAutoSaveRef.current = false;
        runAutomaticFileBackup(tagData);
        return;
      }

      debouncedPersist(tagData);
    }
  }, [
    debouncedPersist,
    initRef,
    isLoading,
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
  };
}
