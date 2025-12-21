import { TrackData, TagDataStructure } from "@/hooks/data/useTagData";
import { TrackInfoCacheManager } from "./TrackInfoCache";
import packageJson from "@/package"

const MIGRATION_KEY = "tagify:migrations";
const CURRENT_VERSION = packageJson.version;

interface MigrationState {
  version: string;
  migrations: {
    cleanupEmptyTracks?: boolean;
    // future migrations here...
  };
}

const isTrackEmpty = (trackData: TrackData): boolean => {
  if (!trackData) {
    console.log("⚠️ trackData is null/undefined");
    return true;
  }

  return trackData.rating === 0 && trackData.energy === 0 && trackData.tags.length === 0;
};

const getMigrationState = (): MigrationState => {
  try {
    const saved = localStorage.getItem(MIGRATION_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error("Tagify: Error reading migration state:", error);
  }

  return {
    version: "0.0.0",
    migrations: {},
  };
};

const saveMigrationState = (state: MigrationState) => {
  try {
    localStorage.setItem(MIGRATION_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Tagify: Error saving migration state:", error);
  }
};

const cleanupEmptyTracksMigration = (currentData: TagDataStructure): TagDataStructure => {
  console.log("Running empty tracks cleanup migration...");

  const cleanedTracks: { [trackUri: string]: TrackData } = {};
  let removedCount = 0;

  Object.entries(currentData.tracks).forEach(([trackUri, trackData]) => {
    if (isTrackEmpty(trackData)) {
      TrackInfoCacheManager.removeTrackInfo(trackUri);
      removedCount++;
      console.log(`Removing empty track: ${trackUri}`);
    } else {
      cleanedTracks[trackUri] = trackData;
    }
  });

  console.log(`Cleanup migration complete: Removed ${removedCount} empty tracks`);

  return {
    ...currentData,
    tracks: cleanedTracks,
  };
};

// Main migration runner
export const runMigrations = (
  currentData: TagDataStructure,
  setTagData: (data: TagDataStructure | ((prev: TagDataStructure) => TagDataStructure)) => void
): boolean => {
  if (!currentData.tracks || Object.keys(currentData.tracks).length === 0) {
    console.log("No tracks found, skipping migration");
    return false;
  }
  const tracksWithData = Object.values(currentData.tracks).filter(
    (track) => track.rating > 0 || track.energy > 0 || (track.tags && track.tags.length > 0)
  ).length;

  console.log(`Found ${tracksWithData} tracks with actual data`);

  if (tracksWithData === 0) {
    console.log("No tracks have meaningful data, something might be wrong");
    return false;
  }

  const migrationState = getMigrationState();
  let hasChanges = false;
  let updatedData = currentData;

  console.log(
    `Checking migrations. Current: ${migrationState.version}, Target: ${CURRENT_VERSION}`
  );

  // Migration 1: Cleanup empty tracks
  if (!migrationState.migrations.cleanupEmptyTracks) {
    updatedData = cleanupEmptyTracksMigration(updatedData);
    migrationState.migrations.cleanupEmptyTracks = true;
    hasChanges = true;
  }

  // Add future migrations here:
  // if (!migrationState.migrations.someOtherMigration) {
  //   updatedData = someOtherMigration(updatedData);
  //   migrationState.migrations.someOtherMigration = true;
  //   hasChanges = true;
  // }

  // Update data if migrations ran
  if (hasChanges) {
    setTagData(updatedData);
  }

  // Update version and save state
  if (hasChanges || migrationState.version !== CURRENT_VERSION) {
    migrationState.version = CURRENT_VERSION;
    saveMigrationState(migrationState);

    // Trigger data update event for extensions
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
    migrationState.version !== CURRENT_VERSION || !migrationState.migrations.cleanupEmptyTracks
  );
};
