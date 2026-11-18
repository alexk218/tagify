import { TagDataStructure } from "@/types/tagData";
import { indexedDBStorage } from "./IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import {
  hasCustomTaxonomy,
  hasUserLibraryContent,
  isSupportedTagDataBackup,
  normalizeTagDataStructure,
} from "@/features/tag-data/utils/tagData.schema";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";

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
  hasUserContent: boolean;
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

  /**
   * What the saved library holds. `initialized` is false when it couldn't be
   * opened or read; that is never the same as an empty library.
   */
  private async summarizeIndexedDB(): Promise<IndexedDBSummary> {
    const unreadable: IndexedDBSummary = {
      initialized: false,
      trackCount: 0,
      categoryCount: 0,
      hasData: false,
      hasUserContent: false,
    };
    try {
      if (!(await indexedDBStorage.init())) return unreadable;

      const [trackCount, playlistCount, artistCount, smartPlaylists, taxonomy] = await Promise.all([
        indexedDBStorage.getTrackCount(),
        indexedDBStorage.getPlaylistCount(),
        indexedDBStorage.getArtistCount(),
        indexedDBStorage.getAllSmartPlaylists(),
        indexedDBStorage.getTaxonomy(),
      ]);
      const categoryCount = taxonomy.categoryOrder.length;
      const hasUserContent = trackCount > 0 || playlistCount > 0 || artistCount > 0 ||
        smartPlaylists.length > 0 || hasCustomTaxonomy(taxonomy);

      return {
        initialized: true,
        trackCount,
        categoryCount,
        hasData: hasUserContent || categoryCount > 0,
        hasUserContent,
      };
    } catch (error) {
      console.error("StorageMigration: Could not read the saved library", error);
      return unreadable;
    }
  }

  private completedFromExisting(existing: IndexedDBSummary, startedAt: number): MigrationResult {
    const completedAt = Date.now();
    this.saveMigrationState({
      status: "completed",
      completedAt,
      startedAt,
      trackCount: existing.trackCount,
      categoryCount: existing.categoryCount,
    });
    return {
      success: true,
      status: "completed",
      tracksMigrated: existing.trackCount,
      categoriesMigrated: existing.categoryCount,
      backupCreated: false,
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    };
  }

  private failedWithoutChanges(error: string, startedAt: number): MigrationResult {
    return {
      success: false,
      status: "failed",
      tracksMigrated: 0,
      categoriesMigrated: 0,
      error,
      backupCreated: false,
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
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

    // A library that can't be opened or read might hold everything the user
    // made. Never treat it as empty, and write nothing until it can be read.
    const existing = await this.summarizeIndexedDB();
    if (!existing.initialized) {
      return this.failedWithoutChanges("Failed to initialize IndexedDB", startedAt);
    }

    // An older localStorage backup is not a migration source once a real
    // IndexedDB library exists, whatever an earlier attempt recorded. This
    // also covers lost migration flags after replacing the app files and
    // libraries containing only Smart Playlists or the user's own tags.
    if (existing.hasUserContent || getDesktopSyncConfiguration()) {
      return this.completedFromExisting(existing, startedAt);
    }

    // The orchestrator migration flag makes IndexedDB canonical. The retained
    // localStorage value is only a rollback artifact and must never be migrated
    // again after a database loss. A paired empty replica is intentionally left
    // empty so Cloud Sync can require an explicit restore confirmation.
    if (this.hasOrchestratorIndexedDBMigration()) {
      if (existing.hasData) {
        return this.completedFromExisting(existing, state.startedAt || startedAt);
      }

      return this.failedWithoutChanges(
        "IndexedDB migration was previously marked complete, but the database is now empty. Tagify did not overwrite the database with defaults or stale localStorage data.",
        startedAt,
      );
    }

    // Check if there's anything to migrate
    const localData = this.getLocalStorageData();
    const normalizedLocalData = isSupportedTagDataBackup(localData)
      ? normalizeTagDataStructure(localData)
      : null;

    if (!normalizedLocalData || !hasUserLibraryContent(normalizedLocalData)) {
      if (existing.hasData) {
        return this.completedFromExisting(existing, state.startedAt || startedAt);
      }

      // Fresh install - save default data to IndexedDB, but only into a
      // library confirmed empty in the same step.
      if (!(await indexedDBStorage.saveAll(defaultTagData, "migration", { onlyIfEmpty: true }))) {
        return this.adoptConcurrentLibrary(startedAt, "Tagify could not save its starting tags");
      }

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

    onProgress?.("Preparing your library...", 10);

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

    onProgress?.(`Saving ${trackCount} songs...`, 20);

    // Step 4: Save all data to IndexedDB, only into a library confirmed
    // empty in the same step. Another Tagify window may have moved it first.
    try {
      const saved = await indexedDBStorage.saveAll(normalizedLocalData, "migration", { onlyIfEmpty: true });

      if (!saved) {
        const latest = await this.summarizeIndexedDB();
        if (latest.initialized && latest.hasUserContent) {
          return this.completedFromExisting(latest, startedAt);
        }
        throw new Error("saveAll returned false");
      }

      onProgress?.("Checking your saved songs...", 80);

      // Step 5: Verify migration succeeded
      const verifyTrackCount = await indexedDBStorage.getTrackCount();
      const verifyTaxonomy = await indexedDBStorage.getTaxonomy();

      if (verifyTrackCount !== trackCount) {
        throw new Error(
          `Track count mismatch: expected ${trackCount}, got ${verifyTrackCount}`
        );
      }

      // Compare with the normalized copy: an older copy stores categories in
      // a different shape and has no taxonomy of its own.
      if (verifyTaxonomy.categoryOrder.length !== categoryCount) {
        throw new Error(
          `Category count mismatch: expected ${categoryCount}, got ${verifyTaxonomy.categoryOrder.length}`
        );
      }

      onProgress?.("Your library is ready!", 100);

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
   * After a refused replacement, adopt a library another Tagify window saved
   * meanwhile; otherwise report the failure without changing anything.
   */
  private async adoptConcurrentLibrary(startedAt: number, error: string): Promise<MigrationResult> {
    const latest = await this.summarizeIndexedDB();
    if (latest.initialized && latest.hasData) return this.completedFromExisting(latest, startedAt);
    return this.failedWithoutChanges(error, startedAt);
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
    const localTrackCount = localData?.tracks && typeof localData.tracks === "object"
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
