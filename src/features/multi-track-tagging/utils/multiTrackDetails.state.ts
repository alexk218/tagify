import { TrackTag } from "@/types/tagData";
import {
  DraftTagState,
  DraftTrackTagData,
} from "@/features/multi-track-tagging/model/useMultiTrackTagging.types";
import { isSameTrackTag } from "@/features/multi-track-tagging/utils/multiTrackTagging.draft";

const EMPTY_DRAFT_TRACK: DraftTrackTagData = {
  tagIds: [],
  rating: 0,
  energy: 0,
};

function getDraftTrackData(
  draftTags: DraftTagState,
  trackUri: string,
): DraftTrackTagData {
  return draftTags[trackUri] ?? EMPTY_DRAFT_TRACK;
}

export function hasDraftChanges(
  tracks: Array<{ uri: string }>,
  originalTrackDataMap: DraftTagState,
  draftTags: DraftTagState,
): boolean {
  for (const track of tracks) {
    const originalTrackData = getDraftTrackData(originalTrackDataMap, track.uri);
    const draftTrackData = getDraftTrackData(draftTags, track.uri);

    if (
      originalTrackData.tagIds.length !== draftTrackData.tagIds.length ||
      originalTrackData.rating !== draftTrackData.rating ||
      originalTrackData.energy !== draftTrackData.energy
    ) {
      return true;
    }

    const hasAllOriginalTags = originalTrackData.tagIds.every((originalTag) =>
      draftTrackData.tagIds.some((draftTag) => isSameTrackTag(draftTag, originalTag)),
    );

    if (!hasAllOriginalTags) {
      return true;
    }
  }

  return false;
}

export function createResetDraftState(
  tracks: Array<{ uri: string }>,
  originalTrackDataMap: DraftTagState,
): DraftTagState {
  const resetDraft: DraftTagState = {};

  tracks.forEach((track) => {
    const originalData = getDraftTrackData(originalTrackDataMap, track.uri);
    resetDraft[track.uri] = {
      tagIds: [...originalData.tagIds],
      rating: originalData.rating,
      energy: originalData.energy,
    };
  });

  return resetDraft;
}

export function getCurrentRating(
  draftTags: DraftTagState,
  lockedTrackUri: string | null,
  commonRating: number | undefined,
): number {
  if (lockedTrackUri) {
    return getDraftTrackData(draftTags, lockedTrackUri).rating;
  }

  return commonRating ?? 0;
}

export function getCurrentEnergy(
  draftTags: DraftTagState,
  lockedTrackUri: string | null,
  commonEnergy: number | undefined,
): number {
  if (lockedTrackUri) {
    return getDraftTrackData(draftTags, lockedTrackUri).energy;
  }

  return commonEnergy ?? 0;
}

export function getRatingDisplayValue(
  draftTags: DraftTagState,
  lockedTrackUri: string | null,
  commonRating: number | undefined,
): number | "None" | "Mixed" {
  if (lockedTrackUri) {
    const rating = getDraftTrackData(draftTags, lockedTrackUri).rating;
    return rating > 0 ? rating : "None";
  }

  return commonRating !== undefined ? commonRating : "Mixed";
}

export function getEnergyDisplayValue(
  draftTags: DraftTagState,
  lockedTrackUri: string | null,
  commonEnergy: number | undefined,
): number | "None" | "Mixed" {
  if (lockedTrackUri) {
    const energy = getDraftTrackData(draftTags, lockedTrackUri).energy;
    return energy > 0 ? energy : "None";
  }

  if (commonEnergy === undefined) {
    return "Mixed";
  }

  return commonEnergy > 0 ? commonEnergy : "None";
}

export function shouldShowRatingClearButton(
  draftTags: DraftTagState,
  lockedTrackUri: string | null,
  commonRating: number | undefined,
): boolean {
  const rating = lockedTrackUri
    ? getDraftTrackData(draftTags, lockedTrackUri).rating
    : commonRating;

  return rating !== undefined && rating > 0;
}

export function shouldShowEnergyClearButton(
  draftTags: DraftTagState,
  lockedTrackUri: string | null,
  commonEnergy: number | undefined,
): boolean {
  const energy = lockedTrackUri
    ? getDraftTrackData(draftTags, lockedTrackUri).energy
    : commonEnergy;

  return energy !== undefined && energy > 0;
}

export function getEnergyIsSetValue(
  draftTags: DraftTagState,
  lockedTrackUri: string | null,
  commonEnergy: number | undefined,
): "true" | "false" {
  if (lockedTrackUri) {
    return getDraftTrackData(draftTags, lockedTrackUri).energy > 0
      ? "true"
      : "false";
  }

  return commonEnergy !== undefined && commonEnergy > 0 ? "true" : "false";
}

export function isCommonTrackTag(commonTags: TrackTag[], tag: TrackTag): boolean {
  return commonTags.some((commonTag) => isSameTrackTag(commonTag, tag));
}

export function sortTrackTagsByName(
  tags: TrackTag[],
  findTagName: (tagId: string) => string,
): TrackTag[] {
  return [...tags].sort((left, right) => {
    const leftName = findTagName(left);
    const rightName = findTagName(right);

    return leftName.localeCompare(rightName);
  });
}
