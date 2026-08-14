import { TagDataStructure } from "@/types/tagData";
import { indexedDBStorage } from "./IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { normalizeTagDataStructure } from "@/features/tag-data/utils/tagData.schema";

const TAG_DATA_KEY = "tagify:tagData";
const MIGRATION_STATUS_KEY = "tagify:idb-migration-status";
const BACKUP_KEY = "tagify:pre-migration-backup";
const ORCHESTRATOR_MIGRATIONS_KEY = "tagify:migrations";

export type MigrationStatus =
  | "not-started"
  | "in-progress"
  | "completed"
  | "failed";

export interface MigrationResult {
  success: boolean;
  status: MigrationStatus;
  tracksMigrated: number;
  categoriesMigrated: number;
  error?: string;
  backupCreated: boolean;
  backupFilename?: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

interface MigrationState {
  status: MigrationStatus;
  startedAt?: number;
  completedAt?: number;
  trackCount?: number;
  categoryCount?: number;
  error?: string;
}

interface OrchestratorMigrationState {
  migrations?: {
    storageToIndexedDB?: boolean;
  };
}

interface IndexedDBSummary {
  initialized: boolean;
  trackCount: number;
  categoryCount: number;
  hasData: boolean;
}

/**
 * StorageMigrationService handles one-time migration from localStorage to IndexedDB.
 *
 * Migration flow:
 * 1. Check if migration is needed (localStorage has data, IndexedDB doesn't)
 * 2. Create backup in localStorage before migration
 * 3. Initialize IndexedDB
 * 4. Transfer all data from localStorage to IndexedDB
 * 5. Verify migration succeeded
 * 6. Mark migration as complete (but keep localStorage backup for safety)
 *
 * The service is idempotent - safe to call multiple times.
 */
class StorageMigrationService {
  private getMigrationState(): MigrationState {
    try {
      const raw = localStorage.getItem(MIGRATION_STATUS_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (error) {
      console.error("StorageMigration: Failed to read migration state", error);
    }
    return { status: "not-started" };
  }

  private saveMigrationState(state: MigrationState): void {
    try {
      localStorage.setItem(MIGRATION_STATUS_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("StorageMigration: Failed to save migration state", error);
    }
  }

  private getOrchestratorMigrationState(): OrchestratorMigrationState | null {
    try {
      const raw = localStorage.getItem(ORCHESTRATOR_MIGRATIONS_KEY);
      if (raw) {
        return JSON.parse(raw) as OrchestratorMigrationState;
      }
    } catch (error) {
      console.error(
        "StorageMigration: Failed to read orchestrator migration state",
        error
      );
    }

    return null;
  }

  private hasOrchestratorIndexedDBMigration(): boolean {
    return Boolean(
      this.getOrchestratorMigrationState()?.migrations?.storageToIndexedDB,
    );
  }

  private async summarizeIndexedDB(): Promise<IndexedDBSummary> {
    const initialized = await indexedDBStorage.init();
    if (!initialized) {
      return {
        initialized: false,
        trackCount: 0,
        categoryCount: 0,
        hasData: false,
      };
    }

    const [trackCount, taxonomy] = await Promise.all([
      indexedDBStorage.getTrackCount(),
      indexedDBStorage.getTaxonomy(),
    ]);
    const categoryCount = taxonomy.categoryOrder.length;

    return {
      initialized: true,
      trackCount,
      categoryCount,
      hasData: trackCount > 0 || categoryCount > 0,
    };
  }

  /**
   * Check if migration has already been completed
   */
  isMigrationComplete(): boolean {
    const state = this.getMigrationState();
    return state.status === "completed";
  }

  /**
   * Check if there's data in localStorage that needs migration
   */
  hasLocalStorageData(): boolean {
    try {
      const raw = localStorage.getItem(TAG_DATA_KEY);
      if (!raw) return false;

      const data = JSON.parse(raw);
      // Consider it "has data" if there are any tracks
      return data?.tracks && Object.keys(data.tracks).length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the localStorage data (for reading or backup purposes)
   */
  getLocalStorageData(): TagDataStructure | null {
    try {
      const raw = localStorage.getItem(TAG_DATA_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.error(
        "StorageMigration: Failed to parse localStorage data",
        error
      );
      return null;
    }
  }

  /**
   * Create a backup of localStorage data before migration
   */
  /**
   * Export data to file download (safer than localStorage backup for large datasets)
   */
  private exportBackupToFile(data: TagDataStructure): string | null {
    try {
      const jsonData = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonData], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const filename = `tagify-backup-${
        new Date().toISOString().split("T")[0]
      }.json`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);

      // Also try localStorage backup as secondary
      try {
        const backup = {
          data,
          createdAt: Date.now(),
          reason: "pre-indexeddb-migration",
        };
        localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      } catch {
        console.warn(
          "StorageMigration: localStorage backup failed (expected for large datasets)"
        );
      }

      return filename;
    } catch (error) {
      console.error("StorageMigration: Failed to export backup file", error);
      return null;
    }
  }

  /**
   * Restore from backup if migration fails
   */
  async restoreFromBackup(): Promise<boolean> {
    try {
      const raw = localStorage.getItem(BACKUP_KEY);
      if (!raw) {
        console.error("StorageMigration: No backup found");
        return false;
      }

      const backup = JSON.parse(raw);
      localStorage.setItem(TAG_DATA_KEY, JSON.stringify(backup.data));

      this.saveMigrationState({
        status: "not-started",
        error: "Restored from backup after failed migration",
      });

      return true;
    } catch (error) {
      console.error("StorageMigration: Failed to restore from backup", error);
      return false;
    }
  }

  /**
   * Main migration method - orchestrates the full migration process
   */
  async migrate(
    onProgress?: (message: string, progress: number) => void
  ): Promise<MigrationResult> {
    const state = this.getMigrationState();
    const startedAt = Date.now();

    // Already completed - nothing to do
    if (state.status === "completed") {
      return {
        success: true,
        status: "completed",
        tracksMigrated: state.trackCount || 0,
        categoriesMigrated: state.categoryCount || 0,
        backupCreated: false,
        backupFilename: undefined,
        startedAt: state.startedAt || startedAt,
        completedAt: state.completedAt || startedAt,
        durationMs: 0,
      };
    }

    // Check if there's anything to migrate
    const localData = this.getLocalStorageData();

    if (!localData || Object.keys(localData.tracks).length === 0) {
      const indexedDBSummary = await this.summarizeIndexedDB();

      if (!indexedDBSummary.initialized) {
        return {
          success: false,
          status: "failed",
          tracksMigrated: 0,
          categoriesMigrated: 0,
          error: "Failed to initialize IndexedDB",
          backupCreated: false,
          backupFilename: undefined,
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
        };
      }

      if (indexedDBSummary.hasData) {
        const completedAt = Date.now();

        this.saveMigrationState({
          status: "completed",
          completedAt,
          startedAt: state.startedAt || startedAt,
          trackCount: indexedDBSummary.trackCount,
          categoryCount: indexedDBSummary.categoryCount,
        });

        return {
          success: true,
          status: "completed",
          tracksMigrated: indexedDBSummary.trackCount,
          categoriesMigrated: indexedDBSummary.categoryCount,
          backupCreated: false,
          backupFilename: undefined,
          startedAt: state.startedAt || startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
        };
      }

      if (this.hasOrchestratorIndexedDBMigration()) {
        return {
          success: false,
          status: "failed",
          tracksMigrated: 0,
          categoriesMigrated: 0,
          error:
            "IndexedDB migration was previously marked complete, but the database is now empty. Tagify did not overwrite the database with defaults.",
          backupCreated: false,
          backupFilename: undefined,
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
        };
      }

      // Fresh install - save default data to IndexedDB
      await indexedDBStorage.saveAll(defaultTagData);

      this.saveMigrationState({
        status: "completed",
        completedAt: Date.now(),
        startedAt,
        trackCount: 0,
        categoryCount: defaultTagData.taxonomy.categoryOrder.length,
      });

      return {
        success: true,
        status: "completed",
        tracksMigrated: 0,
        categoriesMigrated: defaultTagData.taxonomy.categoryOrder.length,
        backupCreated: false,
        backupFilename: undefined,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      };
    }

    const normalizedLocalData = normalizeTagDataStructure(localData);
    const trackCount = Object.keys(normalizedLocalData.tracks).length;
    const categoryCount = normalizedLocalData.taxonomy.categoryOrder.length;
    onProgress?.("Creating backup...", 0);

    // Step 1: Export backup to file
    const backupFilename = this.exportBackupToFile(normalizedLocalData);
    const backupCreated = backupFilename !== null;
    if (!backupCreated) {
      console.warn(
        "StorageMigration: Could not create backup, proceeding anyway"
      );
    }

    // Step 2: Mark migration as in progress
    this.saveMigrationState({
      status: "in-progress",
      startedAt,
      trackCount,
      categoryCount,
    });

    onProgress?.("Initializing IndexedDB...", 10);

    // Step 3: Initialize IndexedDB
    const initialized = await indexedDBStorage.init();
    if (!initialized) {
      this.saveMigrationState({
        status: "failed",
        error: "Failed to initialize IndexedDB",
      });

      return {
        success: false,
        status: "failed",
        tracksMigrated: 0,
        categoriesMigrated: 0,
        error:
          "Failed to initialize IndexedDB. Your browser may not support it.",
        backupCreated,
        backupFilename: backupFilename || undefined,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      };
    }

    onProgress?.(`Migrating ${trackCount} tracks...`, 20);

    // Step 4: Save all data to IndexedDB
    try {
      const saved = await indexedDBStorage.saveAll(normalizedLocalData);

      if (!saved) {
        throw new Error("saveAll returned false");
      }

      onProgress?.("Verifying migration...", 80);

      // Step 5: Verify migration succeeded
      const verifyTrackCount = await indexedDBStorage.getTrackCount();
      const verifyTaxonomy = await indexedDBStorage.getTaxonomy();

      if (verifyTrackCount !== trackCount) {
        throw new Error(
          `Track count mismatch: expected ${trackCount}, got ${verifyTrackCount}`
        );
      }

      if (verifyTaxonomy.categoryOrder.length !== localData.taxonomy.categoryOrder.length) {
        throw new Error(
          `Category count mismatch: expected ${localData.taxonomy.categoryOrder.length}, got ${verifyTaxonomy.categoryOrder.length}`
        );
      }

      onProgress?.("Migration complete!", 100);

      const completedAt = Date.now();

      // Step 6: Mark migration as complete
      this.saveMigrationState({
        status: "completed",
        completedAt,
        startedAt,
        trackCount,
        categoryCount,
      });

      // Note: We intentionally do NOT delete localStorage data here
      // It serves as an additional backup and will be ignored going forward

      return {
        success: true,
        status: "completed",
        tracksMigrated: trackCount,
        categoriesMigrated: categoryCount,
        backupCreated,
        backupFilename: backupFilename || undefined,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      console.error("StorageMigration: Migration failed", error);

      this.saveMigrationState({
        status: "failed",
        error: errorMessage,
      });

      return {
        success: false,
        status: "failed",
        tracksMigrated: 0,
        categoriesMigrated: 0,
        error: errorMessage,
        backupCreated,
        backupFilename: backupFilename || undefined,
        startedAt,
        completedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Force re-migration (for debugging/recovery)
   * Resets migration state and re-runs migration from localStorage
   */
  async forceMigration(
    onProgress?: (message: string, progress: number) => void
  ): Promise<MigrationResult> {
    // Reset state
    this.saveMigrationState({ status: "not-started" });

    // Clear IndexedDB
    await indexedDBStorage.clearAll();

    // Run migration
    return this.migrate(onProgress);
  }

  /**
   * Get diagnostic information about storage state
   */
  async getDiagnostics(): Promise<{
    migrationState: MigrationState;
    localStorage: {
      hasData: boolean;
      trackCount: number;
      sizeBytes: number;
    };
    indexedDB: {
      initialized: boolean;
      trackCount: number;
    };
    hasBackup: boolean;
  }> {
    const migrationState = this.getMigrationState();

    // localStorage diagnostics
    const localData = this.getLocalStorageData();
    const localTrackCount = localData
      ? Object.keys(localData.tracks).length
      : 0;
    const localRaw = localStorage.getItem(TAG_DATA_KEY) || "";

    // IndexedDB diagnostics
    await indexedDBStorage.init();
    const idbTrackCount = await indexedDBStorage.getTrackCount();
    const idbInitialized = await indexedDBStorage.isInitialized();

    // Backup check
    const hasBackup = !!localStorage.getItem(BACKUP_KEY);

    return {
      migrationState,
      localStorage: {
        hasData: localTrackCount > 0,
        trackCount: localTrackCount,
        sizeBytes: new Blob([localRaw]).size,
      },
      indexedDB: {
        initialized: idbInitialized,
        trackCount: idbTrackCount,
      },
      hasBackup,
    };
  }
}

export const storageMigrationService = new StorageMigrationService();
