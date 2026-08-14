import { ArtistData, TagDataStructure } from "@/types/tagData";
import { isArtistEmpty } from "./tagData.helpers";
import type { ArtistMetadata } from "../model/useTagData.types";

export interface CommitArtistMutationResult {
  nextData: TagDataStructure;
  finalArtistData: ArtistData | null;
}

export function createInitialArtistData(
  now: number,
  metadata?: ArtistMetadata | null,
): ArtistData {
  return {
    rating: 0,
    energy: 0,
    tagIds: [],
    dateCreated: now,
    dateModified: now,
    name: metadata?.name,
    imageUrl: metadata?.imageUrl ?? null,
    followerCount: metadata?.followerCount ?? null,
    genres: metadata?.genres || [],
  };
}

export function withArtistMetadata(
  artistData: ArtistData,
  metadata: ArtistMetadata,
  _now: number,
): ArtistData {
  return {
    ...artistData,
    name: metadata.name || artistData.name,
    imageUrl: metadata.imageUrl ?? artistData.imageUrl ?? null,
    followerCount: metadata.followerCount ?? artistData.followerCount ?? null,
    genres: metadata.genres.length > 0 ? metadata.genres : artistData.genres || [],
  };
}

export function withArtistRating(
  artistData: ArtistData,
  rating: number,
  now: number,
): ArtistData {
  return {
    ...artistData,
    rating,
    dateCreated: artistData.dateCreated || now,
    dateModified: now,
  };
}

export function withArtistEnergy(
  artistData: ArtistData,
  energy: number,
  now: number,
): ArtistData {
  return {
    ...artistData,
    energy,
    dateCreated: artistData.dateCreated || now,
    dateModified: now,
  };
}

export function withToggledArtistTag(
  artistData: ArtistData,
  tagId: string,
  now: number,
): ArtistData {
  const existingTagIndex = artistData.tagIds.indexOf(tagId);
  const updatedTags =
    existingTagIndex >= 0
      ? [
          ...artistData.tagIds.slice(0, existingTagIndex),
          ...artistData.tagIds.slice(existingTagIndex + 1),
        ]
      : [...artistData.tagIds, tagId];

  return {
    ...artistData,
    tagIds: updatedTags,
    dateCreated: artistData.dateCreated || now,
    dateModified: now,
  };
}

export function commitArtistMutation(
  currentData: TagDataStructure,
  artistUri: string,
  updatedArtistData: ArtistData,
): CommitArtistMutationResult {
  if (isArtistEmpty(updatedArtistData)) {
    const { [artistUri]: _removedArtist, ...remainingArtists } =
      currentData.artists;
    return {
      nextData: {
        ...currentData,
        artists: remainingArtists,
      },
      finalArtistData: null,
    };
  }

  return {
    nextData: {
      ...currentData,
      artists: {
        ...currentData.artists,
        [artistUri]: updatedArtistData,
      },
    },
    finalArtistData: updatedArtistData,
  };
}
