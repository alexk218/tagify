import { Dispatch, MutableRefObject, SetStateAction, useCallback, useRef } from "react";
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
  emitUserTrackAddedEvent: (trackUris?: string[]) => void;
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
            albumName: item.album?.name,
            albumUri: item.album?.uri ?? null,
            albumImageUrl:
              item.album?.images?.[0]?.url ||
              item.images?.[0]?.url ||
              item.metadata?.image_url ||
              null,
          };
        }

        const trackInfo = await spotifyService.getTrack(trackUri);
        if (trackInfo) {
          return {
            name: trackInfo.name,
            artists: trackInfo.artists,
            albumName: trackInfo.albumName,
            albumUri: trackInfo.albumUri,
            albumImageUrl: trackInfo.albumImageUrl,
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

  // Creating a song waits for its details, so overlapping edits to the same
  // new song share one creation and apply in the order they were made.
  const pendingTrackCreationsRef = useRef(new Map<string, Promise<boolean>>());

  const createTrackData = useCallback(
    async (trackUri: string, providedMetadata?: TrackMetadata): Promise<boolean> => {
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

      // Other edits may have saved while this one waited.
      const latestData = latestTagDataRef.current;
      if (latestData.tracks[trackUri]) {
        return false;
      }

      commitDataSnapshot({
        ...latestData,
        tracks: {
          ...latestData.tracks,
          [trackUri]: createInitialTrackData(
            Date.now(),
            bpm,
            metadata || undefined,
            camelotKey,
          ),
        },
      });
      return true;
    },
    [commitDataSnapshot, getTrackMetadata, latestTagDataRef],
  );

  /** Saves the song if needed; resolves true when this call created it. */
  const ensureTrackData = useCallback(
    async (trackUri: string, providedMetadata?: TrackMetadata): Promise<boolean> => {
      const existingTrack = latestTagDataRef.current.tracks[trackUri];

      if (!existingTrack) {
        const pendingCreation = pendingTrackCreationsRef.current.get(trackUri);
        if (pendingCreation) {
          await pendingCreation;
          return false;
        }

        const creation = createTrackData(trackUri, providedMetadata).finally(() => {
          pendingTrackCreationsRef.current.delete(trackUri);
        });
        pendingTrackCreationsRef.current.set(trackUri, creation);
        // Awaiting here, as later edits do above, keeps them in order.
        return await creation;
      }

      if (!existingTrack.name || !existingTrack.artists) {
        const metadata = providedMetadata || (await getTrackMetadata(trackUri));
        const latestData = latestTagDataRef.current;
        const latestTrack = latestData.tracks[trackUri];

        if (metadata && latestTrack) {
          commitDataSnapshot({
            ...latestData,
            tracks: {
              ...latestData.tracks,
              [trackUri]: withTrackMetadata(latestTrack, metadata, Date.now()),
            },
          });
        }
      }

      return false;
    },
    [commitDataSnapshot, createTrackData, getTrackMetadata, latestTagDataRef],
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
      const currentData = latestTagDataRef.current;
      const result = applyBatchTagUpdatesToData(currentData, updates, now);
      const finalTrackDataMap = result.finalTrackDataMap;
      commitDataSnapshot(result.nextData);
      const addedUris = Object.keys(finalTrackDataMap).filter((uri) =>
        !currentData.tracks[uri] && finalTrackDataMap[uri] !== null,
      );
      if (addedUris.length) emitUserTrackAddedEvent(addedUris);

      dispatchTagDataUpdatedEvent("batchUpdate");

      setTimeout(() => {
        onSyncMultipleTracks?.(finalTrackDataMap);
      }, TRACK_SYNC_DELAY_MS);
    },
    [commitDataSnapshot, emitUserTrackAddedEvent, latestTagDataRef, onSyncMultipleTracks],
  );

  const setBpm = useCallback(
    async (trackUri: string, bpm: number | null) => {
      if (!latestTagDataRef.current.tracks[trackUri]) {
        Spicetify.showNotification("Try tagging the track first!", true);
        return;
      }

      await ensureTrackData(trackUri);
      const currentData = latestTagDataRef.current;
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
    [commitDataSnapshot, ensureTrackData, latestTagDataRef, syncTrackAfterDelay],
  );

  const setCamelotKey = useCallback(
    async (trackUri: string, camelotKey: string | null) => {
      if (!latestTagDataRef.current.tracks[trackUri]) {
        Spicetify.showNotification("Try tagging the track first!", true);
        return;
      }

      await ensureTrackData(trackUri);
      const currentData = latestTagDataRef.current;
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
    [commitDataSnapshot, ensureTrackData, latestTagDataRef, syncTrackAfterDelay],
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
      const createdTrack = await ensureTrackData(trackUri, metadata);
      const currentData = latestTagDataRef.current;
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

      if (createdTrack && finalTrackData !== null) {
        emitUserTrackAddedEvent([trackUri]);
      }
    },
    [
      commitDataSnapshot,
      emitUserTrackAddedEvent,
      ensureTrackData,
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
      const createdTrack = await ensureTrackData(trackUri, metadata);
      const currentData = latestTagDataRef.current;
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

      if (createdTrack && finalTrackData !== null) {
        emitUserTrackAddedEvent([trackUri]);
      }
    },
    [
      commitDataSnapshot,
      emitUserTrackAddedEvent,
      ensureTrackData,
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
      const createdTrack = await ensureTrackData(trackUri, metadata);
      const currentData = latestTagDataRef.current;
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

      if (createdTrack && finalTrackData !== null) {
        emitUserTrackAddedEvent([trackUri]);
      }
    },
    [
      commitDataSnapshot,
      emitUserTrackAddedEvent,
      ensureTrackData,
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
