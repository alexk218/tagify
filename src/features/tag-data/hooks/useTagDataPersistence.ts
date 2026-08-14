import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect } from "react";
import { TagDataStructure } from "@/types/tagData";
import { dispatchTagDataUpdatedEvent } from "../utils/tagData.events";
import { maybeDownloadAutomaticTagDataFileBackup } from "../utils/tagData.backup";
import { persistTagDataDiff } from "../utils/tagData.persistence";

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
  const runAutomaticFileBackup = useCallback((data: TagDataStructure): void => {
    const fileBackupResult = maybeDownloadAutomaticTagDataFileBackup(data);
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

  const debouncedPersist = useCallback(
    async (data: TagDataStructure) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      pendingSaveRef.current = data;

      saveTimeoutRef.current = setTimeout(async () => {
        const dataToSave = pendingSaveRef.current;
        if (!dataToSave) return;

        pendingSaveRef.current = null;

        const previouslyPersisted = persistedDataRef.current;

        const saved = await persistTagDataDiff(previouslyPersisted, dataToSave);

        if (saved) {
          runAutomaticFileBackup(dataToSave);
          persistedDataRef.current = dataToSave;
          setLastSaved(new Date());
          dispatchTagDataUpdatedEvent("save");
        } else {
          console.error("Tagify: Failed to save to IndexedDB");
        }
      }, 100);
    },
    [
      pendingSaveRef,
      persistedDataRef,
      runAutomaticFileBackup,
      saveTimeoutRef,
      setLastSaved,
    ],
  );

  useEffect(() => {
    if (!isLoading && initRef.current) {
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
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    },
    [saveTimeoutRef],
  );

  return {
    applyPersistedSnapshot,
  };
}
