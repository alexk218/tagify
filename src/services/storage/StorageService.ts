import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";
import { indexedDBStorage } from "./IndexedDBStorageService";
import {
  storageMigrationService,
  MigrationResult,
} from "./StorageMigrationService";
import { defaultTagData } from "@/constants/defaultTagData";

export type StorageInitStatus =
  | "uninitialized"
  | "migrating"
  | "ready"
  | "error";

export interface StorageInitResult {
  status: StorageInitStatus;
  migrationResult?: MigrationResult;
  error?: string;
}

/**
 * Main storage service that coordinates initialization, migration, and data access.
 *
 * This is the primary interface that the rest of the application should use.
 * It handles:
 * - One-time migration from localStorage to IndexedDB
 * - All CRUD operations for tag data
 * - Graceful error handling and fallbacks
 */
class StorageService {
  private initStatus: StorageInitStatus = "uninitialized";
  private initPromise: Promise<StorageInitResult> | null = null;

  /**
   * Initialize storage - must be called before any operations.
   * Handles migration from localStorage if needed.
   *
   * @param onMigrationProgress - Progress callback for storage migration
   * @param skipStorageMigration - If true, only init IndexedDB without migrating (for pre-migration data transforms)
   */
  async initialize(
    onMigrationProgress?: (message: string, progress: number) => void,
    skipStorageMigration: boolean = false
  ): Promise<StorageInitResult> {
    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.initStatus === "ready") {
      return { status: "ready" };
    }

    this.initPromise = this.doInitialize(
      onMigrationProgress,
      skipStorageMigration
    );
    const result = await this.initPromise;
    this.initPromise = null;
    return result;
  }

  private async doInitialize(
    onMigrationProgress?: (message: string, progress: number) => void,
    skipStorageMigration: boolean = false
  ): Promise<StorageInitResult> {
    try {
      this.initStatus = "migrating";

      // Check if migration is needed or already done
      if (storageMigrationService.isMigrationComplete()) {
        // Migration already done - just init IndexedDB
        const initialized = await indexedDBStorage.init();

        if (!initialized) {
          this.initStatus = "error";
          return {
            status: "error",
            error: "Failed to initialize IndexedDB",
          };
        }

        this.initStatus = "ready";

        // Return info about the previous migration for debugging
        const diagnostics = await storageMigrationService.getDiagnostics();
        return {
          status: "ready",
          // Include a "migrationResult" that indicates it was already done
          migrationResult: {
            success: true,
            status: "completed" as const,
            tracksMigrated: diagnostics.indexedDB.trackCount,
            categoriesMigrated: 0,
            backupCreated: false,
            startedAt: diagnostics.migrationState.startedAt || Date.now(),
            completedAt: diagnostics.migrationState.completedAt || Date.now(),
            durationMs: 0, // 0 indicates this was already complete
          },
        };
      }

      // If skipping storage migration (data migrations need to run first)
      if (skipStorageMigration) {
        this.initStatus = "uninitialized";
        return { status: "uninitialized" };
      }

      // Need to run migration
      const migrationResult = await storageMigrationService.migrate(
        onMigrationProgress
      );

      if (!migrationResult.success) {
        this.initStatus = "error";
        return {
          status: "error",
          migrationResult,
          error: migrationResult.error,
        };
      }

      this.initStatus = "ready";
      return {
        status: "ready",
        migrationResult,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("StorageService: Initialization failed", error);

      this.initStatus = "error";
      return {
        status: "error",
        error: errorMessage,
      };
    }
  }

  /**
   * Check if storage migration is pending (data migrations should run first)
   */
  // TODO: unused?
  isStorageMigrationPending(): boolean {
    return (
      !storageMigrationService.isMigrationComplete() &&
      storageMigrationService.hasLocalStorageData()
    );
  }

  /**
   * Get current initialization status
   */
  getStatus(): StorageInitStatus {
    return this.initStatus;
  }

  /**
   * Check if storage is ready for operations
   */
  isReady(): boolean {
    return this.initStatus === "ready";
  }

  async switchAccountDatabase(): Promise<boolean> {
    this.initPromise = null;
    this.initStatus = "uninitialized";
    const initialized = await indexedDBStorage.switchAccountDatabase();
    this.initStatus = initialized ? "ready" : "error";
    return initialized;
  }

  // ============ Data Operations ============

  /**
   * Load all tag data
   */
  async loadAll(): Promise<TagDataStructure> {
    if (!this.isReady()) {
      console.warn("StorageService: Not ready, returning default data");
      return defaultTagData;
    }

    const data = await indexedDBStorage.loadAll();
    return data || defaultTagData;
  }

  async loadAllStrict(): Promise<TagDataStructure> {
    if (!this.isReady()) throw new Error("Your saved Tagify details are still loading. Please try again.");
    return indexedDBStorage.loadAllStrict();
  }

  /**
   * Save all tag data (full replacement)
   */
  async saveAll(data: TagDataStructure): Promise<boolean> {
    if (!this.isReady()) {
      console.error("StorageService: Cannot save - not ready");
      return false;
    }

    return indexedDBStorage.saveAll(data);
  }

  /**
   * Get taxonomy
   */
  async getTaxonomy(): Promise<TagTaxonomy> {
    if (!this.isReady()) return defaultTagData.taxonomy;
    return indexedDBStorage.getTaxonomy();
  }

  /**
   * Save taxonomy
   */
  async saveTaxonomy(taxonomy: TagTaxonomy, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.saveTaxonomy(taxonomy, options);
  }

  /**
   * Get a single track
   */
  async getTrack(uri: string): Promise<TrackData | null> {
    if (!this.isReady()) return null;
    return indexedDBStorage.getTrack(uri);
  }

  /**
   * Save a single track
   */
  async saveTrack(uri: string, data: TrackData, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.saveTrack(uri, data, options);
  }

  /**
   * Delete a single track
   */
  async deleteTrack(uri: string, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.deleteTrack(uri, options);
  }

  /**
   * Get multiple tracks
   */
  async getTracks(uris: string[]): Promise<Map<string, TrackData>> {
    if (!this.isReady()) return new Map();
    return indexedDBStorage.getTracks(uris);
  }

  /**
   * Save multiple tracks
   */
  async saveTracks(tracks: Map<string, TrackData>): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.saveTracks(tracks);
  }

  /** Save and delete multiple tracks atomically. */
  async saveTrackChanges(
    changes: Map<string, TrackData | null>
  ): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.saveTrackChanges(changes);
  }

  /**
   * Get a single playlist or album
   */
  async getPlaylist(uri: string): Promise<PlaylistData | null> {
    if (!this.isReady()) return null;
    return indexedDBStorage.getPlaylist(uri);
  }

  /**
   * Save/update a single playlist or album
   */
  async savePlaylist(uri: string, data: PlaylistData, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.savePlaylist(uri, data, options);
  }

  /** Save/update multiple playlists or albums in one transaction. */
  async savePlaylists(playlists: Map<string, PlaylistData>): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.savePlaylists(playlists);
  }

  /**
   * Delete a single playlist or album
   */
  async deletePlaylist(uri: string, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.deletePlaylist(uri, options);
  }

  /**
   * Get a single artist
   */
  async getArtist(uri: string): Promise<ArtistData | null> {
    if (!this.isReady()) return null;
    return indexedDBStorage.getArtist(uri);
  }

  /**
   * Save/update a single artist
   */
  async saveArtist(uri: string, data: ArtistData, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.saveArtist(uri, data, options);
  }

  /** Save/update multiple artists in one transaction. */
  async saveArtists(artists: Map<string, ArtistData>): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.saveArtists(artists);
  }

  /**
   * Delete a single artist
   */
  async deleteArtist(uri: string, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.deleteArtist(uri, options);
  }

  /**
   * Get all track URIs
   */
  async getAllTrackUris(): Promise<string[]> {
    if (!this.isReady()) return [];
    return indexedDBStorage.getAllTrackUris();
  }

  /**
   * Get track count
   */
  async getTrackCount(): Promise<number> {
    if (!this.isReady()) return 0;
    return indexedDBStorage.getTrackCount();
  }

  /**
   * Clear all data (use with extreme caution)
   */
  async clearAll(): Promise<boolean> {
    if (!this.isReady()) return false;
    return indexedDBStorage.clearAll();
  }

  /**
   * Get storage diagnostics
   */
  async getDiagnostics() {
    return storageMigrationService.getDiagnostics();
  }
}

// Export singleton instance
export const storageService = new StorageService();

// Re-export types
export type { MigrationResult } from "./StorageMigrationService";
