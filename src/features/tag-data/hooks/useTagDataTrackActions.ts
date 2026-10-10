import { trackEditHistory, type EditSession } from "@/services/TrackEditHistory";
import { expandRecordingEdits } from "@/features/recording-reuse/utils/recordingReuse";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { Dispatch, MutableRefObject, SetStateAction, useCallback, useRef } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import {
  BatchTagUpdate,
  TagDataStructure,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";
import { dispatchTagDataUpdatedEvent } from "../utils/tagData.events";
import {
  findTagNameInTaxonomy,
  isArtistEmpty,
  isPlaylistEmpty,
  isTrackEmpty,
  withoutRemovedTags,
} from "../utils/tagData.helpers";
import { mergeTaxonomy } from "../utils/tagData.taxonomyMerge";
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
  /** Shows the saved library without undoing edits that are not saved yet. */
  refreshPersistedTagData?: () => Promise<void>;
  setTagData: Dispatch<SetStateAction<TagDataStructure>>;
  latestTagDataRef: MutableRefObject<TagDataStructure>;
  onSyncTrack: UseTagDataOptions["onSyncTrack"];
  onSyncMultipleTracks: UseTagDataOptions["onSyncMultipleTracks"];
  emitUserTrackAddedEvent: (trackUris?: string[]) => void;
}

const TRACK_SYNC_DELAY_MS = 100;

/** An edit can't start while Undo, Redo, or a bulk save is finishing; say so instead of ignoring it. */
function isHistoryBusy(): boolean {
  if (!trackEditHistory.getSnapshot().busy) return false;
  Spicetify.showNotification("Tagify is still finishing your last change. Try that again in a moment.", true);
  return true;
}

export function useTagDataTrackActions({
  tagData,
  refreshPersistedTagData,
  setTagData,
  latestTagDataRef,
  onSyncTrack,
  onSyncMultipleTracks,
  emitUserTrackAddedEvent,
}: UseTagDataTrackActionsOptions) {
  const commitDataSnapshot = useCallback(
    (nextData: TagDataStructure, session: EditSession | null = null): void => {
      const current = latestTagDataRef.current.tracks;
      const edits = Object.fromEntries(Object.entries(nextData.tracks).filter(([uri, track]) => track !== current[uri]));
      nextData = { ...nextData, tracks: { ...nextData.tracks, ...expandRecordingEdits(current, edits) } as Record<string, TrackData> };
      trackEditHistory.record(session, current, nextData.tracks, "saved");
      latestTagDataRef.current = nextData;
      setTagData(nextData);
    },
    [latestTagDataRef, setTagData],
  );

  const syncTrackAfterDelay = useCallback(
    (trackUri: string) => {
      const account = getTagifyDatabaseName();
      setTimeout(() => {
        if (account !== getTagifyDatabaseName()) return;
        const group = latestTagDataRef.current.tracks[trackUri]?.recordingGroupId;
        if (group && onSyncMultipleTracks) {
          void onSyncMultipleTracks(Object.fromEntries(Object.entries(latestTagDataRef.current.tracks).filter(([, track]) => track.recordingGroupId === group)));
        } else onSyncTrack?.(trackUri, latestTagDataRef.current.tracks[trackUri] || null);
      }, TRACK_SYNC_DELAY_MS);
    },
    [onSyncTrack, onSyncMultipleTracks, latestTagDataRef],
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

  /**
   * Saves an edited tag setup. `base` is the setup the edit started from, so
   * tags created elsewhere since then are kept. Only tags the user removed
   * are taken off songs, playlists, and artists.
   */
  const replaceTaxonomy = useCallback(
    (newTaxonomy: TagTaxonomy, removedTagIds: string[] = [], base?: TagTaxonomy) => {
      const removed = new Set(removedTagIds);

      setTagData((currentData) => {
        const nextData = {
          ...currentData,
          taxonomy: base ? mergeTaxonomy(base, newTaxonomy, currentData.taxonomy) : newTaxonomy,
          tracks: withoutRemovedTags(currentData.tracks, removed, isTrackEmpty),
          playlists: withoutRemovedTags(currentData.playlists, removed, isPlaylistEmpty),
          artists: withoutRemovedTags(currentData.artists, removed, isArtistEmpty),
        };

        latestTagDataRef.current = nextData;
        return nextData;
      });
    },
    [latestTagDataRef, setTagData],
  );

  const applyBatchTagUpdates = useCallback(
    async (updates: BatchTagUpdate[]) => {
      const databaseName = getTagifyDatabaseName();
      await flushLocalPersistence();
      const currentData = latestTagDataRef.current;
      const finalTrackDataMap = await indexedDBStorage.applyBulkTagUpdates(updates, databaseName);
      if (refreshPersistedTagData) await refreshPersistedTagData();
      else commitDataSnapshot(await indexedDBStorage.loadAllStrict());
      const addedUris = Object.keys(finalTrackDataMap).filter((uri) =>
        !currentData.tracks[uri] && finalTrackDataMap[uri] !== null,
      );
      if (addedUris.length && !updates.some(update => update.automaticRuleIds?.length)) emitUserTrackAddedEvent(addedUris);

      dispatchTagDataUpdatedEvent("batchUpdate");

      setTimeout(() => {
        if (databaseName !== getTagifyDatabaseName()) return;
        // Undo or another edit may have happened since this batch was saved.
        onSyncMultipleTracks?.(Object.fromEntries(Object.keys(finalTrackDataMap).map(uri => [uri, latestTagDataRef.current.tracks[uri] || null])));
      }, TRACK_SYNC_DELAY_MS);
    },
    [refreshPersistedTagData, commitDataSnapshot, emitUserTrackAddedEvent, latestTagDataRef, onSyncMultipleTracks],
  );

  const setBpm = useCallback(
    async (trackUri: string, bpm: number | null, session = trackEditHistory.capture("single", [trackUri])) => {
      if (session && isHistoryBusy()) return;
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
      const { nextData } = commitTrackMutation(
        currentData,
        trackUri,
        withBpm(trackData, bpm, now),
      );

      commitDataSnapshot(nextData, session);
      syncTrackAfterDelay(trackUri);
    },
    [commitDataSnapshot, ensureTrackData, latestTagDataRef, syncTrackAfterDelay],
  );

  const setCamelotKey = useCallback(
    async (trackUri: string, camelotKey: string | null) => {
      const session = trackEditHistory.capture("single", [trackUri]);
      if (session && isHistoryBusy()) return;
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
      const { nextData } = commitTrackMutation(
        currentData,
        trackUri,
        withCamelotKey(trackData, camelotKey, now),
      );

      commitDataSnapshot(nextData, session);
      syncTrackAfterDelay(trackUri);
    },
    [commitDataSnapshot, ensureTrackData, latestTagDataRef, syncTrackAfterDelay],
  );

  const updateBpm = useCallback(
    async (trackUri: string): Promise<number | null> => {
      const session = trackEditHistory.capture("single", [trackUri]);
      if (session && isHistoryBusy()) return null;
      try {
        const bpm = await spotifyApiService.fetchBpm(trackUri);
        if (bpm !== null) {
          await setBpm(trackUri, bpm, session);
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
      const session = trackEditHistory.capture("single", [trackUri]);
      if (session && isHistoryBusy()) return;
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

      commitDataSnapshot(nextData, session);
      syncTrackAfterDelay(trackUri);

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
      const session = trackEditHistory.capture("single", [trackUri]);
      if (session && isHistoryBusy()) return;
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

      commitDataSnapshot(nextData, session);
      syncTrackAfterDelay(trackUri);

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
      const session = trackEditHistory.capture("single", [trackUri]);
      if (session && isHistoryBusy()) return;
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

      commitDataSnapshot(nextData, session);
      syncTrackAfterDelay(trackUri);

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
