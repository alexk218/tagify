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

  // Looking up details can take a moment; the library is read again after
  // the lookup so edits made meanwhile are kept, and an artist created by an
  // overlapping edit is not created twice.
  const getOrCreateArtistData = useCallback(
    async (
      artistUriOrId: string,
      providedMetadata?: ArtistMetadata,
    ): Promise<{ artistUri: string; currentData: TagDataStructure }> => {
      const artistUri = normalizeArtistUri(artistUriOrId);
      const needsHydration = (artist: ArtistData) =>
        !artist.name || artist.name === "Unknown Artist" || artist.imageUrl === undefined;
      const existingArtist = latestTagDataRef.current.artists[artistUri];
      const needsMetadata = !existingArtist || needsHydration(existingArtist);
      const metadata = needsMetadata ? providedMetadata || (await getArtistMetadata(artistUri)) : null;
      const now = Date.now();
      const currentData = latestTagDataRef.current;
      const latest = currentData.artists[artistUri];

      if (!latest) {
        const nextData: TagDataStructure = {
          ...currentData,
          artists: { ...currentData.artists, [artistUri]: createInitialArtistData(now, metadata ?? undefined) },
        };
        commitDataSnapshot(nextData);
        return { artistUri, currentData: nextData };
      }

      if (metadata && needsHydration(latest)) {
        const nextData: TagDataStructure = {
          ...currentData,
          artists: { ...currentData.artists, [artistUri]: withArtistMetadata(latest, metadata, now) },
        };
        commitDataSnapshot(nextData);
        return { artistUri, currentData: nextData };
      }

      return { artistUri, currentData };
    },
    [commitDataSnapshot, getArtistMetadata, latestTagDataRef],
  );

  // Suggestions use already displayed metadata and only add; repeated clicks are harmless.
  const addTagArtist = useCallback(
    (artistUriOrId: string, tagId: string, metadata?: ArtistMetadata) => {
      const currentData = latestTagDataRef.current;
      if (!buildValidTagIdSet(currentData.taxonomy).has(tagId)) return;
      const uri = normalizeArtistUri(artistUriOrId);
      const existing = currentData.artists[uri];
      if (existing?.tagIds.includes(tagId)) return;
      const now = Date.now();
      const entity = existing ?? createInitialArtistData(now, metadata);
      const { nextData } = commitArtistMutation(currentData, uri, {
        ...entity,
        tagIds: [...entity.tagIds, tagId],
        dateModified: now,
      });
      commitDataSnapshot(nextData);
    },
    [commitDataSnapshot, latestTagDataRef],
  );

  const toggleTagArtist = useCallback(
    async (
      artistUriOrId: string,
      tagId: string,
      metadata?: ArtistMetadata,
    ) => {
      const { artistUri } = await getOrCreateArtistData(
        artistUriOrId,
        metadata,
      );
      const currentData = latestTagDataRef.current;
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
      const metadata = await getArtistMetadata(artistUri);
      const currentData = latestTagDataRef.current;
      const artistData = currentData.artists[artistUri];

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
      const { artistUri } = await getOrCreateArtistData(
        artistUriOrId,
        metadata,
      );
      const currentData = latestTagDataRef.current;
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
      const { artistUri } = await getOrCreateArtistData(
        artistUriOrId,
        metadata,
      );
      const currentData = latestTagDataRef.current;
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
    addTagArtist,
    toggleTagArtist,
    setArtistRating,
    setArtistEnergy,
    refreshArtistMetadata,
    pruneArtistsForTaxonomy,
    findArtistTagName,
  };
}
