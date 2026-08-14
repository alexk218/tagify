import { useEffect, useRef } from "react";
import { spotifyService } from "@/services/SpotifyService";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { storageService } from "@/services/storage";
import { TrackData } from "@/types/tagData";
import { normalizeCamelotKey } from "@/utils/camelotKey";

export interface UseMetadataBackfillOptions {
  enabled?: boolean;
  onComplete?: () => void;
}

const MAX_BACKFILL_ATTEMPTS = 3;

/**
 * One-time backfill of missing track metadata (name, artists, bpm, key).
 * Runs once on mount, reads/writes directly to IndexedDB via storageService.
 */
export function useMetadataBackfill({
  enabled = true,
  onComplete,
}: UseMetadataBackfillOptions = {}) {
  const hasRun = useRef(false);

  useEffect(() => {
    if (!enabled || hasRun.current) {
      return;
    }

    hasRun.current = true;

    void runMetadataBackfill()
      .then((updatedCount) => {
        if (updatedCount > 0) {
          onComplete?.();
        }
      })
      .catch((error) => {
        console.error("[MetadataBackfill] Backfill failed:", error);
      });
  }, [enabled, onComplete]);
}

export async function runMetadataBackfill(): Promise<number> {
  if (!storageService.isReady()) {
    await storageService.initialize();
  }

  const tagData = await storageService.loadAll();
  if (!tagData) {
    return 0;
  }

  const tracksToBackfill = Object.entries(tagData.tracks).filter(
    ([uri, track]) => {
      if (uri.startsWith("spotify:local:")) {
        return false;
      }

      if (
        track.backfillAttempts &&
        track.backfillAttempts >= MAX_BACKFILL_ATTEMPTS
      ) {
        return false;
      }

      const hasTagData =
        track.rating > 0 ||
        track.energy > 0 ||
        track.tagIds.length > 0;
      const needsMetadata = !track.name || !track.artists;
      const needsAudioFeatures =
        track.bpm === null || normalizeCamelotKey(track.camelotKey) === null;

      return hasTagData && (needsMetadata || needsAudioFeatures);
    },
  );

  if (tracksToBackfill.length === 0) {
    return 0;
  }

  const reasonCounts = tracksToBackfill.reduce(
    (counts, [, track]) => {
      const needsMetadata = !track.name || !track.artists;
      const needsAudioFeatures =
        track.bpm === null || normalizeCamelotKey(track.camelotKey) === null;

      if (needsMetadata && needsAudioFeatures) {
        counts.both += 1;
      } else if (needsMetadata) {
        counts.metadataOnly += 1;
      } else if (needsAudioFeatures) {
        counts.audioOnly += 1;
      }

      return counts;
    },
    { metadataOnly: 0, audioOnly: 0, both: 0 },
  );

  console.log(
    `[MetadataBackfill] Backfilling ${tracksToBackfill.length} tracks (metadata-only: ${reasonCounts.metadataOnly}, audio-only: ${reasonCounts.audioOnly}, both: ${reasonCounts.both})`,
  );

  const BATCH_SIZE = 10;
  let updatedCount = 0;

  for (let index = 0; index < tracksToBackfill.length; index += BATCH_SIZE) {
    const batch = tracksToBackfill.slice(index, index + BATCH_SIZE);
    const updatedTracks = new Map<string, TrackData>();

    await Promise.all(
      batch.map(async ([uri]) => {
        try {
          let updated = false;
          const currentTrack = tagData.tracks[uri];

          if (!currentTrack.name || !currentTrack.artists) {
            const info = await spotifyService.getTrack(uri);

            if (info?.name && info.name.trim() !== "" && !currentTrack.name) {
              currentTrack.name = info.name;
              updated = true;
            }

            if (
              info?.artists &&
              info.artists.trim() !== "" &&
              !currentTrack.artists
            ) {
              currentTrack.artists = info.artists;
              updated = true;
            }
          }

          if (
            currentTrack.bpm === null ||
            normalizeCamelotKey(currentTrack.camelotKey) === null
          ) {
            const features = await audioFeaturesService.getAudioFeaturesFromUri(uri);
            const bpm = features?.bpm ?? null;
            if (currentTrack.bpm === null && bpm !== null) {
              currentTrack.bpm = bpm;
              updated = true;
            }

            const camelotKey = normalizeCamelotKey(features?.camelotKey);
            if (
              normalizeCamelotKey(currentTrack.camelotKey) === null &&
              camelotKey !== null
            ) {
              currentTrack.camelotKey = camelotKey;
              updated = true;
            }
          }

          const stillNeedsMetadata = !currentTrack.name || !currentTrack.artists;
          const stillNeedsAudioFeatures =
            currentTrack.bpm === null ||
            normalizeCamelotKey(currentTrack.camelotKey) === null;

          if (stillNeedsMetadata || stillNeedsAudioFeatures) {
            const currentAttempts = currentTrack.backfillAttempts || 0;
            currentTrack.backfillAttempts = currentAttempts + 1;
            updated = true;
            console.warn(
              `[MetadataBackfill] Incomplete for ${uri} (metadataMissing=${stillNeedsMetadata}, audioFeaturesMissing=${stillNeedsAudioFeatures}) (attempt ${currentTrack.backfillAttempts}/${MAX_BACKFILL_ATTEMPTS})`,
            );
          } else if (currentTrack.backfillAttempts) {
            delete currentTrack.backfillAttempts;
            updated = true;
          }

          if (updated) {
            updatedCount += 1;
            updatedTracks.set(uri, { ...currentTrack });
          }
        } catch (error) {
          const currentTrack = tagData.tracks[uri];
          const currentAttempts = currentTrack.backfillAttempts || 0;
          currentTrack.backfillAttempts = currentAttempts + 1;
          updatedCount += 1;
          updatedTracks.set(uri, { ...currentTrack });
          console.warn(
            `[MetadataBackfill] Failed for ${uri} (attempt ${currentTrack.backfillAttempts}/${MAX_BACKFILL_ATTEMPTS}):`,
            error,
          );
        }
      }),
    );

    if (updatedTracks.size > 0) {
      await storageService.saveTracks(updatedTracks);
    }
  }

  console.log(`[MetadataBackfill] Complete. Updated ${updatedCount} tracks`);
  return updatedCount;
}
