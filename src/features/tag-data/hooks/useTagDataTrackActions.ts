import { Dispatch, MutableRefObject, SetStateAction, useCallback } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import {
  BatchTagUpdate,
  TagDataStructure,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";
import { buildValidTagIdSet } from "@/utils/tagTaxonomy";
import { applyBatchTagUpdatesToData } from "../utils/tagData.batchUpdates";
import { dispatchTagDataUpdatedEvent } from "../utils/tagData.events";
import {
  findTagNameInTaxonomy,
  keepArtistsWithValidTags,
  keepPlaylistsWithValidTags,
  keepTracksWithValidTags,
} from "../utils/tagData.helpers";
import {
  commitTrackMutation,
  createInitialTrackData,
  withBpm,
  withCamelotKey,
  withEnergy,
  withRating,
  withToggledTrackTag,
  withTrackMetadata,
} from "../utils/tagData.trackMutations";
import type { TrackMetadata, UseTagDataOptions } from "../model/useTagData.types";

interface UseTagDataTrackActionsOptions {
  tagData: TagDataStructure;
  setTagData: Dispatch<SetStateAction<TagDataStructure>>;
  latestTagDataRef: MutableRefObject<TagDataStructure>;
  onSyncTrack: UseTagDataOptions["onSyncTrack"];
  onSyncMultipleTracks: UseTagDataOptions["onSyncMultipleTracks"];
  emitUserTrackAddedEvent: () => void;
}

const TRACK_SYNC_DELAY_MS = 100;

export function useTagDataTrackActions({
  tagData,
  setTagData,
  latestTagDataRef,
  onSyncTrack,
  onSyncMultipleTracks,
  emitUserTrackAddedEvent,
}: UseTagDataTrackActionsOptions) {
  const commitDataSnapshot = useCallback(
    (nextData: TagDataStructure): void => {
      latestTagDataRef.current = nextData;
      setTagData(nextData);
    },
    [latestTagDataRef, setTagData],
  );

  const syncTrackAfterDelay = useCallback(
    (trackUri: string, trackData: TrackData | null) => {
      setTimeout(() => {
        onSyncTrack?.(trackUri, trackData);
      }, TRACK_SYNC_DELAY_MS);
    },
    [onSyncTrack],
  );

  const getTrackMetadata = useCallback(
    async (trackUri: string): Promise<TrackMetadata | null> => {
      try {
        const playerData = Spicetify?.Player?.data;
        const currentlyPlayingUri = playerData?.item?.uri;

        if (trackUri === currentlyPlayingUri && playerData?.item) {
          const item = playerData.item;
          const artists = Array.isArray(item.artists)
            ? item.artists
                .map((artist) => artist?.name)
                .filter((artistName): artistName is string => Boolean(artistName))
                .join(", ")
            : "";

          return {
            name: item.name || "Unknown Track",
            artists: artists || "Unknown Artist",
          };
        }

        const trackInfo = await spotifyService.getTrack(trackUri);
        if (trackInfo) {
          return {
            name: trackInfo.name,
            artists: trackInfo.artists,
          };
        }

        return null;
      } catch (error) {
        console.error("Error getting track metadata:", error);
        return null;
      }
    },
    [],
  );

  const getOrCreateTrackData = useCallback(
    async (
      trackUri: string,
      providedMetadata?: TrackMetadata,
    ): Promise<TagDataStructure> => {
      const now = Date.now();
      const currentData = latestTagDataRef.current;
      const existingTrack = currentData.tracks[trackUri];

      if (!existingTrack) {
        const metadata = providedMetadata || (await getTrackMetadata(trackUri));

        let bpm: number | null = null;
        let camelotKey: string | null = null;
        if (!trackUri.startsWith("spotify:local:")) {
          try {
            const audioFeatures = await spotifyApiService.fetchAudioFeatures(trackUri);
            bpm = audioFeatures.bpm;
            camelotKey = audioFeatures.camelotKey;
          } catch (error) {
            console.error("Error fetching audio features for new track:", error);
          }
        }

        const nextData: TagDataStructure = {
          ...currentData,
          tracks: {
            ...currentData.tracks,
            [trackUri]: createInitialTrackData(
              now,
              bpm,
              metadata || undefined,
              camelotKey,
            ),
          },
        };

        commitDataSnapshot(nextData);
        return nextData;
      }

      if (!existingTrack.name || !existingTrack.artists) {
        const metadata = providedMetadata || (await getTrackMetadata(trackUri));

        if (metadata) {
          const nextData: TagDataStructure = {
            ...currentData,
            tracks: {
              ...currentData.tracks,
              [trackUri]: withTrackMetadata(existingTrack, metadata, now),
            },
          };

          commitDataSnapshot(nextData);
          return nextData;
        }
      }

      return currentData;
    },
    [commitDataSnapshot, getTrackMetadata, latestTagDataRef],
  );

  const replaceTaxonomy = useCallback(
    (newTaxonomy: TagTaxonomy) => {
      const validTagIds = buildValidTagIdSet(newTaxonomy);

      setTagData((currentData) => {
        const nextData = {
          ...currentData,
          taxonomy: newTaxonomy,
          tracks: keepTracksWithValidTags(currentData.tracks, validTagIds),
          playlists: keepPlaylistsWithValidTags(currentData.playlists, validTagIds),
          artists: keepArtistsWithValidTags(currentData.artists, validTagIds),
        };

        latestTagDataRef.current = nextData;
        return nextData;
      });
    },
    [latestTagDataRef, setTagData],
  );

  const applyBatchTagUpdates = useCallback(
    async (updates: BatchTagUpdate[]) => {
      const now = Date.now();
      let finalTrackDataMap: Record<string, TrackData | null> = {};

      setTagData((currentData) => {
        const result = applyBatchTagUpdatesToData(currentData, updates, now);
        finalTrackDataMap = result.finalTrackDataMap;
        latestTagDataRef.current = result.nextData;
        return result.nextData;
      });

      dispatchTagDataUpdatedEvent("batchUpdate");

      setTimeout(() => {
        onSyncMultipleTracks?.(finalTrackDataMap);
      }, TRACK_SYNC_DELAY_MS);
    },
    [latestTagDataRef, onSyncMultipleTracks, setTagData],
  );

  const setBpm = useCallback(
    async (trackUri: string, bpm: number | null) => {
      if (!latestTagDataRef.current.tracks[trackUri]) {
        Spicetify.showNotification("Try tagging the track first!", true);
        return;
      }

      const currentData = await getOrCreateTrackData(trackUri);
      const trackData = currentData.tracks[trackUri];

      if (!trackData) {
        return;
      }

      const now = Date.now();
      const { nextData, finalTrackData } = commitTrackMutation(
        currentData,
        trackUri,
        withBpm(trackData, bpm, now),
      );

      commitDataSnapshot(nextData);
      syncTrackAfterDelay(trackUri, finalTrackData);
    },
    [commitDataSnapshot, getOrCreateTrackData, latestTagDataRef, syncTrackAfterDelay],
  );

  const setCamelotKey = useCallback(
    async (trackUri: string, camelotKey: string | null) => {
      if (!latestTagDataRef.current.tracks[trackUri]) {
        Spicetify.showNotification("Try tagging the track first!", true);
        return;
      }

      const currentData = await getOrCreateTrackData(trackUri);
      const trackData = currentData.tracks[trackUri];

      if (!trackData) {
        return;
      }

      const now = Date.now();
      const { nextData, finalTrackData } = commitTrackMutation(
        currentData,
        trackUri,
        withCamelotKey(trackData, camelotKey, now),
      );

      commitDataSnapshot(nextData);
      syncTrackAfterDelay(trackUri, finalTrackData);
    },
    [commitDataSnapshot, getOrCreateTrackData, latestTagDataRef, syncTrackAfterDelay],
  );

  const updateBpm = useCallback(
    async (trackUri: string): Promise<number | null> => {
      try {
        const bpm = await spotifyApiService.fetchBpm(trackUri);
        if (bpm !== null) {
          await setBpm(trackUri, bpm);
        }
        return bpm;
      } catch (error) {
        console.error("Error updating BPM:", error);
        return null;
      }
    },
    [setBpm],
  );

  const toggleTagSingleTrack = useCallback(
    async (
      trackUri: string,
      tagId: string,
      metadata?: TrackMetadata,
    ) => {
      const trackExistedBefore = Object.prototype.hasOwnProperty.call(
        latestTagDataRef.current.tracks,
        trackUri,
      );

      const currentData = await getOrCreateTrackData(trackUri, metadata);
      const trackData = currentData.tracks[trackUri];

      if (!trackData) {
        return;
      }

      const now = Date.now();
      const { nextData, finalTrackData } = commitTrackMutation(
        currentData,
        trackUri,
        withToggledTrackTag(trackData, tagId, now),
      );

      commitDataSnapshot(nextData);
      syncTrackAfterDelay(trackUri, finalTrackData);

      if (!trackExistedBefore && finalTrackData !== null) {
        emitUserTrackAddedEvent();
      }
    },
    [
      commitDataSnapshot,
      emitUserTrackAddedEvent,
      getOrCreateTrackData,
      latestTagDataRef,
      syncTrackAfterDelay,
    ],
  );

  const setRating = useCallback(
    async (
      trackUri: string,
      rating: number,
      metadata?: TrackMetadata,
    ) => {
      const trackExistedBefore = Object.prototype.hasOwnProperty.call(
        latestTagDataRef.current.tracks,
        trackUri,
      );

      const currentData = await getOrCreateTrackData(trackUri, metadata);
      const trackData = currentData.tracks[trackUri];

      if (!trackData) {
        return;
      }

      const now = Date.now();
      const { nextData, finalTrackData } = commitTrackMutation(
        currentData,
        trackUri,
        withRating(trackData, rating, now),
      );

      commitDataSnapshot(nextData);
      syncTrackAfterDelay(trackUri, finalTrackData);

      if (!trackExistedBefore && finalTrackData !== null) {
        emitUserTrackAddedEvent();
      }
    },
    [
      commitDataSnapshot,
      emitUserTrackAddedEvent,
      getOrCreateTrackData,
      latestTagDataRef,
      syncTrackAfterDelay,
    ],
  );

  const setEnergy = useCallback(
    async (
      trackUri: string,
      energy: number,
      metadata?: TrackMetadata,
    ) => {
      const trackExistedBefore = Object.prototype.hasOwnProperty.call(
        latestTagDataRef.current.tracks,
        trackUri,
      );

      const currentData = await getOrCreateTrackData(trackUri, metadata);
      const trackData = currentData.tracks[trackUri];

      if (!trackData) {
        return;
      }

      const now = Date.now();
      const { nextData, finalTrackData } = commitTrackMutation(
        currentData,
        trackUri,
        withEnergy(trackData, energy, now),
      );

      commitDataSnapshot(nextData);
      syncTrackAfterDelay(trackUri, finalTrackData);

      if (!trackExistedBefore && finalTrackData !== null) {
        emitUserTrackAddedEvent();
      }
    },
    [
      commitDataSnapshot,
      emitUserTrackAddedEvent,
      getOrCreateTrackData,
      latestTagDataRef,
      syncTrackAfterDelay,
    ],
  );

  const findTagName = useCallback(
    (tagId: string): string => findTagNameInTaxonomy(tagData.taxonomy, tagId),
    [tagData.taxonomy],
  );

  return {
    replaceTaxonomy,
    applyBatchTagUpdates,
    setBpm,
    setCamelotKey,
    updateBpm,
    toggleTagSingleTrack,
    setRating,
    setEnergy,
    findTagName,
  };
}
