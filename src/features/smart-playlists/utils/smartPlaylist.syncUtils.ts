import { SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { TagDataStructure, TrackData } from "@/types/tagData";
import { evaluateTrackMatchesCriteria } from "./smartPlaylist.criteria";
import { applyTagChoice, smartPlaylistTagChoices } from "./smartPlaylist.tagChoices";

function chooseNearestAllowedRating(
  currentRating: number,
  allowedRatings: number[],
): number {
  return [...allowedRatings].sort((left, right) => {
    const distanceDifference =
      Math.abs(left - currentRating) - Math.abs(right - currentRating);
    return distanceDifference !== 0 ? distanceDifference : left - right;
  })[0];
}

export function applySmartPlaylistCriteriaToTrack(
  trackData: TrackData,
  criteria: SmartPlaylistFilterCriteria,
  now: number,
): TrackData {
  const choices = smartPlaylistTagChoices(trackData.tagIds, criteria);
  const nextTagIds = choices?.length === 1 ? applyTagChoice(trackData.tagIds, choices[0]) : trackData.tagIds;

  let rating = trackData.rating;
  const allowedRatings = Array.from(
    new Set((criteria.ratingFilters ?? []).filter(Number.isFinite)),
  );
  if (allowedRatings.length > 0 && !allowedRatings.includes(rating)) {
    rating = chooseNearestAllowedRating(rating, allowedRatings);
  }

  let energy = trackData.energy;
  if (
    criteria.energyMinFilter !== null &&
    energy < criteria.energyMinFilter
  ) {
    energy = criteria.energyMinFilter;
  }
  if (
    criteria.energyMaxFilter !== null &&
    energy > criteria.energyMaxFilter
  ) {
    energy = criteria.energyMaxFilter;
  }

  const changed =
    rating !== trackData.rating ||
    energy !== trackData.energy ||
    nextTagIds.length !== trackData.tagIds.length ||
    nextTagIds.some((tagId, index) => tagId !== trackData.tagIds[index]);

  if (!changed) {
    return trackData;
  }

  return {
    ...trackData,
    rating,
    energy,
    tagIds: nextTagIds,
    dateCreated: trackData.dateCreated || now,
    dateModified: now,
  };
}

export function findDuplicateTrackUris(trackUris: string[]): {
  occurrences: Map<string, number>;
  duplicateUris: Set<string>;
} {
  const occurrences = new Map<string, number>();
  const duplicateUris = new Set<string>();

  trackUris.forEach((trackUri) => {
    const count = occurrences.get(trackUri) || 0;
    occurrences.set(trackUri, count + 1);

    if (count > 0) {
      duplicateUris.add(trackUri);
    }
  });

  return {
    occurrences,
    duplicateUris,
  };
}

export function collectMatchingTrackUris(
  tracks: TagDataStructure["tracks"],
  criteria: SmartPlaylistFilterCriteria,
): string[] {
  const matchingTrackUris: string[] = [];

  Object.entries(tracks).forEach(([trackUri, trackData]) => {
    const matches = evaluateTrackMatchesCriteria(trackData, criteria);
    if (matches) {
      matchingTrackUris.push(trackUri);
    }
  });

  return matchingTrackUris;
}
