import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect } from "react";
import {
  migrationOrchestrator,
  OrchestratorOptions,
  OrchestratorProgress,
  OrchestratorResult,
} from "@/services/MigrationOrchestrator";
import { TagDataStructure } from "@/types/tagData";
import { runMetadataBackfillOnce } from "@/features/metadata-backfill";
import { startTrailingFileBackups } from "../utils/tagData.backupContents";

interface UseTagDataInitializationOptions {
  initRef: MutableRefObject<boolean>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setStorageError: Dispatch<SetStateAction<string | null>>;
  setMigrationProgress: Dispatch<SetStateAction<OrchestratorProgress | null>>;
  setOrchestratorResult: Dispatch<SetStateAction<OrchestratorResult | null>>;
  applyPersistedSnapshot: (
    data: TagDataStructure,
    options?: { updateLastSaved?: boolean },
  ) => void;
  /** Shows the saved library without undoing edits that are not saved yet. */
  refreshPersistedTagData: () => Promise<void>;
}

/**
 * Only a library Tagify opened and confirmed becomes the saved baseline.
 * Without a baseline the page saves nothing, so data that might be an older
 * copy can never overwrite newer saved changes.
 */
function showsSavedLibrary(result: OrchestratorResult): boolean {
  return result.success && !result.fallbackMode;
}

export function useTagDataInitialization({
  initRef,
  setIsLoading,
  setStorageError,
  setMigrationProgress,
  setOrchestratorResult,
  applyPersistedSnapshot,
  refreshPersistedTagData,
}: UseTagDataInitializationOptions) {
  const applyResult = useCallback((result: OrchestratorResult) => {
    setMigrationProgress(null);
    setOrchestratorResult(result);

    if (showsSavedLibrary(result)) {
      applyPersistedSnapshot(result.data);
    } else if (!result.fallbackMode) {
      setStorageError(result.error || "Tagify couldn't open your library. Restart Spotify to try again.");
    }
    // In fallback mode the library window explains that changes aren't saved
    // and offers a retry or the choice about an older copy.
  }, [applyPersistedSnapshot, setMigrationProgress, setOrchestratorResult, setStorageError]);

  const loadTagData = useCallback(async () => {
    // Prevent double initialization
    if (initRef.current) {
      try {
        await refreshPersistedTagData();
      } catch (error) {
        console.error("[useTagData] Could not show the saved library", error);
      }
      setIsLoading(false);
      return;
    }

    initRef.current = true;
    setIsLoading(true);
    setStorageError(null);

    console.log("[useTagData] Starting initialization via orchestrator");

    const result = await migrationOrchestrator.initialize((progress) => {
      setMigrationProgress(progress);
    });

    if (showsSavedLibrary(result)) {
      console.log(
        `[useTagData] Orchestrator success: ${result.trackCount} tracks from ${result.dataSource}`,
      );
      console.log(
        `[useTagData] Migrations run: ${result.migrationsRun.join(", ") || "none"}`,
      );
    } else {
      console.error("[useTagData] Saved library not opened:", result.fallbackReason || result.error);
    }
    applyResult(result);

    setIsLoading(false);

    if (showsSavedLibrary(result)) {
      void runMetadataBackfillOnce()
        .then(async (updatedCount) => {
          if (updatedCount === 0) {
            return;
          }

          await refreshPersistedTagData();
        })
        .catch((error) => {
          console.error("[useTagData] Metadata backfill failed:", error);
        });
    }
  }, [
    applyResult,
    initRef,
    refreshPersistedTagData,
    setIsLoading,
    setMigrationProgress,
    setStorageError,
  ]);

  /** Opens the saved library again, optionally with the user's answer about an older copy. */
  const retryMigration = useCallback(async (options?: OrchestratorOptions) => {
    setIsLoading(true);
    setStorageError(null);

    const result = await migrationOrchestrator.retryIndexedDBMigration(
      (progress) => {
        setMigrationProgress(progress);
      },
      options,
    );

    applyResult(result);
    setIsLoading(false);

    return result;
  }, [
    applyResult,
    setIsLoading,
    setMigrationProgress,
    setStorageError,
  ]);

  // Automatic backups capture the library at the first save of each backup
  // period; this also saves the newest changes once editing goes quiet or
  // Spotify hides the page, so later edits don't wait for another session.
  useEffect(() => startTrailingFileBackups(), []);

  return {
    loadTagData,
    retryMigration,
  };
}
