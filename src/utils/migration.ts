import { TrackData, TagDataStructure } from "@/types/tagData";
import { TrackInfoCacheManager } from "./TrackInfoCache";
import packageJson from "@/package";
import {
  captureTrackDateModified,
  enforceMigrationDateModifiedPolicy,
} from "./migrationDateModified";

const MIGRATION_KEY = "tagify:migrations";
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
// Spotify details are optional and are handled by the bounded metadata backfill.
const addTrackMetadataMigration = async (
  currentData: TagDataStructure,
  _setTagData: (data: TagDataStructure | ((prev: TagDataStructure) => TagDataStructure)) => void,
  _onProgress?: (processed: number, total: number) => void,
): Promise<TagDataStructure> => {
  const tracks = { ...currentData.tracks };
  for (const [uri, track] of Object.entries(tracks)) {
    if (track.name && track.artists) continue;
    const cached = TrackInfoCacheManager.getTrackInfo(uri);
    if (cached) tracks[uri] = { ...track, name: track.name || cached.name, artists: track.artists || cached.artists };
  }
  return { ...currentData, tracks };
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
  const trackDateModifiedBeforeMigrations = captureTrackDateModified(currentData);
  const preserveLastUpdated = (data: TagDataStructure, migrationName: string) =>
    enforceMigrationDateModifiedPolicy(
      data,
      trackDateModifiedBeforeMigrations,
      migrationName,
    );

  console.log(
    `Checking migrations. Current: ${migrationState.version}, Target: ${CURRENT_VERSION}`
  );

  // Migration 1: cleanup empty tracks
  if (!migrationState.migrations.cleanupEmptyTracks) {
    updatedData = preserveLastUpdated(
      cleanupEmptyTracksMigration(updatedData),
      "cleanupEmptyTracks",
    );
    migrationState.migrations.cleanupEmptyTracks = true;
    hasChanges = true;
    setTagData(updatedData);
  }

  // Migration 2: add track metadata (async)
  if (!migrationState.migrations.addTrackMetadata) {
    try {
      updatedData = await addTrackMetadataMigration(
        updatedData,
        (next) => {
          if (typeof next === "function") {
            setTagData((previous) =>
              preserveLastUpdated(next(previous), "addTrackMetadata"),
            );
          } else {
            setTagData(preserveLastUpdated(next, "addTrackMetadata"));
          }
        },
        (processed, total) => onProgress?.("addTrackMetadata", processed, total)
      );
      updatedData = preserveLastUpdated(updatedData, "addTrackMetadata");
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
    updatedData = preserveLastUpdated(updatedData, "migration pipeline");
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
