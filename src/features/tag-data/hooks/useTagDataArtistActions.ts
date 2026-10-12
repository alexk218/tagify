import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { Dispatch, MutableRefObject, SetStateAction, useCallback, useRef } from "react";
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
    async (artistUriOrId: string, background = false): Promise<ArtistMetadata | null> => {
      const metadata = await spotifyApiService.getArtistMetadata(artistUriOrId, { priority: background ? "background" : "foreground" });
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

  const pendingMetadata = useRef(new Map<string, object>());
  const hydrateMetadata = useCallback((uri: string, recreated = false) => {
    const account = getTagifyDatabaseName();
    const key = `${account}:${uri}`;
    if (pendingMetadata.current.has(key) && !recreated) return;
    const original = latestTagDataRef.current.artists[uri];
    const token = {};
    pendingMetadata.current.set(key, token);
    void getArtistMetadata(uri, true).then(metadata => {
      if (!metadata || account !== getTagifyDatabaseName() || pendingMetadata.current.get(key) !== token) return;
      const data = latestTagDataRef.current, current = data.artists[uri];
      // Never recreate a removed entity or overwrite details edited meanwhile.
      if (!current || current.dateCreated !== original?.dateCreated || !(!current.name || current.name === "Unknown Artist" || current.imageUrl === undefined)) return;
      commitDataSnapshot({ ...data, artists: { ...data.artists, [uri]: withArtistMetadata(current, metadata, current.dateModified ?? 0) } });
    }).catch(() => { /* Optional details can be recovered by the bounded backfill. */ })
      .finally(() => { if (pendingMetadata.current.get(key) === token) pendingMetadata.current.delete(key); });
  }, [commitDataSnapshot, getArtistMetadata, latestTagDataRef]);

  // Save locally first. A Spotify pause must not delay or reject an annotation.
  const getOrCreateArtistData = useCallback(
    (artistUriOrId: string, providedMetadata?: ArtistMetadata) => {
      const artistUri = normalizeArtistUri(artistUriOrId);
      const currentData = latestTagDataRef.current;
      const latest = currentData.artists[artistUri];
      if (!latest || providedMetadata) {
        const now = Date.now();
        commitDataSnapshot({ ...currentData, artists: { ...currentData.artists,
          [artistUri]: latest ? withArtistMetadata(latest, providedMetadata!, now) : createInitialArtistData(now, providedMetadata),
        } });
      }
      if (!providedMetadata && (!latest || !latest.name)) hydrateMetadata(artistUri, !latest);
      return { artistUri, currentData: latestTagDataRef.current };
    },
    [commitDataSnapshot, hydrateMetadata, latestTagDataRef],
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
      const { artistUri } = getOrCreateArtistData(
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
      const { artistUri } = getOrCreateArtistData(
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
      const { artistUri } = getOrCreateArtistData(
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
