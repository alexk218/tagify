import { TagDataStructure, TrackData } from "@/types/tagData";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "./storage/IndexedDBStorageService";
import { spotifyService } from "./SpotifyService";
import { audioFeaturesService } from "./AudioFeaturesService";
import { normalizeCamelotKey } from "@/utils/camelotKey";
import packageJson from "@/package";
import {
  hasUserLibraryContent,
  normalizeFilterState,
  normalizeSmartPlaylistCriteriaList,
  normalizeTagDataStructure,
} from "@/features/tag-data/utils/tagData.schema";
import {
  downloadOlderCopyBackup,
  downloadTagDataBackup,
} from "@/features/tag-data/utils/tagData.backup";
import { isTrackEmpty } from "@/features/tag-data/utils/tagData.helpers";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { setLibraryChoicePending } from "@/services/storage/libraryChoice";
import { restoreDesktopSyncConfiguration } from "@/services/sync/SyncInstallRecovery";
import {
  captureTrackDateModified,
  enforceMigrationDateModifiedPolicy,
} from "@/utils/migrationDateModified";

const TAG_DATA_KEY = "tagify:tagData";
const MIGRATIONS_KEY = "tagify:migrations";
const FALLBACK_MODE_KEY = "tagify:fallbackMode";
const FILTER_STATE_KEY = "tagify:filterState";
const SMART_PLAYLIST_STORAGE_KEY = "tagify:smartPlaylists";
// A failed open is often momentary (another Tagify window upgrading, or a
// brief storage error). Try a few times before reporting it.
const OPEN_RETRY_DELAYS_MS = [0, 250, 1_000];

const LIBRARY_UNAVAILABLE_MESSAGE =
  "Tagify couldn't open your saved library, so changes can't be saved right now. Your saved tags haven't been removed. Try again, or restart Spotify.";
const LIBRARY_MISSING_MESSAGE =
  "Tagify couldn't find your saved library on this device. Nothing was reset. Import your newest Tagify backup file to get your tags back.";
const LIBRARY_OPEN_FAILED_MESSAGE =
  "Tagify couldn't finish opening your library. Your saved tags haven't been removed. Restart Spotify to try again.";

type SavedLibraryRead =
  | { status: "read"; data: TagDataStructure; hasData: boolean; hasUserContent: boolean }
  | { status: "unavailable"; reason: string };

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
    cleanupInlineEditorEmptyTracks?: boolean;
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
  /**
   * Tagify couldn't open or confirm the saved library. `data` is not the
   * saved library, and nothing is saved until a retry succeeds.
   */
  fallbackMode?: boolean;
  fallbackReason?: string;
  /** The saved library was missing and the user restored an older copy kept on this device. */
  restoredOlderCopy?: boolean;
  /**
   * The saved library is empty and an older copy kept on this device can be
   * restored. Nothing is saved until the user chooses.
   */
  olderCopy?: { trackCount: number };
  /**
   * The user chose to restore the older copy, but changes had been saved in
   * the meantime, so nothing was replaced and the older copy was downloaded.
   */
  olderCopyNotRestored?: boolean;
}

/** The user's answer when an older copy of the library can be restored. */
export interface OrchestratorOptions {
  olderCopy?: "restore" | "start-fresh";
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
  private queue: Promise<unknown> = Promise.resolve();

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

  /** Starting fresh keeps the older copy on this device instead of replacing it. */
  private refreshLocalCopy(data: TagDataStructure, startedFresh: boolean): void {
    if (!startedFresh) this.saveToLocalStorage(data);
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
   * Main entry point - runs all necessary migrations in sequence. Runs one at
   * a time; a call made during a run starts after it finishes.
   */
  initialize(
    onProgress?: (progress: OrchestratorProgress) => void,
    options: OrchestratorOptions = {},
  ): Promise<OrchestratorResult> {
    const run = this.queue.then(async () => {
      const result = await this.run(onProgress, options);
      // Edits from Spotify's views wait only while the question is open.
      if (!result.olderCopy) setLibraryChoicePending(false);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(
    onProgress: ((progress: OrchestratorProgress) => void) | undefined,
    options: OrchestratorOptions,
  ): Promise<OrchestratorResult> {
    const migrationsRun: string[] = [];
    let isFreshInstall = false;
    let restoredOlderCopy = false;
    let olderCopyNotRestored = false;
    let startedFresh = false;

    try {
      // Spotify updates can replace the WebView storage before Spicetify is
      // reapplied. Recover the approved device session before selecting an
      // account-scoped database or deciding that this is a fresh install.
      await restoreDesktopSyncConfiguration();
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

      // A library that couldn't be opened or read is never treated as empty:
      // it may hold everything the user made. Write nothing and say so.
      const saved = await this.readSavedLibrary();
      if (saved.status === "unavailable") {
        return this.libraryUnavailable(saved.reason, migrationsRun);
      }

      const indexedDBHasData = saved.hasData;
      const localStorageData = this.getLocalStorageData();
      const localStorageHasData = this.hasTagDataContent(localStorageData);
      const missingPairedReplica = Boolean(
        state.migrations.storageToIndexedDB &&
          getDesktopSyncConfiguration() &&
          !indexedDBHasData,
      );
      isFreshInstall = !localStorageHasData && !indexedDBHasData;

      console.log(`[Orchestrator] IndexedDB has data: ${indexedDBHasData}`);
      console.log(
        `[Orchestrator] localStorage has data: ${localStorageHasData}`,
      );

      if (
        state.migrations.storageToIndexedDB &&
        !localStorageHasData &&
        !indexedDBHasData &&
        !missingPairedReplica
      ) {
        isFreshInstall = false;
        console.error("[Orchestrator] Storage is unexpectedly empty after IndexedDB migration");
        throw new Error(LIBRARY_MISSING_MESSAGE);
      }

      if (missingPairedReplica) {
        // The retained pre-migration localStorage value is intentionally stale.
        // Reviving it would hide replica loss and could merge obsolete records
        // into the canonical cloud library before the user confirms recovery.
        console.warn(
          "[Orchestrator] Paired IndexedDB replica is missing; waiting for confirmed cloud recovery",
        );
        data = defaultTagData;
        dataSource = "default";
        isFreshInstall = false;
      } else if (
        indexedDBHasData &&
        (state.migrations.storageToIndexedDB || saved.hasUserContent)
      ) {
        // Already migrated to IndexedDB - load from there
        console.log("[Orchestrator] Loading from IndexedDB (already migrated)");
        data = saved.data;
        dataSource = "indexedDB";
        if (options.olderCopy === "restore" && localStorageData && localStorageHasData) {
          // Changes were saved before the user answered, so restoring would
          // replace them. Keep them and hand the older copy over as a file.
          olderCopyNotRestored = true;
          this.downloadFileCopy(() => downloadOlderCopyBackup(localStorageData));
        }
        // A missing localStorage migration flag is not permission to overwrite
        // an existing IndexedDB library with an older localStorage copy.
        if (!state.migrations.storageToIndexedDB) {
          state.migrations.storageToIndexedDB = true;
          this.saveMigrationState(state);
        }
      } else if (localStorageData && localStorageHasData) {
        if (state.migrations.storageToIndexedDB) {
          // The saved library was cleared after it moved to IndexedDB (a read
          // just confirmed it is empty). The copy kept from before that move
          // is older than anything saved since, so the user decides.
          if (!options.olderCopy) return this.askAboutOlderCopy(localStorageData);
          if (options.olderCopy === "restore") {
            console.log("[Orchestrator] Restoring the older copy the user chose");
            data = localStorageData;
            dataSource = "localStorage";
            restoredOlderCopy = true;
          } else {
            console.log("[Orchestrator] Starting fresh; keeping the older copy as a file");
            data = defaultTagData;
            dataSource = "default";
            startedFresh = true;
          }
        } else {
          // Have localStorage data - use it (will migrate to IndexedDB later)
          console.log("[Orchestrator] Loading from localStorage");
          data = localStorageData;
          dataSource = "localStorage";
        }
      } else if (indexedDBHasData) {
        // Only IndexedDB has data (edge case)
        console.log("[Orchestrator] Loading from IndexedDB (no localStorage)");
        data = saved.data;
        dataSource = "indexedDB";
      } else {
        // Fresh install
        console.log("[Orchestrator] Fresh install, using defaults");
        data = defaultTagData;
        dataSource = "default";
      }

      data = normalizeTagDataStructure(data);
      const trackDateModifiedBeforeMigrations = captureTrackDateModified(data);
      this.migrateLocalTagReferences();

      const initialTrackCount = Object.keys(data.tracks).length;
      console.log(
        `[Orchestrator] Loaded ${initialTrackCount} tracks from ${dataSource}`,
      );

      // ===== PHASE 2: Run data structure migrations =====
      onProgress?.({
        phase: "data-migrations",
        message: "Checking your library...",
        current: 10,
        total: 100,
      });

      // Migration: cleanupEmptyTracks
      if (!state.migrations.cleanupEmptyTracks) {
        console.log("[Orchestrator] Running cleanupEmptyTracks migration");
        data = enforceMigrationDateModifiedPolicy(
          this.cleanupEmptyTracks(data),
          trackDateModifiedBeforeMigrations,
          "cleanupEmptyTracks",
        );
        state.migrations.cleanupEmptyTracks = true;
        migrationsRun.push("cleanupEmptyTracks");
        this.refreshLocalCopy(data, startedFresh);
        this.saveMigrationState(state);
      }

      // Older inline controls could persist tracks after their final annotation
      // was cleared. Re-run empty-track cleanup once for affected installations.
      if (!state.migrations.cleanupInlineEditorEmptyTracks) {
        const emptyTrackUris = Object.entries(data.tracks)
          .filter(([, trackData]) => isTrackEmpty(trackData))
          .map(([trackUri]) => trackUri);

        if (emptyTrackUris.length > 0) {
          data = enforceMigrationDateModifiedPolicy(
            this.cleanupEmptyTracks(data),
            trackDateModifiedBeforeMigrations,
            "cleanupInlineEditorEmptyTracks",
          );

          if (dataSource === "indexedDB") {
            const deleted = await indexedDBStorage.saveTrackChanges(
              new Map(emptyTrackUris.map((trackUri) => [trackUri, null])),
            );
            if (!deleted) {
              throw new Error("Failed to remove stale empty tracks from IndexedDB");
            }
          } else {
            this.refreshLocalCopy(data, startedFresh);
          }

          migrationsRun.push("cleanupInlineEditorEmptyTracks");
        }

        state.migrations.cleanupInlineEditorEmptyTracks = true;
        this.saveMigrationState(state);
      }

      // Migration: addTrackMetadata
      if (!state.migrations.addTrackMetadata) {
        console.log("[Orchestrator] Running addTrackMetadata migration");
        onProgress?.({
          phase: "data-migrations",
          message: "Updating your song details...",
          current: 20,
          total: 100,
        });

        data = await this.addTrackMetadata(data, (processed, total) => {
          const progress = 20 + Math.floor((processed / total) * 40);
          onProgress?.({
            phase: "data-migrations",
            message: `Updating song details: ${processed}/${total}`,
            current: progress,
            total: 100,
          });
        });
        data = enforceMigrationDateModifiedPolicy(
          data,
          trackDateModifiedBeforeMigrations,
          "addTrackMetadata",
        );

        state.migrations.addTrackMetadata = true;
        migrationsRun.push("addTrackMetadata");
        this.refreshLocalCopy(data, startedFresh);
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

      // This final barrier also protects future migrations added above.
      data = enforceMigrationDateModifiedPolicy(
        data,
        trackDateModifiedBeforeMigrations,
        "migration pipeline",
      );

      // ===== PHASE 3: Migrate storage to IndexedDB =====
      if (!state.migrations.storageToIndexedDB || restoredOlderCopy || startedFresh) {
        console.log("[Orchestrator] Running storage migration to IndexedDB");
        onProgress?.({
          phase: "storage-migration",
          message: "Keeping your library ready...",
          current: 70,
          total: 100,
        });

        try {
          // Keep a file copy. The older copy gets its own name so it is never
          // mistaken for the newest backup.
          if (localStorageData && (restoredOlderCopy || startedFresh)) {
            this.downloadFileCopy(() => downloadOlderCopyBackup(localStorageData));
          } else if (!isFreshInstall) {
            this.downloadFileCopy(() => downloadTagDataBackup(data));
          }

          // Save all data to IndexedDB
          onProgress?.({
            phase: "storage-migration",
            message: "Saving your library...",
            current: 80,
            total: 100,
          });

          // The read above confirmed the library holds nothing the user made;
          // the same check runs again inside the write, so a library saved
          // meanwhile (for example by another Tagify window) is never replaced.
          const replaced = await indexedDBStorage.saveAll(data, "migration", { onlyIfEmpty: true });
          if (!replaced) {
            const latest = await this.readSavedLibrary();
            if (latest.status !== "read" || !latest.hasUserContent) {
              throw new Error("Failed to write data to IndexedDB");
            }
            console.warn("[Orchestrator] The library was saved elsewhere meanwhile; showing it");
            data = latest.data;
            dataSource = "indexedDB";
            restoredOlderCopy = false;
          } else {
            // Verify migration
            const verifyCount = await indexedDBStorage.getTrackCount();
            const expectedCount = Object.keys(data.tracks).length;
            if (verifyCount !== expectedCount) {
              throw new Error(
                `Verification failed: expected ${expectedCount}, got ${verifyCount}`,
              );
            }
            if (!startedFresh) {
              migrationsRun.push(restoredOlderCopy ? "restoredOlderCopy" : "storageToIndexedDB");
            }
            console.log(
              `[Orchestrator] Storage migration complete: ${verifyCount} tracks`,
            );
          }

          state.migrations.storageToIndexedDB = true;
          this.saveMigrationState(state);
        } catch (indexedDBError) {
          const errorMessage =
            indexedDBError instanceof Error
              ? indexedDBError.message
              : "Unknown IndexedDB error";
          console.error(
            "[Orchestrator] IndexedDB migration failed; nothing will be saved until it succeeds:",
            errorMessage,
          );
          return this.libraryUnavailable(errorMessage, migrationsRun);
        }
      }

      // ===== PHASE 4: Update version and finalize =====
      state.version = currentVersion;
      this.saveMigrationState(state);
      // The library opened and is saved where Tagify reads it.
      this.clearFallbackMode();

      onProgress?.({
        phase: "complete",
        message: "Your library is ready!",
        current: 100,
        total: 100,
      });

      const finalTrackCount = Object.keys(data.tracks).length;
      console.log(
        `[Orchestrator] Complete. Migrations run: ${
          migrationsRun.join(", ") || "none"
        }`,
      );

      return {
        success: true,
        dataSource: state.migrations.storageToIndexedDB
          ? "indexedDB"
          : "localStorage",
        isFreshInstall,
        data,
        migrationsRun,
        trackCount: finalTrackCount,
        fallbackMode: false,
        restoredOlderCopy: restoredOlderCopy && migrationsRun.includes("restoredOlderCopy"),
        ...(olderCopyNotRestored ? { olderCopyNotRestored: true } : {}),
      };
    } catch (error) {
      console.error("[Orchestrator] Migration failed:", error);
      const errorMessage =
        error instanceof Error && error.message === LIBRARY_MISSING_MESSAGE
          ? LIBRARY_MISSING_MESSAGE
          : LIBRARY_OPEN_FAILED_MESSAGE;

      // Never offer an older copy as the saved library: the page would treat
      // it as saved and an ordinary edit could overwrite newer data.
      return {
        success: false,
        dataSource: "localStorage",
        isFreshInstall,
        data: defaultTagData,
        migrationsRun,
        trackCount: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Reads the whole saved library in one step, retrying briefly. Returns
   * "unavailable" when it can't be opened or read, which is never the same as
   * an empty library.
   */
  private async readSavedLibrary(): Promise<SavedLibraryRead> {
    let reason = "IndexedDB could not be opened";
    for (const delayMs of OPEN_RETRY_DELAYS_MS) {
      if (delayMs) await this.delay(delayMs);
      try {
        if (!(await indexedDBStorage.init())) {
          // A library saved by a newer Tagify cannot be opened by retrying.
          if (indexedDBStorage.lastOpenErrorName === "VersionError") return { status: "unavailable", reason: "VersionError" };
          continue;
        }
        const data = await indexedDBStorage.loadAllStrict();
        const hasUserContent = hasUserLibraryContent(data);
        return {
          status: "read",
          data,
          hasUserContent,
          hasData: hasUserContent || data.taxonomy.categoryOrder.length > 0,
        };
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
        console.warn("[Orchestrator] Could not read the saved library", error);
      }
    }
    return { status: "unavailable", reason };
  }

  /** Nothing can be saved: the page must not treat any data as the saved library. */
  private libraryUnavailable(reason: string, migrationsRun: string[]): OrchestratorResult {
    const previous = this.getFallbackState();
    this.setFallbackState({
      active: true,
      reason,
      failedAt: Date.now(),
      retryCount: (previous?.retryCount || 0) + 1,
    });
    return {
      success: false,
      dataSource: "indexedDB",
      isFreshInstall: false,
      data: defaultTagData,
      migrationsRun,
      trackCount: 0,
      error: LIBRARY_UNAVAILABLE_MESSAGE,
      fallbackMode: true,
      fallbackReason: reason,
    };
  }

  /** The saved library is empty and an older copy exists: nothing is saved until the user chooses. */
  private askAboutOlderCopy(olderCopy: TagDataStructure): OrchestratorResult {
    setLibraryChoicePending(true);
    const trackCount = Object.keys(olderCopy.tracks).length;
    this.setFallbackState({
      active: true,
      reason: "The saved library is empty and an older copy can be restored",
      failedAt: Date.now(),
      retryCount: this.getFallbackState()?.retryCount || 0,
    });
    return {
      success: false,
      dataSource: "indexedDB",
      isFreshInstall: false,
      data: defaultTagData,
      migrationsRun: [],
      trackCount,
      fallbackMode: true,
      fallbackReason: "The saved library is empty and an older copy can be restored",
      olderCopy: { trackCount },
    };
  }

  private downloadFileCopy(download: () => unknown): void {
    try {
      download();
    } catch (error) {
      console.warn("[Orchestrator] Failed to export backup file:", error);
    }
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
      if (isTrackEmpty(trackData)) {
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Opens the saved library again, for example after it couldn't be opened,
   * or with the user's answer about restoring an older copy. The record that
   * the library already moved is kept: forgetting it would let an older copy
   * replace the library without asking.
   */
  async retryIndexedDBMigration(
    onProgress?: (progress: OrchestratorProgress) => void,
    options: OrchestratorOptions = {},
  ): Promise<OrchestratorResult> {
    return this.initialize(onProgress, options);
  }

  /**
   * Check if any migrations are needed (for UI indicators)
   */
  needsMigrations(): boolean {
    const state = this.getMigrationState();
    return (
      !state.migrations.cleanupEmptyTracks ||
      !state.migrations.cleanupInlineEditorEmptyTracks ||
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
   * Whether the last start couldn't open the saved library, so changes aren't saved
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
