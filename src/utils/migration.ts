import { TrackData, TagDataStructure } from "@/types/tagData";
import { TrackInfoCacheManager } from "./TrackInfoCache";
import { spotifyService } from "@/services/SpotifyService";
import packageJson from "@/package";
import { audioFeaturesService } from "@/services/AudioFeaturesService";

const MIGRATION_KEY = "tagify:migrations";
const MIGRATION_PROGRESS_KEY = "tagify:migrationProgress";
const CURRENT_VERSION = packageJson.version;

interface MigrationState {
  version: string;
  migrations: {
    cleanupEmptyTracks?: boolean;
    addTrackMetadata?: boolean;
    removeTrackInfoCache?: boolean;
    // future migrations here...
  };
}

interface MigrationProgress {
  migrationName: string;
  processedUris: string[];
  failedUris?: string[];
  totalTracks: number;
  startedAt: number;
}

interface TrackMigrationResult {
  uri: string;
  success: boolean;
  updates: Partial<TrackData>;
  retryable: boolean;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableError = (error: any): boolean => {
  // 429 Too Many Requests
  if (error?.status === 429) return true;
  // Network errors
  if (error?.message?.includes("network") || error?.message?.includes("fetch"))
    return true;
  // Timeout errors
  if (error?.message?.includes("timeout")) return true;
  return false;
};

const getBackoffDelay = (attempt: number, baseDelay: number = 1000): number => {
  // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
  return Math.min(baseDelay * Math.pow(2, attempt), 30000);
};

const isTrackEmpty = (trackData: TrackData): boolean => {
  if (!trackData) return true;
  return (
    trackData.rating === 0 &&
    trackData.energy === 0 &&
    trackData.tagIds.length === 0
  );
};

const getMigrationState = (): MigrationState => {
  try {
    const saved = localStorage.getItem(MIGRATION_KEY);
    if (saved) return JSON.parse(saved);
  } catch (error) {
    console.error("Tagify: Error reading migration state:", error);
  }
  return { version: "0.0.0", migrations: {} };
};

const saveMigrationState = (state: MigrationState) => {
  try {
    localStorage.setItem(MIGRATION_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Tagify: Error saving migration state:", error);
  }
};

const getMigrationProgress = (): MigrationProgress | null => {
  try {
    const saved = localStorage.getItem(MIGRATION_PROGRESS_KEY);
    if (saved) return JSON.parse(saved);
  } catch (error) {
    console.error("Tagify: Error reading migration progress:", error);
  }
  return null;
};

const saveMigrationProgress = (progress: MigrationProgress | null) => {
  try {
    if (progress === null) {
      localStorage.removeItem(MIGRATION_PROGRESS_KEY);
    } else {
      localStorage.setItem(MIGRATION_PROGRESS_KEY, JSON.stringify(progress));
    }
  } catch (error) {
    console.error("Tagify: Error saving migration progress:", error);
  }
};

// Migration 1: Cleanup empty tracks
const cleanupEmptyTracksMigration = (
  currentData: TagDataStructure
): TagDataStructure => {
  console.log("Running empty tracks cleanup migration...");

  const cleanedTracks: { [trackUri: string]: TrackData } = {};
  let removedCount = 0;

  Object.entries(currentData.tracks).forEach(([trackUri, trackData]) => {
    if (isTrackEmpty(trackData)) {
      TrackInfoCacheManager.removeTrackInfo(trackUri);
      removedCount++;
    } else {
      cleanedTracks[trackUri] = trackData;
    }
  });

  console.log(
    `Cleanup migration complete: Removed ${removedCount} empty tracks`
  );
  return { ...currentData, tracks: cleanedTracks };
};

// Migration 2: Add track metadata (name, artists) and backfill BPM
const addTrackMetadataMigration = async (
  currentData: TagDataStructure,
  setTagData: (
    data: TagDataStructure | ((prev: TagDataStructure) => TagDataStructure)
  ) => void,
  onProgress?: (processed: number, total: number) => void
): Promise<TagDataStructure> => {
  console.log("Running track metadata and BPM migration...");

  const allTrackUris = Object.keys(currentData.tracks);

  // Find tracks that need metadata OR BPM
  const tracksNeedingWork = allTrackUris.filter((uri) => {
    if (uri.startsWith("spotify:local:")) return false;

    const track = currentData.tracks[uri];
    const needsMetadata = !track.name || !track.artists;
    const needsBpm = track.bpm === null;

    return needsMetadata || needsBpm;
  });

  console.log(
    `Found ${tracksNeedingWork.length} tracks needing metadata or BPM`
  );

  if (tracksNeedingWork.length === 0) {
    return currentData;
  }

  // Check for existing progress (resumable migration)
  let progress = getMigrationProgress();
  let processedUris: Set<string>;
  let failedUris: Set<string>;

  if (progress?.migrationName === "addTrackMetadata") {
    processedUris = new Set(progress.processedUris);
    failedUris = new Set(progress.failedUris || []);
    console.log(
      `Resuming migration: ${processedUris.size} processed, ${failedUris.size} failed`
    );
  } else {
    processedUris = new Set();
    failedUris = new Set();
    progress = {
      migrationName: "addTrackMetadata",
      processedUris: [],
      failedUris: [],
      totalTracks: tracksNeedingWork.length,
      startedAt: Date.now(),
    };
  }

  // Filter out already processed tracks, but INCLUDE previously failed tracks for retry
  const remainingTracks = tracksNeedingWork.filter(
    (uri) => !processedUris.has(uri) || failedUris.has(uri)
  );

  const updatedData = { ...currentData, tracks: { ...currentData.tracks } };

  // First pass: populate from existing cache (metadata only)
  const stillNeedWork: string[] = [];

  for (const uri of remainingTracks) {
    // Skip if this was a non-retryable failure
    if (failedUris.has(uri) && !processedUris.has(uri)) {
      stillNeedWork.push(uri);
      continue;
    }

    const track = updatedData.tracks[uri];
    const needsMetadata = !track.name || !track.artists;
    const needsBpm = track.bpm === null;

    let metadataResolved = !needsMetadata;

    if (needsMetadata) {
      const cachedInfo = TrackInfoCacheManager.getTrackInfo(uri);
      if (cachedInfo) {
        updatedData.tracks[uri] = {
          ...updatedData.tracks[uri],
          name: cachedInfo.name,
          artists: cachedInfo.artists,
        };
        metadataResolved = true;
      }
    }

    if (!metadataResolved || needsBpm) {
      stillNeedWork.push(uri);
    } else {
      processedUris.add(uri);
      failedUris.delete(uri);
    }
  }

  const resolvedFromCache = remainingTracks.length - stillNeedWork.length;
  console.log(`Resolved ${resolvedFromCache} tracks from cache`);
  console.log(`Need to fetch data for ${stillNeedWork.length} tracks`);

  if (resolvedFromCache > 0) {
    setTagData(updatedData);
    progress.processedUris = Array.from(processedUris);
    progress.failedUris = Array.from(failedUris);
    saveMigrationProgress(progress);
  }

  // Second pass: fetch from API with retry logic
  const BATCH_SIZE = 5;
  const BASE_DELAY_BETWEEN_BATCHES_MS = 500;
  const SAVE_EVERY_N_BATCHES = 10;
  const MAX_RETRIES_PER_TRACK = 3;
  const MAX_CONSECUTIVE_FAILURES = 10;

  let consecutiveFailures = 0;
  let currentDelay = BASE_DELAY_BETWEEN_BATCHES_MS;

  for (let i = 0; i < stillNeedWork.length; i += BATCH_SIZE) {
    const batch = stillNeedWork.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(
      async (uri): Promise<TrackMigrationResult> => {
        const track = updatedData.tracks[uri];
        const needsMetadata = !track.name || !track.artists;
        const needsBpm = track.bpm === null;

        const updates: Partial<TrackData> = {};
        let retryCount = 0;
        let lastError: any = null;

        while (retryCount < MAX_RETRIES_PER_TRACK) {
          try {
            // Fetch metadata if needed
            if (needsMetadata && !updates.name) {
              const trackInfo = await spotifyService.getTrack(uri);
              if (trackInfo) {
                updates.name = trackInfo.name;
                updates.artists = trackInfo.artists;
              }
            }

            // Fetch BPM if needed
            if (needsBpm && updates.bpm === undefined) {
              const trackId = uri.split(":").pop();
              if (trackId) {
                const bpm = await audioFeaturesService.getBpm(trackId);
                if (bpm !== null) {
                  updates.bpm = bpm;
                }
              }
            }

            // Success
            return { uri, success: true, updates, retryable: false };
          } catch (error: any) {
            lastError = error;
            retryCount++;

            if (isRetryableError(error) && retryCount < MAX_RETRIES_PER_TRACK) {
              const backoffDelay = getBackoffDelay(retryCount);
              console.warn(
                `Retryable error for ${uri}, attempt ${retryCount}/${MAX_RETRIES_PER_TRACK}. Waiting ${backoffDelay}ms...`
              );
              await delay(backoffDelay);
            } else {
              break;
            }
          }
        }

        // Failed after all retries
        console.error(
          `Failed to fetch data for ${uri} after ${retryCount} attempts:`,
          lastError
        );
        return {
          uri,
          success: false,
          updates,
          retryable: isRetryableError(lastError),
        };
      }
    );

    const results = await Promise.allSettled(batchPromises);

    let batchFailures = 0;

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { uri, success, updates, retryable } = result.value;

        if (success) {
          if (Object.keys(updates).length > 0) {
            updatedData.tracks[uri] = {
              ...updatedData.tracks[uri],
              ...updates,
            };
          }
          processedUris.add(uri);
          failedUris.delete(uri);
          consecutiveFailures = 0;
        } else {
          batchFailures++;
          if (retryable) {
            // Keep in failedUris for retry on next migration run
            failedUris.add(uri);
          } else {
            // Non-retryable error, mark as processed to skip
            processedUris.add(uri);
            failedUris.delete(uri);
          }
        }
      } else {
        // Promise rejected (shouldn't happen with our try/catch, but handle it)
        batchFailures++;
        consecutiveFailures++;
      }
    }

    // Track consecutive failures for backoff
    if (batchFailures > 0) {
      consecutiveFailures += batchFailures;
      // Increase delay on failures
      currentDelay = Math.min(currentDelay * 1.5, 5000);
    } else {
      // Reset delay on success
      currentDelay = BASE_DELAY_BETWEEN_BATCHES_MS;
    }

    // If too many consecutive failures, pause migration
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(
        `Too many consecutive failures (${consecutiveFailures}). Pausing migration.`
      );
      progress.processedUris = Array.from(processedUris);
      progress.failedUris = Array.from(failedUris);
      saveMigrationProgress(progress);
      setTagData(updatedData);

      // Don't mark migration as complete - it will resume next time
      throw new Error(
        "Migration paused due to repeated failures. Will retry on next app launch."
      );
    }

    // Report progress
    const totalProcessed = processedUris.size;
    onProgress?.(totalProcessed, tracksNeedingWork.length);

    // Save progress periodically
    const batchNumber = Math.floor(i / BATCH_SIZE);
    if (batchNumber > 0 && batchNumber % SAVE_EVERY_N_BATCHES === 0) {
      progress.processedUris = Array.from(processedUris);
      progress.failedUris = Array.from(failedUris);
      saveMigrationProgress(progress);
      setTagData(updatedData);
    }

    // Throttle between batches
    if (i + BATCH_SIZE < stillNeedWork.length) {
      await delay(currentDelay);
    }
  }

  // Final save
  setTagData(updatedData);
  saveMigrationProgress(null);

  const failedCount = failedUris.size;
  if (failedCount > 0) {
    console.warn(
      `Track metadata migration complete with ${failedCount} failed tracks`
    );
  } else {
    console.log(
      `Track metadata and BPM migration complete: ${processedUris.size} tracks processed`
    );
  }

  return updatedData;
};

// Main migration runner
export const runMigrations = async (
  currentData: TagDataStructure,
  setTagData: (
    data: TagDataStructure | ((prev: TagDataStructure) => TagDataStructure)
  ) => void,
  onProgress?: (migrationName: string, processed: number, total: number) => void
): Promise<boolean> => {
  if (!currentData.tracks || Object.keys(currentData.tracks).length === 0) {
    console.log("No tracks found, skipping migration");
    return false;
  }

  const migrationState = getMigrationState();
  let hasChanges = false;
  let updatedData = currentData;

  console.log(
    `Checking migrations. Current: ${migrationState.version}, Target: ${CURRENT_VERSION}`
  );

  // Migration 1: cleanup empty tracks
  if (!migrationState.migrations.cleanupEmptyTracks) {
    updatedData = cleanupEmptyTracksMigration(updatedData);
    migrationState.migrations.cleanupEmptyTracks = true;
    hasChanges = true;
    setTagData(updatedData);
  }

  // Migration 2: add track metadata (async)
  if (!migrationState.migrations.addTrackMetadata) {
    try {
      updatedData = await addTrackMetadataMigration(
        updatedData,
        setTagData,
        (processed, total) => onProgress?.("addTrackMetadata", processed, total)
      );
      migrationState.migrations.addTrackMetadata = true;
      hasChanges = true;
    } catch (error: any) {
      if (error.message?.includes("Migration paused")) {
        console.warn("Migration paused, will continue on next launch");
      } else {
        throw error;
      }
    }
  }

  // Migration 3: remove trackInfoCache (track metadata stored in tagData now)
  if (!migrationState.migrations.removeTrackInfoCache) {
    console.log("Removing deprecated trackInfoCache...");
    localStorage.removeItem("tagify:trackInfoCache");
    migrationState.migrations.removeTrackInfoCache = true;
    hasChanges = true;
  }

  // Update version and save state (ONLY ONCE - removed duplicate)
  if (hasChanges || migrationState.version !== CURRENT_VERSION) {
    migrationState.version = CURRENT_VERSION;
    saveMigrationState(migrationState);

    // Save to localStorage (data migrations work on localStorage)
    try {
      localStorage.setItem("tagify:tagData", JSON.stringify(updatedData));
      console.log("[runMigrations] Saved migrated data to localStorage");
    } catch (error) {
      console.error("Failed to save migrated data to localStorage:", error);
    }

    const event = new CustomEvent("tagify:dataUpdated", {
      detail: { type: "migration" },
    });
    window.dispatchEvent(event);
  }

  return hasChanges;
};

export const needsMigrations = (): boolean => {
  const migrationState = getMigrationState();
  return (
    migrationState.version !== CURRENT_VERSION ||
    !migrationState.migrations.cleanupEmptyTracks ||
    !migrationState.migrations.addTrackMetadata
  );
};
