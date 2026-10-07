import { useCallback, useEffect, useRef } from "react";
import { spotifyService } from "@/services/SpotifyService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { storageService } from "@/services/storage";
import { ArtistData, PlaylistData, TrackData } from "@/types/tagData";
import { normalizeCamelotKey } from "@/utils/camelotKey";
import { withPlaylistMetadata } from "@/features/tag-data";
import { withArtistMetadata } from "@/features/tag-data";

export interface MetadataBackfillProgress {
  processed: number;
  total: number;
  updated: number;
  remaining: number;
}

export interface RunMetadataBackfillOptions {
  batchDelayMs?: number;
  maxTracksPerRun?: number;
  onProgress?: (progress: MetadataBackfillProgress) => void;
}

export interface UseMetadataBackfillOptions {
  enabled?: boolean;
  onComplete?: () => void;
  onProgress?: (progress: MetadataBackfillProgress | null) => void;
}

const MAX_BACKFILL_ATTEMPTS = 3;
const AUDIO_FEATURES_BACKFILL_REVISION = "spotify-client-audio-analysis-v1";
let sessionBackfillPromise: Promise<number> | null = null;

function needsCurrentAudioFeaturesRetry(track: TrackData): boolean {
  return (
    (track.bpm === null || normalizeCamelotKey(track.camelotKey) === null) &&
    track.audioFeaturesBackfillRevision !== AUDIO_FEATURES_BACKFILL_REVISION
  );
}

function isMissingEntityName(
  name: string | undefined,
  placeholder: string,
): boolean {
  return !name || name.trim().toLowerCase() === placeholder.toLowerCase();
}

/**
 * One-time backfill of missing track, playlist, album, and artist metadata.
 * Runs once on mount, reads/writes directly to IndexedDB via storageService.
 */
export function useMetadataBackfill({
  enabled = true,
  onComplete,
  onProgress,
}: UseMetadataBackfillOptions = {}) {
  const hasRun = useRef(false);
  const isRunning = useRef(false);
  const rerunRequested = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  const run = useCallback(async (refresh = false) => {
    if (isRunning.current) {
      rerunRequested.current = true;
      return;
    }

    isRunning.current = true;
    try {
      let forceRefresh = refresh;
      do {
        rerunRequested.current = false;
        const updatedCount = forceRefresh
          ? await runMetadataBackfill({ onProgress: (progress) => onProgressRef.current?.(progress) })
          : await runMetadataBackfillOnce({ onProgress: (progress) => onProgressRef.current?.(progress) });
        if (updatedCount > 0) onCompleteRef.current?.();
        forceRefresh = rerunRequested.current;
      } while (rerunRequested.current);
    } catch (error) {
      console.error("[MetadataBackfill] Backfill failed:", error);
    } finally {
      isRunning.current = false;
      onProgressRef.current?.(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled || hasRun.current) {
      return;
    }

    hasRun.current = true;
    void run();
  }, [enabled, run]);

  useEffect(() => {
    if (!enabled) return;
    const handleRemoteData = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; origin?: string }>).detail;
      if (detail?.type === "sync" && detail.origin === "remote") void run(true);
    };
    window.addEventListener("tagify:dataUpdated", handleRemoteData);
    return () => window.removeEventListener("tagify:dataUpdated", handleRemoteData);
  }, [enabled, run]);
}

export function runMetadataBackfillOnce(options: RunMetadataBackfillOptions = {}): Promise<number> {
  if (!sessionBackfillPromise) {
    sessionBackfillPromise = runMetadataBackfill(options);
  }

  return sessionBackfillPromise;
}

export async function runMetadataBackfill({ batchDelayMs = 1000, maxTracksPerRun = 50, onProgress }: RunMetadataBackfillOptions = {}): Promise<number> {
  if (!storageService.isReady()) {
    await storageService.initialize();
  }

  const tagData = await storageService.loadAll();
  if (!tagData) {
    return 0;
  }

  const eligibleTracks = Object.entries(tagData.tracks).filter(
    ([uri, track]) => {
      if (uri.startsWith("spotify:local:")) {
        return false;
      }

      const hasTagData =
        track.rating > 0 ||
        track.energy > 0 ||
        track.tagIds.length > 0;
      const needsMetadata = !track.name || !track.artists;
      const needsAudioFeatures =
        track.bpm === null || normalizeCamelotKey(track.camelotKey) === null;
      const shouldRetryAudioFeatures = needsCurrentAudioFeaturesRetry(track);

      const generalAllowed = (track.backfillAttempts || 0) < MAX_BACKFILL_ATTEMPTS || shouldRetryAudioFeatures;
      const needsAlbum = !track.albumUri || !track.albumName || !track.albumImageUrl;
      const albumAllowed = (track.albumBackfillAttempts || 0) < MAX_BACKFILL_ATTEMPTS;
      return hasTagData && ((generalAllowed && (needsMetadata || needsAudioFeatures)) || (albumAllowed && needsAlbum));
    },
  );
  const tracksToBackfill = eligibleTracks.slice(0, Math.max(0, maxTracksPerRun));
  const remaining = Math.max(0, eligibleTracks.length - tracksToBackfill.length);
  const playlistsToBackfill = Object.entries(tagData.playlists).filter(
    ([uri, playlist]) =>
      isMissingEntityName(
        playlist.name,
        uri.startsWith("spotify:album:") ? "Unknown Album" : "Unknown Playlist",
      ),
  );
  const artistsToBackfill = Object.entries(tagData.artists).filter(([, artist]) =>
    isMissingEntityName(artist.name, "Unknown Artist"),
  );

  if (
    tracksToBackfill.length === 0 &&
    playlistsToBackfill.length === 0 &&
    artistsToBackfill.length === 0
  ) {
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
    `[MetadataBackfill] Backfilling ${tracksToBackfill.length} tracks, ${playlistsToBackfill.length} playlists/albums, and ${artistsToBackfill.length} artists (track metadata-only: ${reasonCounts.metadataOnly}, audio-only: ${reasonCounts.audioOnly}, both: ${reasonCounts.both})`,
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

          if ((!currentTrack.name || !currentTrack.artists || !currentTrack.albumUri || !currentTrack.albumName || !currentTrack.albumImageUrl) && (currentTrack.albumBackfillAttempts || 0) < MAX_BACKFILL_ATTEMPTS) {
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
            if (info) {
              for (const key of ["albumUri", "albumName", "albumImageUrl"] as const) {
                if (!currentTrack[key] && info[key]) {
                  currentTrack[key] = info[key];
                  updated = true;
                }
              }
            }
            if (!currentTrack.albumUri || !currentTrack.albumName || !currentTrack.albumImageUrl) {
              currentTrack.albumBackfillAttempts = (currentTrack.albumBackfillAttempts || 0) + 1;
              updated = true;
            } else if (currentTrack.albumBackfillAttempts) {
              delete currentTrack.albumBackfillAttempts;
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

          if (stillNeedsAudioFeatures) {
            currentTrack.audioFeaturesBackfillRevision =
              AUDIO_FEATURES_BACKFILL_REVISION;
          } else if (currentTrack.audioFeaturesBackfillRevision) {
            delete currentTrack.audioFeaturesBackfillRevision;
            updated = true;
          }

          if (stillNeedsMetadata || stillNeedsAudioFeatures) {
            const currentAttempts = currentTrack.backfillAttempts || 0;
            currentTrack.backfillAttempts = currentAttempts + 1;
            updated = true;
            console.warn(
              `[MetadataBackfill] Incomplete for ${uri} (metadataMissing=${stillNeedsMetadata}, audioFeaturesMissing=${stillNeedsAudioFeatures}) (attempt ${currentTrack.backfillAttempts}/${MAX_BACKFILL_ATTEMPTS})`,
            );
          } else if (
            currentTrack.backfillAttempts ||
            currentTrack.audioFeaturesBackfillRevision
          ) {
            delete currentTrack.backfillAttempts;
            delete currentTrack.audioFeaturesBackfillRevision;
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
    onProgress?.({ processed: Math.min(index + BATCH_SIZE, tracksToBackfill.length), total: tracksToBackfill.length, updated: updatedCount, remaining });
    if (batchDelayMs > 0 && index + BATCH_SIZE < tracksToBackfill.length) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    }
  }

  for (let index = 0; index < playlistsToBackfill.length; index += BATCH_SIZE) {
    const batch = playlistsToBackfill.slice(index, index + BATCH_SIZE);
    const updatedPlaylists = new Map<string, PlaylistData>();

    await Promise.all(
      batch.map(async ([uri, playlist]) => {
        try {
          const metadata = await spotifyApiService.getPlaylistMetadata(uri);
          if (!metadata) {
            return;
          }

          updatedPlaylists.set(
            uri,
            withPlaylistMetadata(playlist, metadata, Date.now()),
          );
          updatedCount += 1;
        } catch (error) {
          console.warn(
            `[MetadataBackfill] Failed playlist/album lookup for ${uri}:`,
            error,
          );
        }
      }),
    );

    if (updatedPlaylists.size > 0) {
      await storageService.savePlaylists(updatedPlaylists);
    }
  }

  for (let index = 0; index < artistsToBackfill.length; index += BATCH_SIZE) {
    const batch = artistsToBackfill.slice(index, index + BATCH_SIZE);
    const updatedArtists = new Map<string, ArtistData>();

    await Promise.all(
      batch.map(async ([uri, artist]) => {
        try {
          const metadata = await spotifyApiService.getArtistMetadata(uri);
          if (!metadata) {
            return;
          }

          updatedArtists.set(uri, withArtistMetadata(artist, metadata, Date.now()));
          updatedCount += 1;
        } catch (error) {
          console.warn(`[MetadataBackfill] Failed artist lookup for ${uri}:`, error);
        }
      }),
    );

    if (updatedArtists.size > 0) {
      await storageService.saveArtists(updatedArtists);
    }
  }

  console.log(`[MetadataBackfill] Complete. Updated ${updatedCount} entities`);
  return updatedCount;
}
