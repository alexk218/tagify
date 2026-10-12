import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { Dispatch, MutableRefObject, SetStateAction, useCallback, useRef } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { PlaylistData, TagDataStructure, TagTaxonomy } from "@/types/tagData";
import { buildValidTagIdSet } from "@/utils/tagTaxonomy";
import {
  commitPlaylistMutation,
  createInitialPlaylistData,
  withPlaylistEnergy,
  withPlaylistMetadata,
  withPlaylistRating,
  withToggledPlaylistTag,
} from "../utils/tagData.playlistMutations";
import {
  findTagNameInTaxonomy,
  keepPlaylistsWithValidTags,
} from "../utils/tagData.helpers";
import type { PlaylistMetadata } from "../model/useTagData.types";

interface UseTagDataPlaylistActionsOptions {
  tagData: TagDataStructure;
  setTagData: Dispatch<SetStateAction<TagDataStructure>>;
  latestTagDataRef: MutableRefObject<TagDataStructure>;
}

function normalizePlaylistUri(playlistUriOrId: string): string {
  return spotifyApiService.normalizePlaylistUri(playlistUriOrId);
}

function needsPlaylistMetadataHydration(
  playlistUri: string,
  playlistData: { name?: string; imageUrl?: string | null; trackCount?: number | null },
): boolean {
  if (playlistUri.startsWith("spotify:album:")) {
    return (
      !playlistData.name ||
      playlistData.name === "Unknown Album" ||
      !playlistData.imageUrl
    );
  }

  return (
    !playlistData.name ||
    playlistData.name === "Unknown Playlist" ||
    playlistData.trackCount === undefined
  );
}

export function useTagDataPlaylistActions({
  tagData,
  setTagData,
  latestTagDataRef,
}: UseTagDataPlaylistActionsOptions) {
  const commitDataSnapshot = useCallback(
    (nextData: TagDataStructure): void => {
      latestTagDataRef.current = nextData;
      setTagData(nextData);
    },
    [latestTagDataRef, setTagData],
  );

  const getPlaylistMetadata = useCallback(
    async (playlistUriOrId: string, background = false): Promise<PlaylistMetadata | null> => {
      const metadata = await spotifyApiService.getPlaylistMetadata(playlistUriOrId, { priority: background ? "background" : "foreground" });
      if (!metadata) {
        return null;
      }

      return {
        name: metadata.name,
        ownerName: metadata.ownerName,
        imageUrl: metadata.imageUrl,
        description: metadata.description,
        trackCount: metadata.trackCount,
        snapshotId: metadata.snapshotId,
      };
    },
    [],
  );

  const pendingMetadata = useRef(new Map<string, object>());
  const hydrateMetadata = useCallback((uri: string, recreated = false) => {
    const account = getTagifyDatabaseName();
    const key = `${account}:${uri}`;
    if (pendingMetadata.current.has(key) && !recreated) return;
    const original = latestTagDataRef.current.playlists[uri];
    const token = {};
    pendingMetadata.current.set(key, token);
    void getPlaylistMetadata(uri, true).then(metadata => {
      if (!metadata || account !== getTagifyDatabaseName() || pendingMetadata.current.get(key) !== token) return;
      const data = latestTagDataRef.current, current = data.playlists[uri];
      // Never recreate a removed entity or overwrite details edited meanwhile.
      if (!current || current.dateCreated !== original?.dateCreated || !(needsPlaylistMetadataHydration(uri, current))) return;
      commitDataSnapshot({ ...data, playlists: { ...data.playlists, [uri]: withPlaylistMetadata(current, metadata, current.dateModified ?? 0) } });
    }).catch(() => { /* Optional details can be recovered by the bounded backfill. */ })
      .finally(() => { if (pendingMetadata.current.get(key) === token) pendingMetadata.current.delete(key); });
  }, [commitDataSnapshot, getPlaylistMetadata, latestTagDataRef]);

  // Save locally first. A Spotify pause must not delay or reject an annotation.
  const getOrCreatePlaylistData = useCallback(
    (playlistUriOrId: string, providedMetadata?: PlaylistMetadata) => {
      const playlistUri = normalizePlaylistUri(playlistUriOrId);
      const currentData = latestTagDataRef.current;
      const latest = currentData.playlists[playlistUri];
      if (!latest || providedMetadata) {
        const now = Date.now();
        commitDataSnapshot({ ...currentData, playlists: { ...currentData.playlists,
          [playlistUri]: latest ? withPlaylistMetadata(latest, providedMetadata!, now) : createInitialPlaylistData(now, providedMetadata),
        } });
      }
      if (!providedMetadata && (!latest || !latest.name)) hydrateMetadata(playlistUri, !latest);
      return { playlistUri, currentData: latestTagDataRef.current };
    },
    [commitDataSnapshot, hydrateMetadata, latestTagDataRef],
  );

  // Suggestions use already displayed metadata and only add; repeated clicks are harmless.
  const addTagPlaylist = useCallback(
    (playlistUriOrId: string, tagId: string, metadata?: PlaylistMetadata) => {
      const currentData = latestTagDataRef.current;
      if (!buildValidTagIdSet(currentData.taxonomy).has(tagId)) return;
      const uri = normalizePlaylistUri(playlistUriOrId);
      const existing = currentData.playlists[uri];
      if (existing?.tagIds.includes(tagId)) return;
      const now = Date.now();
      const entity = existing ?? createInitialPlaylistData(now, metadata);
      const { nextData } = commitPlaylistMutation(currentData, uri, {
        ...entity,
        tagIds: [...entity.tagIds, tagId],
        dateModified: now,
      });
      commitDataSnapshot(nextData);
    },
    [commitDataSnapshot, latestTagDataRef],
  );

  const toggleTagPlaylist = useCallback(
    async (
      playlistUriOrId: string,
      tagId: string,
      metadata?: PlaylistMetadata,
    ) => {
      const { playlistUri } = getOrCreatePlaylistData(
        playlistUriOrId,
        metadata,
      );
      const currentData = latestTagDataRef.current;
      const playlistData = currentData.playlists[playlistUri];

      if (!playlistData) {
        return;
      }

      const now = Date.now();
      const { nextData } = commitPlaylistMutation(
        currentData,
        playlistUri,
        withToggledPlaylistTag(playlistData, tagId, now),
      );

      commitDataSnapshot(nextData);
    },
    [commitDataSnapshot, getOrCreatePlaylistData],
  );

  const refreshPlaylistMetadata = useCallback(
    async (playlistUriOrId: string): Promise<PlaylistData | null> => {
      const playlistUri = normalizePlaylistUri(playlistUriOrId);
      const metadata = await getPlaylistMetadata(playlistUri);
      const currentData = latestTagDataRef.current;
      const playlistData = currentData.playlists[playlistUri];

      if (!playlistData || !metadata) {
        return playlistData || null;
      }

      const now = Date.now();
      const nextPlaylistData = withPlaylistMetadata(playlistData, metadata, now);
      const nextData: TagDataStructure = {
        ...currentData,
        playlists: {
          ...currentData.playlists,
          [playlistUri]: nextPlaylistData,
        },
      };

      commitDataSnapshot(nextData);
      return nextPlaylistData;
    },
    [commitDataSnapshot, getPlaylistMetadata, latestTagDataRef],
  );

  const setPlaylistRating = useCallback(
    async (
      playlistUriOrId: string,
      rating: number,
      metadata?: PlaylistMetadata,
    ) => {
      const { playlistUri } = getOrCreatePlaylistData(
        playlistUriOrId,
        metadata,
      );
      const currentData = latestTagDataRef.current;
      const playlistData = currentData.playlists[playlistUri];

      if (!playlistData) {
        return;
      }

      const now = Date.now();
      const { nextData } = commitPlaylistMutation(
        currentData,
        playlistUri,
        withPlaylistRating(playlistData, rating, now),
      );

      commitDataSnapshot(nextData);
    },
    [commitDataSnapshot, getOrCreatePlaylistData],
  );

  const setPlaylistEnergy = useCallback(
    async (
      playlistUriOrId: string,
      energy: number,
      metadata?: PlaylistMetadata,
    ) => {
      const { playlistUri } = getOrCreatePlaylistData(
        playlistUriOrId,
        metadata,
      );
      const currentData = latestTagDataRef.current;
      const playlistData = currentData.playlists[playlistUri];

      if (!playlistData) {
        return;
      }

      const now = Date.now();
      const { nextData } = commitPlaylistMutation(
        currentData,
        playlistUri,
        withPlaylistEnergy(playlistData, energy, now),
      );

      commitDataSnapshot(nextData);
    },
    [commitDataSnapshot, getOrCreatePlaylistData],
  );

  const prunePlaylistsForTaxonomy = useCallback(
    (newTaxonomy: TagTaxonomy) => {
      const validTagIds = buildValidTagIdSet(newTaxonomy);

      setTagData((currentData) => {
        const nextData = {
          ...currentData,
          playlists: keepPlaylistsWithValidTags(currentData.playlists, validTagIds),
        };

        latestTagDataRef.current = nextData;
        return nextData;
      });
    },
    [latestTagDataRef, setTagData],
  );

  const findPlaylistTagName = useCallback(
    (tagId: string): string => findTagNameInTaxonomy(tagData.taxonomy, tagId),
    [tagData.taxonomy],
  );

  return {
    addTagPlaylist,
    toggleTagPlaylist,
    setPlaylistRating,
    setPlaylistEnergy,
    refreshPlaylistMetadata,
    prunePlaylistsForTaxonomy,
    findPlaylistTagName,
  };
}
