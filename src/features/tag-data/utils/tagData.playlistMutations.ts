import { PlaylistData, TagDataStructure } from "@/types/tagData";
import { isPlaylistEmpty } from "./tagData.helpers";
import type { PlaylistMetadata } from "../model/useTagData.types";

export interface CommitPlaylistMutationResult {
  nextData: TagDataStructure;
  finalPlaylistData: PlaylistData | null;
}

export function createInitialPlaylistData(
  now: number,
  metadata?: PlaylistMetadata | null,
): PlaylistData {
  return {
    rating: 0,
    energy: 0,
    tagIds: [],
    dateCreated: now,
    dateModified: now,
    name: metadata?.name,
    ownerName: metadata?.ownerName ?? null,
    imageUrl: metadata?.imageUrl ?? null,
    description: metadata?.description ?? null,
    trackCount: metadata?.trackCount ?? null,
    snapshotId: metadata?.snapshotId ?? null,
  };
}

export function withPlaylistMetadata(
  playlistData: PlaylistData,
  metadata: PlaylistMetadata,
  _now: number,
): PlaylistData {
  return {
    ...playlistData,
    name: metadata.name || playlistData.name,
    ownerName: metadata.ownerName ?? playlistData.ownerName ?? null,
    imageUrl: metadata.imageUrl ?? playlistData.imageUrl ?? null,
    description: metadata.description ?? playlistData.description ?? null,
    trackCount: metadata.trackCount ?? playlistData.trackCount ?? null,
    snapshotId: metadata.snapshotId ?? playlistData.snapshotId ?? null,
  };
}

export function withPlaylistRating(
  playlistData: PlaylistData,
  rating: number,
  now: number,
): PlaylistData {
  return {
    ...playlistData,
    rating,
    dateCreated: playlistData.dateCreated || now,
    dateModified: now,
  };
}

export function withPlaylistEnergy(
  playlistData: PlaylistData,
  energy: number,
  now: number,
): PlaylistData {
  return {
    ...playlistData,
    energy,
    dateCreated: playlistData.dateCreated || now,
    dateModified: now,
  };
}

export function withToggledPlaylistTag(
  playlistData: PlaylistData,
  tagId: string,
  now: number,
): PlaylistData {
  const existingTagIndex = playlistData.tagIds.indexOf(tagId);
  const updatedTags =
    existingTagIndex >= 0
      ? [
          ...playlistData.tagIds.slice(0, existingTagIndex),
          ...playlistData.tagIds.slice(existingTagIndex + 1),
        ]
      : [...playlistData.tagIds, tagId];

  return {
    ...playlistData,
    tagIds: updatedTags,
    dateCreated: playlistData.dateCreated || now,
    dateModified: now,
  };
}

export function commitPlaylistMutation(
  currentData: TagDataStructure,
  playlistUri: string,
  updatedPlaylistData: PlaylistData,
): CommitPlaylistMutationResult {
  if (isPlaylistEmpty(updatedPlaylistData)) {
    const { [playlistUri]: _removedPlaylist, ...remainingPlaylists } =
      currentData.playlists;
    return {
      nextData: {
        ...currentData,
        playlists: remainingPlaylists,
      },
      finalPlaylistData: null,
    };
  }

  return {
    nextData: {
      ...currentData,
      playlists: {
        ...currentData.playlists,
        [playlistUri]: updatedPlaylistData,
      },
    },
    finalPlaylistData: updatedPlaylistData,
  };
}
