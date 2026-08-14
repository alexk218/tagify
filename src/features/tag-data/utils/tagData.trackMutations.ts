import { TagDataStructure, TrackData, TrackTag } from "@/types/tagData";
import { normalizeCamelotKey } from "@/utils/camelotKey";
import type { TrackMetadata } from "../model/useTagData.types";
import { isSameTrackTag, isTrackEmpty } from "./tagData.helpers";

export interface CommitTrackMutationResult {
  nextData: TagDataStructure;
  finalTrackData: TrackData | null;
}

export function createInitialTrackData(
  now: number,
  bpm: number | null,
  metadata?: TrackMetadata,
  camelotKey?: string | null,
): TrackData {
  const normalizedCamelotKey = normalizeCamelotKey(camelotKey);

  return {
    rating: 0,
    energy: 0,
    bpm,
    ...(normalizedCamelotKey ? { camelotKey: normalizedCamelotKey } : {}),
    tagIds: [],
    dateCreated: now,
    dateModified: now,
    name: metadata?.name,
    artists: metadata?.artists,
  };
}

export function withTrackMetadata(
  trackData: TrackData,
  metadata: TrackMetadata,
  now: number,
): TrackData {
  return {
    ...trackData,
    name: trackData.name || metadata.name,
    artists: trackData.artists || metadata.artists,
    dateModified: now,
  };
}

export function withBpm(
  trackData: TrackData,
  bpm: number | null,
  now: number,
): TrackData {
  return {
    ...trackData,
    bpm,
    dateCreated: trackData.dateCreated || now,
    dateModified: now,
  };
}

export function withCamelotKey(
  trackData: TrackData,
  camelotKey: string | null,
  now: number,
): TrackData {
  const normalizedCamelotKey = normalizeCamelotKey(camelotKey);
  const nextTrackData: TrackData = {
    ...trackData,
    dateCreated: trackData.dateCreated || now,
    dateModified: now,
  };

  if (normalizedCamelotKey) {
    nextTrackData.camelotKey = normalizedCamelotKey;
  } else {
    delete nextTrackData.camelotKey;
  }

  return nextTrackData;
}

export function withRating(
  trackData: TrackData,
  rating: number,
  now: number,
): TrackData {
  return {
    ...trackData,
    rating,
    dateCreated: trackData.dateCreated || now,
    dateModified: now,
  };
}

export function withEnergy(
  trackData: TrackData,
  energy: number,
  now: number,
): TrackData {
  return {
    ...trackData,
    energy,
    dateCreated: trackData.dateCreated || now,
    dateModified: now,
  };
}

export function withToggledTrackTag(
  trackData: TrackData,
  tag: TrackTag,
  now: number,
): TrackData {
  const existingTagIndex = trackData.tagIds.findIndex((trackTag) =>
    isSameTrackTag(trackTag, tag),
  );

  const updatedTags =
    existingTagIndex >= 0
      ? [
          ...trackData.tagIds.slice(0, existingTagIndex),
          ...trackData.tagIds.slice(existingTagIndex + 1),
        ]
      : [...trackData.tagIds, tag];

  return {
    ...trackData,
    tagIds: updatedTags,
    dateCreated: trackData.dateCreated || now,
    dateModified: now,
  };
}

export function commitTrackMutation(
  currentData: TagDataStructure,
  trackUri: string,
  updatedTrackData: TrackData,
): CommitTrackMutationResult {
  if (isTrackEmpty(updatedTrackData)) {
    const { [trackUri]: _removedTrack, ...remainingTracks } = currentData.tracks;
    return {
      nextData: {
        ...currentData,
        tracks: remainingTracks,
      },
      finalTrackData: null,
    };
  }

  return {
    nextData: {
      ...currentData,
      tracks: {
        ...currentData.tracks,
        [trackUri]: updatedTrackData,
      },
    },
    finalTrackData: updatedTrackData,
  };
}
