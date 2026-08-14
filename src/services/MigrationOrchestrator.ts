import { TagDataStructure, TrackData } from "@/types/tagData";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "./storage/IndexedDBStorageService";
import { spotifyService } from "./SpotifyService";
import { audioFeaturesService } from "./AudioFeaturesService";
import { normalizeCamelotKey } from "@/utils/camelotKey";
import packageJson from "@/package";
import {
  normalizeFilterState,
  normalizeSmartPlaylistCriteriaList,
  normalizeTagDataStructure,
} from "@/features/tag-data/utils/tagData.schema";

const TAG_DATA_KEY = "tagify:tagData";
const MIGRATIONS_KEY = "tagify:migrations";
const FALLBACK_MODE_KEY = "tagify:fallbackMode";
const FILTER_STATE_KEY = "tagify:filterState";
const SMART_PLAYLIST_STORAGE_KEY = "tagify:smartPlaylists";

interface FallbackState {
  active: boolean;
  reason: string;
  failedAt: number;
  retryCount: number;
}

interface MigrationState {
  version: string;
  migrations: {
    cleanupEmptyTracks?: boolean;
    addTrackMetadata?: boolean;
    removeTrackInfoCache?: boolean;
    storageToIndexedDB?: boolean;
  };
}

export interface OrchestratorProgress {
  phase: "loading" | "data-migrations" | "storage-migration" | "complete";
  message: string;
  current: number;
  total: number;
}

export interface OrchestratorResult {
  success: boolean;
  dataSource: "localStorage" | "indexedDB" | "default";
  isFreshInstall: boolean;
  data: TagDataStructure;
  migrationsRun: string[];
  trackCount: number;
  error?: string;
  fallbackMode?: boolean;
  fallbackReason?: string;
}

/**
 * MigrationOrchestrator - Single entry point for all migrations
 *
 * Guarantees sequential execution:
 * 1. Load existing data (localStorage or IndexedDB)
 * 2. Run data structure migrations (addTrackMetadata, removeTrackInfoCache)
 * 3. Migrate storage to IndexedDB (if needed)
 * 4. Return final data
 */
class MigrationOrchestrator {
  private isRunning = false;

  private getMigrationState(): MigrationState {
    try {
      const saved = localStorage.getItem(MIGRATIONS_KEY);
      if (saved) return JSON.parse(saved);
    } catch (error) {
      console.error("[Orchestrator] Error reading migration state:", error);
    }
    return { version: "0.0.0", migrations: {} };
  }

  private saveMigrationState(state: MigrationState): void {
    try {
      localStorage.setItem(MIGRATIONS_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("[Orchestrator] Error saving migration state:", error);
    }
  }

  private getLocalStorageData(): TagDataStructure | null {
    try {
      const raw = localStorage.getItem(TAG_DATA_KEY);
      if (!raw) return null;
      return normalizeTagDataStructure(JSON.parse(raw));
    } catch (error) {
      console.error("[Orchestrator] Error parsing localStorage data:", error);
    }
    return null;
  }

  private saveToLocalStorage(data: TagDataStructure): void {
    try {
      localStorage.setItem(TAG_DATA_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("[Orchestrator] Error saving to localStorage:", error);
    }
  }

  private getFallbackState(): FallbackState | null {
    try {
      const raw = localStorage.getItem(FALLBACK_MODE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return null;
  }

  private setFallbackState(state: FallbackState | null): void {
    try {
      if (state === null) {
        localStorage.removeItem(FALLBACK_MODE_KEY);
      } else {
        localStorage.setItem(FALLBACK_MODE_KEY, JSON.stringify(state));
      }
    } catch {
      // ignore
    }
  }

  private migrateLocalTagReferences(): void {
    try {
      const rawFilterState = localStorage.getItem(FILTER_STATE_KEY);
      if (rawFilterState) {
        localStorage.setItem(
          FILTER_STATE_KEY,
          JSON.stringify(normalizeFilterState(JSON.parse(rawFilterState))),
        );
      }
    } catch (error) {
      console.error("[Orchestrator] Error migrating filter state:", error);
    }

    try {
      const rawSmartPlaylists = localStorage.getItem(SMART_PLAYLIST_STORAGE_KEY);
      if (rawSmartPlaylists) {
        localStorage.setItem(
          SMART_PLAYLIST_STORAGE_KEY,
          JSON.stringify(
            normalizeSmartPlaylistCriteriaList(JSON.parse(rawSmartPlaylists)),
          ),
        );
      }
    } catch (error) {
      console.error("[Orchestrator] Error migrating smart playlists:", error);
    }
  }

  /**
   * Main entry point - runs all necessary migrations in sequence
   */
  async initialize(
    onProgress?: (progress: OrchestratorProgress) => void,
  ): Promise<OrchestratorResult> {
    // Prevent concurrent runs
    if (this.isRunning) {
      console.warn("[Orchestrator] Already running, waiting...");
      // Wait for current run to complete
      while (this.isRunning) {
        await this.delay(100);
      }
      // Return data from IndexedDB after wait
      const data = await indexedDBStorage.loadAll();
      return {
        success: true,
        dataSource: "indexedDB",
        isFreshInstall: false,
        data: data || defaultTagData,
        migrationsRun: [],
        trackCount: data ? Object.keys(data.tracks).length : 0,
      };
    }

    this.isRunning = true;
    const migrationsRun: string[] = [];
    let isFreshInstall = false;

    try {
      const state = this.getMigrationState();
      const currentVersion = packageJson.version;

      console.log(
        `[Orchestrator] Starting. State version: ${state.version}, Current: ${currentVersion}`,
      );
      console.log(`[Orchestrator] Migration flags:`, state.migrations);

      // ===== PHASE 1: Determine data source and load =====
      onProgress?.({
        phase: "loading",
        message: "Loading existing data...",
        current: 0,
        total: 100,
      });

      let data: TagDataStructure;
      let dataSource: "localStorage" | "indexedDB" | "default";

      // Check if we've already migrated to IndexedDB
      const indexedDBReady = await indexedDBStorage.init();
      const indexedDBHasData =
        indexedDBReady && (await this.hasIndexedDBData());
      const localStorageData = this.getLocalStorageData();
      const localStorageHasData = this.hasTagDataContent(localStorageData);
      isFreshInstall = !localStorageHasData && !indexedDBHasData;

      console.log(
        `[Orchestrator] IndexedDB ready: ${indexedDBReady}, has data: ${indexedDBHasData}`,
      );
      console.log(
        `[Orchestrator] localStorage has data: ${localStorageHasData}`,
      );

      if (
        state.migrations.storageToIndexedDB &&
        !localStorageHasData &&
        !indexedDBHasData
      ) {
        isFreshInstall = false;
        throw new Error(
          "Tagify storage is unexpectedly empty after IndexedDB migration. Tagify did not reset your data, but the persisted tag database could not be found.",
        );
      }

      if (state.migrations.storageToIndexedDB && indexedDBHasData) {
        // Already migrated to IndexedDB - load from there
        console.log("[Orchestrator] Loading from IndexedDB (already migrated)");
        const idbData = await indexedDBStorage.loadAll();
        data = idbData || defaultTagData;
        dataSource = "indexedDB";
      } else if (localStorageData && localStorageHasData) {
        // Have localStorage data - use it (will migrate to IndexedDB later)
        console.log("[Orchestrator] Loading from localStorage");
        data = localStorageData;
        dataSource = "localStorage";
      } else if (indexedDBHasData) {
        // Only IndexedDB has data (edge case)
        console.log("[Orchestrator] Loading from IndexedDB (no localStorage)");
        const idbData = await indexedDBStorage.loadAll();
        data = idbData || defaultTagData;
        dataSource = "indexedDB";
      } else {
        // Fresh install
        console.log("[Orchestrator] Fresh install, using defaults");
        data = defaultTagData;
        dataSource = "default";
      }

      data = normalizeTagDataStructure(data);
      this.migrateLocalTagReferences();

      const initialTrackCount = Object.keys(data.tracks).length;
      console.log(
        `[Orchestrator] Loaded ${initialTrackCount} tracks from ${dataSource}`,
      );

      // ===== PHASE 2: Run data structure migrations =====
      onProgress?.({
        phase: "data-migrations",
        message: "Checking data migrations...",
        current: 10,
        total: 100,
      });

      // Migration: cleanupEmptyTracks
      if (!state.migrations.cleanupEmptyTracks) {
        console.log("[Orchestrator] Running cleanupEmptyTracks migration");
        data = this.cleanupEmptyTracks(data);
        state.migrations.cleanupEmptyTracks = true;
        migrationsRun.push("cleanupEmptyTracks");
        this.saveToLocalStorage(data);
        this.saveMigrationState(state);
      }

      // Migration: addTrackMetadata
      if (!state.migrations.addTrackMetadata) {
        console.log("[Orchestrator] Running addTrackMetadata migration");
        onProgress?.({
          phase: "data-migrations",
          message: "Migrating track metadata...",
          current: 20,
          total: 100,
        });

        data = await this.addTrackMetadata(data, (processed, total) => {
          const progress = 20 + Math.floor((processed / total) * 40);
          onProgress?.({
            phase: "data-migrations",
            message: `Migrating track metadata: ${processed}/${total}`,
            current: progress,
            total: 100,
          });
        });

        state.migrations.addTrackMetadata = true;
        migrationsRun.push("addTrackMetadata");
        this.saveToLocalStorage(data);
        this.saveMigrationState(state);
      }

      // Migration: removeTrackInfoCache
      if (!state.migrations.removeTrackInfoCache) {
        console.log("[Orchestrator] Running removeTrackInfoCache migration");
        localStorage.removeItem("tagify:trackInfoCache");
        state.migrations.removeTrackInfoCache = true;
        migrationsRun.push("removeTrackInfoCache");
        this.saveMigrationState(state);
      }

      // ===== PHASE 3: Migrate storage to IndexedDB =====
      if (!state.migrations.storageToIndexedDB) {
        console.log("[Orchestrator] Running storage migration to IndexedDB");
        onProgress?.({
          phase: "storage-migration",
          message: "Migrating to new storage...",
          current: 70,
          total: 100,
        });

        try {
          // Create backup file
          if (!isFreshInstall) {
            this.exportBackupToFile(data);
          }

          // Ensure IndexedDB is ready
          let idbReady = indexedDBReady;
          if (!idbReady) {
            idbReady = await indexedDBStorage.init();
          }

          if (!idbReady) {
            throw new Error("IndexedDB is not available in this browser");
          }

          // Save all data to IndexedDB
          onProgress?.({
            phase: "storage-migration",
            message: "Saving to IndexedDB...",
            current: 80,
            total: 100,
          });

          const saved = await indexedDBStorage.saveAll(data);
          if (!saved) {
            throw new Error("Failed to write data to IndexedDB");
          }

          // Verify migration
          const verifyCount = await indexedDBStorage.getTrackCount();
          const expectedCount = Object.keys(data.tracks).length;
          if (verifyCount !== expectedCount) {
            throw new Error(
              `Verification failed: expected ${expectedCount} tracks, got ${verifyCount}`,
            );
          }

          state.migrations.storageToIndexedDB = true;
          migrationsRun.push("storageToIndexedDB");
          this.saveMigrationState(state);
          this.clearFallbackMode(); // Clear any previous fallback state

          console.log(
            `[Orchestrator] Storage migration complete: ${verifyCount} tracks`,
          );
        } catch (indexedDBError) {
          const errorMessage =
            indexedDBError instanceof Error
              ? indexedDBError.message
              : "Unknown IndexedDB error";
          console.error(
            "[Orchestrator] IndexedDB migration failed, falling back to localStorage:",
            errorMessage,
          );

          // Set fallback mode
          const existingFallback = this.getFallbackState();
          this.setFallbackState({
            active: true,
            reason: errorMessage,
            failedAt: Date.now(),
            retryCount: (existingFallback?.retryCount || 0) + 1,
          });

          // Don't throw - continue with localStorage
          // The app will work, just without IndexedDB benefits
          onProgress?.({
            phase: "storage-migration",
            message: "Using fallback storage...",
            current: 90,
            total: 100,
          });
        }
      }

      // ===== PHASE 4: Update version and finalize =====
      state.version = currentVersion;
      this.saveMigrationState(state);

      onProgress?.({
        phase: "complete",
        message: "Migration complete!",
        current: 100,
        total: 100,
      });

      const finalTrackCount = Object.keys(data.tracks).length;
      console.log(
        `[Orchestrator] Complete. Migrations run: ${
          migrationsRun.join(", ") || "none"
        }`,
      );

      const fallbackState = this.getFallbackState();

      return {
        success: true,
        dataSource: state.migrations.storageToIndexedDB
          ? "indexedDB"
          : "localStorage",
        isFreshInstall,
        data,
        migrationsRun,
        trackCount: finalTrackCount,
        fallbackMode: fallbackState?.active || false,
        fallbackReason: fallbackState?.reason,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("[Orchestrator] Migration failed:", error);

      // Try to return whatever data we have
      const fallbackData = this.getLocalStorageData() || defaultTagData;

      return {
        success: false,
        dataSource: "localStorage",
        isFreshInstall,
        data: fallbackData,
        migrationsRun,
        trackCount: Object.keys(fallbackData.tracks).length,
        error: errorMessage,
      };
    } finally {
      this.isRunning = false;
    }
  }

  private async hasIndexedDBData(): Promise<boolean> {
    const [trackCount, playlistCount, artistCount, taxonomy] = await Promise.all([
      indexedDBStorage.getTrackCount(),
      indexedDBStorage.getPlaylistCount(),
      indexedDBStorage.getArtistCount(),
      indexedDBStorage.getTaxonomy(),
    ]);

    return (
      trackCount > 0 ||
      playlistCount > 0 ||
      artistCount > 0 ||
      taxonomy.categoryOrder.length > 0
    );
  }

  private hasTagDataContent(data: TagDataStructure | null): boolean {
    if (!data) {
      return false;
    }

    return (
      Object.keys(data.tracks || {}).length > 0 ||
      Object.keys(data.playlists || {}).length > 0 ||
      Object.keys(data.artists || {}).length > 0 ||
      data.taxonomy.categoryOrder.length > 0
    );
  }

  // ===== Data Migration Functions =====

  private cleanupEmptyTracks(data: TagDataStructure): TagDataStructure {
    const cleanedTracks: { [uri: string]: TrackData } = {};
    let removedCount = 0;

    Object.entries(data.tracks).forEach(([uri, trackData]) => {
      const isEmpty =
        trackData.rating === 0 &&
        trackData.energy === 0 &&
        trackData.tagIds.length === 0;

      if (isEmpty) {
        removedCount++;
      } else {
        cleanedTracks[uri] = trackData;
      }
    });

    console.log(`[Orchestrator] Cleaned up ${removedCount} empty tracks`);
    return { ...data, tracks: cleanedTracks };
  }

  private async addTrackMetadata(
    data: TagDataStructure,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<TagDataStructure> {
    const allTrackUris = Object.keys(data.tracks);

    // Find tracks needing work
    const tracksNeedingWork = allTrackUris.filter((uri) => {
      if (uri.startsWith("spotify:local:")) return false;
      const track = data.tracks[uri];
      return (
        !track.name ||
        !track.artists ||
        track.bpm === null ||
        normalizeCamelotKey(track.camelotKey) === null
      );
    });

    console.log(
      `[Orchestrator] ${tracksNeedingWork.length} tracks need metadata/audio features`,
    );

    if (tracksNeedingWork.length === 0) {
      return data;
    }

    const updatedData = { ...data, tracks: { ...data.tracks } };
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES = 200;

    for (let i = 0; i < tracksNeedingWork.length; i += BATCH_SIZE) {
      const batch = tracksNeedingWork.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (uri) => {
          const track = updatedData.tracks[uri];
          const needsMetadata = !track.name || !track.artists;
          const needsBpm = track.bpm === null;
          const needsCamelotKey =
            normalizeCamelotKey(track.camelotKey) === null;

          try {
            if (needsMetadata) {
              const trackInfo = await spotifyService.getTrack(uri);
              if (trackInfo) {
                updatedData.tracks[uri] = {
                  ...updatedData.tracks[uri],
                  name: trackInfo.name,
                  artists: trackInfo.artists,
                };
              }
            }

            if (needsBpm || needsCamelotKey) {
              const trackId = uri.split(":").pop();
              if (trackId) {
                const audioFeatures =
                  await audioFeaturesService.getAudioFeaturesByTrackId(trackId);

                const bpm = audioFeatures?.bpm ?? null;
                if (needsBpm && bpm !== null) {
                  updatedData.tracks[uri] = {
                    ...updatedData.tracks[uri],
                    bpm,
                  };
                }

                const camelotKey = normalizeCamelotKey(
                  audioFeatures?.camelotKey
                );
                if (needsCamelotKey && camelotKey !== null) {
                  updatedData.tracks[uri] = {
                    ...updatedData.tracks[uri],
                    camelotKey,
                  };
                }
              }
            }
          } catch (error) {
            console.warn(
              `[Orchestrator] Failed to fetch data for ${uri}:`,
              error,
            );
          }
        }),
      );

      onProgress?.(
        Math.min(i + BATCH_SIZE, tracksNeedingWork.length),
        tracksNeedingWork.length,
      );

      if (i + BATCH_SIZE < tracksNeedingWork.length) {
        await this.delay(DELAY_BETWEEN_BATCHES);
      }
    }

    return updatedData;
  }

  private exportBackupToFile(data: TagDataStructure): void {
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

      console.log(`[Orchestrator] Backup exported: ${filename}`);
    } catch (error) {
      console.warn("[Orchestrator] Failed to export backup file:", error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Retry the IndexedDB migration specifically
   */
  async retryIndexedDBMigration(
    onProgress?: (progress: OrchestratorProgress) => void,
  ): Promise<OrchestratorResult> {
    const state = this.getMigrationState();

    // Reset the storage migration flag to force retry
    state.migrations.storageToIndexedDB = false;
    this.saveMigrationState(state);

    // Clear fallback mode optimistically
    this.clearFallbackMode();

    // Re-run full initialization
    return this.initialize(onProgress);
  }

  /**
   * Check if any migrations are needed (for UI indicators)
   */
  needsMigrations(): boolean {
    const state = this.getMigrationState();
    return (
      !state.migrations.cleanupEmptyTracks ||
      !state.migrations.addTrackMetadata ||
      !state.migrations.removeTrackInfoCache ||
      !state.migrations.storageToIndexedDB
    );
  }

  /**
   * Get current migration state (for debugging)
   */
  getState(): MigrationState {
    return this.getMigrationState();
  }

  /**
   * Check if we're in fallback mode (using localStorage due to IndexedDB failure)
   */
  isFallbackMode(): boolean {
    return this.getFallbackState()?.active === true;
  }

  /**
   * Get fallback state details
   */
  getFallbackDetails(): FallbackState | null {
    return this.getFallbackState();
  }

  /**
   * Clear fallback mode (after successful retry)
   */
  clearFallbackMode(): void {
    this.setFallbackState(null);
  }
}

export const migrationOrchestrator = new MigrationOrchestrator();
