import { Dispatch, MutableRefObject, SetStateAction, useCallback } from "react";
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

  return !playlistData.name || playlistData.trackCount === undefined;
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
    async (playlistUriOrId: string): Promise<PlaylistMetadata | null> => {
      const metadata = await spotifyApiService.getPlaylistMetadata(playlistUriOrId);
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

  const getOrCreatePlaylistData = useCallback(
    async (
      playlistUriOrId: string,
      providedMetadata?: PlaylistMetadata,
    ): Promise<{ playlistUri: string; currentData: TagDataStructure }> => {
      const playlistUri = normalizePlaylistUri(playlistUriOrId);
      const now = Date.now();
      const currentData = latestTagDataRef.current;
      const existingPlaylist = currentData.playlists[playlistUri];

      if (!existingPlaylist) {
        const metadata = providedMetadata || (await getPlaylistMetadata(playlistUri));
        const nextData: TagDataStructure = {
          ...currentData,
          playlists: {
            ...currentData.playlists,
            [playlistUri]: createInitialPlaylistData(now, metadata),
          },
        };

        commitDataSnapshot(nextData);
        return { playlistUri, currentData: nextData };
      }

      if (needsPlaylistMetadataHydration(playlistUri, existingPlaylist)) {
        const metadata = providedMetadata || (await getPlaylistMetadata(playlistUri));
        if (metadata) {
          const nextData: TagDataStructure = {
            ...currentData,
            playlists: {
              ...currentData.playlists,
              [playlistUri]: withPlaylistMetadata(existingPlaylist, metadata, now),
            },
          };

          commitDataSnapshot(nextData);
          return { playlistUri, currentData: nextData };
        }
      }

      return { playlistUri, currentData };
    },
    [commitDataSnapshot, getPlaylistMetadata, latestTagDataRef],
  );

  const toggleTagPlaylist = useCallback(
    async (
      playlistUriOrId: string,
      tagId: string,
      metadata?: PlaylistMetadata,
    ) => {
      const { playlistUri, currentData } = await getOrCreatePlaylistData(
        playlistUriOrId,
        metadata,
      );
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
      const currentData = latestTagDataRef.current;
      const playlistData = currentData.playlists[playlistUri];
      const metadata = await getPlaylistMetadata(playlistUri);

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
      const { playlistUri, currentData } = await getOrCreatePlaylistData(
        playlistUriOrId,
        metadata,
      );
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
      const { playlistUri, currentData } = await getOrCreatePlaylistData(
        playlistUriOrId,
        metadata,
      );
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
    toggleTagPlaylist,
    setPlaylistRating,
    setPlaylistEnergy,
    refreshPlaylistMetadata,
    prunePlaylistsForTaxonomy,
    findPlaylistTagName,
  };
}
