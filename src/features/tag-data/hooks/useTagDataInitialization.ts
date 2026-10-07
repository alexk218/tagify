import { Dispatch, MutableRefObject, SetStateAction, useCallback } from "react";
import {
  migrationOrchestrator,
  OrchestratorProgress,
  OrchestratorResult,
} from "@/services/MigrationOrchestrator";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { TagDataStructure } from "@/types/tagData";
import { runMetadataBackfillOnce } from "@/features/metadata-backfill";

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
}

export function useTagDataInitialization({
  initRef,
  setIsLoading,
  setStorageError,
  setMigrationProgress,
  setOrchestratorResult,
  applyPersistedSnapshot,
}: UseTagDataInitializationOptions) {
  const loadTagData = useCallback(async () => {
    // Prevent double initialization
    if (initRef.current) {
      console.log("[useTagData] Already initialized, reloading from IndexedDB");
      const data = await indexedDBStorage.loadAll();
      if (data) {
        applyPersistedSnapshot(data);
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

    setMigrationProgress(null);
    setOrchestratorResult(result);

    if (result.success) {
      console.log(
        `[useTagData] Orchestrator success: ${result.trackCount} tracks from ${result.dataSource}`,
      );
      console.log(
        `[useTagData] Migrations run: ${result.migrationsRun.join(", ") || "none"}`,
      );
      applyPersistedSnapshot(result.data);
    } else {
      console.error("[useTagData] Orchestrator failed:", result.error);
      setStorageError(result.error || "Migration failed");
      // The fallback may be an old localStorage backup. Showing it as the
      // persisted baseline would let an ordinary edit overwrite newer data.
    }

    setIsLoading(false);

    if (result.success) {
      void runMetadataBackfillOnce()
        .then(async (updatedCount) => {
          if (updatedCount === 0) {
            return;
          }

          const data = await indexedDBStorage.loadAll();
          if (data) {
            applyPersistedSnapshot(data);
          }
        })
        .catch((error) => {
          console.error("[useTagData] Metadata backfill failed:", error);
        });
    }
  }, [
    applyPersistedSnapshot,
    initRef,
    setIsLoading,
    setMigrationProgress,
    setOrchestratorResult,
    setStorageError,
  ]);

  const retryMigration = useCallback(async () => {
    setIsLoading(true);
    setStorageError(null);

    const result = await migrationOrchestrator.retryIndexedDBMigration(
      (progress) => {
        setMigrationProgress(progress);
      },
    );

    setMigrationProgress(null);
    setOrchestratorResult(result);

    if (result.success) {
      applyPersistedSnapshot(result.data);
    } else {
      setStorageError(result.error || "Migration failed");
    }

    setIsLoading(false);

    return result;
  }, [
    applyPersistedSnapshot,
    setIsLoading,
    setMigrationProgress,
    setOrchestratorResult,
    setStorageError,
  ]);

  return {
    loadTagData,
    retryMigration,
  };
}
