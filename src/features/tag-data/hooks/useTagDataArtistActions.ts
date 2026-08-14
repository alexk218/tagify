import { Dispatch, MutableRefObject, SetStateAction, useCallback } from "react";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { ArtistData, TagDataStructure, TagTaxonomy } from "@/types/tagData";
import { buildValidTagIdSet } from "@/utils/tagTaxonomy";
import {
  commitArtistMutation,
  createInitialArtistData,
  withArtistEnergy,
  withArtistMetadata,
  withArtistRating,
  withToggledArtistTag,
} from "../utils/tagData.artistMutations";
import {
  findTagNameInTaxonomy,
  keepArtistsWithValidTags,
} from "../utils/tagData.helpers";
import type { ArtistMetadata } from "../model/useTagData.types";

interface UseTagDataArtistActionsOptions {
  tagData: TagDataStructure;
  setTagData: Dispatch<SetStateAction<TagDataStructure>>;
  latestTagDataRef: MutableRefObject<TagDataStructure>;
}

function normalizeArtistUri(artistUriOrId: string): string {
  return spotifyApiService.normalizeArtistUri(artistUriOrId);
}

export function useTagDataArtistActions({
  tagData,
  setTagData,
  latestTagDataRef,
}: UseTagDataArtistActionsOptions) {
  const commitDataSnapshot = useCallback(
    (nextData: TagDataStructure): void => {
      latestTagDataRef.current = nextData;
      setTagData(nextData);
    },
    [latestTagDataRef, setTagData],
  );

  const getArtistMetadata = useCallback(
    async (artistUriOrId: string): Promise<ArtistMetadata | null> => {
      const metadata = await spotifyApiService.getArtistMetadata(artistUriOrId);
      if (!metadata) {
        return null;
      }

      return {
        name: metadata.name,
        imageUrl: metadata.imageUrl,
        followerCount: metadata.followerCount,
        genres: metadata.genres,
      };
    },
    [],
  );

  const getOrCreateArtistData = useCallback(
    async (
      artistUriOrId: string,
      providedMetadata?: ArtistMetadata,
    ): Promise<{ artistUri: string; currentData: TagDataStructure }> => {
      const artistUri = normalizeArtistUri(artistUriOrId);
      const now = Date.now();
      const currentData = latestTagDataRef.current;
      const existingArtist = currentData.artists[artistUri];

      if (!existingArtist) {
        const metadata = providedMetadata || (await getArtistMetadata(artistUri));
        const nextData: TagDataStructure = {
          ...currentData,
          artists: {
            ...currentData.artists,
            [artistUri]: createInitialArtistData(now, metadata),
          },
        };

        commitDataSnapshot(nextData);
        return { artistUri, currentData: nextData };
      }

      if (!existingArtist.name || existingArtist.imageUrl === undefined) {
        const metadata = providedMetadata || (await getArtistMetadata(artistUri));
        if (metadata) {
          const nextData: TagDataStructure = {
            ...currentData,
            artists: {
              ...currentData.artists,
              [artistUri]: withArtistMetadata(existingArtist, metadata, now),
            },
          };

          commitDataSnapshot(nextData);
          return { artistUri, currentData: nextData };
        }
      }

      return { artistUri, currentData };
    },
    [commitDataSnapshot, getArtistMetadata, latestTagDataRef],
  );

  const toggleTagArtist = useCallback(
    async (
      artistUriOrId: string,
      tagId: string,
      metadata?: ArtistMetadata,
    ) => {
      const { artistUri, currentData } = await getOrCreateArtistData(
        artistUriOrId,
        metadata,
      );
      const artistData = currentData.artists[artistUri];

      if (!artistData) {
        return;
      }

      const now = Date.now();
      const { nextData } = commitArtistMutation(
        currentData,
        artistUri,
        withToggledArtistTag(artistData, tagId, now),
      );

      commitDataSnapshot(nextData);
    },
    [commitDataSnapshot, getOrCreateArtistData],
  );

  const refreshArtistMetadata = useCallback(
    async (artistUriOrId: string): Promise<ArtistData | null> => {
      const artistUri = normalizeArtistUri(artistUriOrId);
      const currentData = latestTagDataRef.current;
      const artistData = currentData.artists[artistUri];
      const metadata = await getArtistMetadata(artistUri);

      if (!artistData || !metadata) {
        return artistData || null;
      }

      const now = Date.now();
      const nextArtistData = withArtistMetadata(artistData, metadata, now);
      const nextData: TagDataStructure = {
        ...currentData,
        artists: {
          ...currentData.artists,
          [artistUri]: nextArtistData,
        },
      };

      commitDataSnapshot(nextData);
      return nextArtistData;
    },
    [commitDataSnapshot, getArtistMetadata, latestTagDataRef],
  );

  const setArtistRating = useCallback(
    async (
      artistUriOrId: string,
      rating: number,
      metadata?: ArtistMetadata,
    ) => {
      const { artistUri, currentData } = await getOrCreateArtistData(
        artistUriOrId,
        metadata,
      );
      const artistData = currentData.artists[artistUri];

      if (!artistData) {
        return;
      }

      const now = Date.now();
      const { nextData } = commitArtistMutation(
        currentData,
        artistUri,
        withArtistRating(artistData, rating, now),
      );

      commitDataSnapshot(nextData);
    },
    [commitDataSnapshot, getOrCreateArtistData],
  );

  const setArtistEnergy = useCallback(
    async (
      artistUriOrId: string,
      energy: number,
      metadata?: ArtistMetadata,
    ) => {
      const { artistUri, currentData } = await getOrCreateArtistData(
        artistUriOrId,
        metadata,
      );
      const artistData = currentData.artists[artistUri];

      if (!artistData) {
        return;
      }

      const now = Date.now();
      const { nextData } = commitArtistMutation(
        currentData,
        artistUri,
        withArtistEnergy(artistData, energy, now),
      );

      commitDataSnapshot(nextData);
    },
    [commitDataSnapshot, getOrCreateArtistData],
  );

  const pruneArtistsForTaxonomy = useCallback(
    (newTaxonomy: TagTaxonomy) => {
      const validTagIds = buildValidTagIdSet(newTaxonomy);

      setTagData((currentData) => {
        const nextData = {
          ...currentData,
          artists: keepArtistsWithValidTags(currentData.artists, validTagIds),
        };

        latestTagDataRef.current = nextData;
        return nextData;
      });
    },
    [latestTagDataRef, setTagData],
  );

  const findArtistTagName = useCallback(
    (tagId: string): string => findTagNameInTaxonomy(tagData.taxonomy, tagId),
    [tagData.taxonomy],
  );

  return {
    toggleTagArtist,
    setArtistRating,
    setArtistEnergy,
    refreshArtistMetadata,
    pruneArtistsForTaxonomy,
    findArtistTagName,
  };
}
