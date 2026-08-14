import { BatchTagUpdate, TagDataStructure, TrackTag } from "@/types/tagData";
import {
  DraftTagState,
  DraftTrackTagData,
} from "@/features/multi-track-tagging/model/useMultiTrackTagging.types";

function createDefaultDraftTrackData(): DraftTrackTagData {
  return {
    tagIds: [],
    rating: 0,
    energy: 0,
  };
}

function cloneDraftTrackData(
  trackData: DraftTrackTagData | undefined,
): DraftTrackTagData {
  if (!trackData) {
    return createDefaultDraftTrackData();
  }

  return {
    tagIds: [...trackData.tagIds],
    rating: trackData.rating,
    energy: trackData.energy,
  };
}

export function isSameTrackTag(left: TrackTag, right: TrackTag): boolean {
  return left === right;
}

function hasTrackTag(tags: TrackTag[], target: TrackTag): boolean {
  return tags.some((tag) => isSameTrackTag(tag, target));
}

export function createDraftTagState(
  trackUris: string[],
  tracks: TagDataStructure["tracks"],
): DraftTagState {
  const initialDraft: DraftTagState = {};

  trackUris.forEach((trackUri) => {
    const trackData = tracks[trackUri];
    initialDraft[trackUri] = {
      tagIds: [...(trackData?.tagIds ?? [])],
      rating: trackData?.rating ?? 0,
      energy: trackData?.energy ?? 0,
    };
  });

  return initialDraft;
}

export function findCommonTagsFromDraft(draftTags: DraftTagState): TrackTag[] {
  const trackUris = Object.keys(draftTags);

  if (trackUris.length === 0) {
    return [];
  }

  const firstTrackUri = trackUris[0];
  const firstTrackTags = draftTags[firstTrackUri]?.tagIds ?? [];

  if (trackUris.length === 1) {
    return firstTrackTags;
  }

  return firstTrackTags.filter((candidateTag) =>
    trackUris.every((trackUri) => {
      const currentTrackTags = draftTags[trackUri]?.tagIds ?? [];
      return hasTrackTag(currentTrackTags, candidateTag);
    }),
  );
}

export function findCommonStarRatingFromDraft(
  draftTags: DraftTagState,
): number | undefined {
  const trackUris = Object.keys(draftTags);

  if (trackUris.length === 0) {
    return undefined;
  }

  const firstTrackUri = trackUris[0];
  const firstTrackRating = draftTags[firstTrackUri]?.rating;

  if (trackUris.length === 1) {
    return firstTrackRating;
  }

  const hasCommonStarRating = trackUris.every(
    (trackUri) => draftTags[trackUri]?.rating === firstTrackRating,
  );

  return hasCommonStarRating ? firstTrackRating : undefined;
}

export function findCommonEnergyRatingFromDraft(
  draftTags: DraftTagState,
): number | undefined {
  const trackUris = Object.keys(draftTags);

  if (trackUris.length === 0) {
    return undefined;
  }

  const firstTrackUri = trackUris[0];
  const firstTrackEnergy = draftTags[firstTrackUri]?.energy;

  if (trackUris.length === 1) {
    return firstTrackEnergy;
  }

  const hasCommonEnergyRating = trackUris.every(
    (trackUri) => draftTags[trackUri]?.energy === firstTrackEnergy,
  );

  return hasCommonEnergyRating ? firstTrackEnergy : undefined;
}

export function toggleTagForTrackDraft(
  draftTags: DraftTagState,
  trackUri: string,
  targetTag: TrackTag,
): DraftTagState {
  const nextDraft: DraftTagState = {
    ...draftTags,
  };

  const trackData = cloneDraftTrackData(nextDraft[trackUri]);
  const hasTag = hasTrackTag(trackData.tagIds, targetTag);

  nextDraft[trackUri] = {
    ...trackData,
    tagIds: hasTag
      ? trackData.tagIds.filter((tag) => !isSameTrackTag(tag, targetTag))
      : [...trackData.tagIds, targetTag],
  };

  return nextDraft;
}

export function toggleTagForAllTracksDraft(
  draftTags: DraftTagState,
  tracks: Array<{ uri: string }>,
  targetTag: TrackTag,
): DraftTagState {
  const nextDraft: DraftTagState = {
    ...draftTags,
  };

  const commonTags = findCommonTagsFromDraft(draftTags);
  const tagIsCommonToAll = hasTrackTag(commonTags, targetTag);

  tracks.forEach((track) => {
    const trackData = cloneDraftTrackData(nextDraft[track.uri]);
    const hasTag = hasTrackTag(trackData.tagIds, targetTag);

    if (tagIsCommonToAll && hasTag) {
      nextDraft[track.uri] = {
        ...trackData,
        tagIds: trackData.tagIds.filter((tag) => !isSameTrackTag(tag, targetTag)),
      };
      return;
    }

    if (!tagIsCommonToAll && !hasTag) {
      nextDraft[track.uri] = {
        ...trackData,
        tagIds: [...trackData.tagIds, targetTag],
      };
      return;
    }

    nextDraft[track.uri] = trackData;
  });

  return nextDraft;
}

export function toggleStarRatingDraftState(
  draftTags: DraftTagState,
  tracks: Array<{ uri: string }>,
  rating: number,
  lockedTrackUri: string | null,
): DraftTagState {
  const nextDraft: DraftTagState = {
    ...draftTags,
  };

  if (lockedTrackUri) {
    const trackData = cloneDraftTrackData(nextDraft[lockedTrackUri]);
    const nextRating = trackData.rating === rating ? 0 : rating;

    nextDraft[lockedTrackUri] = {
      ...trackData,
      rating: nextRating,
    };

    return nextDraft;
  }

  const commonRating = findCommonStarRatingFromDraft(draftTags);
  const nextRating = commonRating === rating ? 0 : rating;

  tracks.forEach((track) => {
    const trackData = cloneDraftTrackData(nextDraft[track.uri]);
    nextDraft[track.uri] = {
      ...trackData,
      rating: nextRating,
    };
  });

  return nextDraft;
}

export function toggleEnergyRatingDraftState(
  draftTags: DraftTagState,
  tracks: Array<{ uri: string }>,
  energy: number,
  lockedTrackUri: string | null,
): DraftTagState {
  const nextDraft: DraftTagState = {
    ...draftTags,
  };

  if (lockedTrackUri) {
    const trackData = cloneDraftTrackData(nextDraft[lockedTrackUri]);
    const nextEnergy = trackData.energy === energy ? 0 : energy;

    nextDraft[lockedTrackUri] = {
      ...trackData,
      energy: nextEnergy,
    };

    return nextDraft;
  }

  const commonEnergy = findCommonEnergyRatingFromDraft(draftTags);
  const nextEnergy = commonEnergy === energy ? 0 : energy;

  tracks.forEach((track) => {
    const trackData = cloneDraftTrackData(nextDraft[track.uri]);
    nextDraft[track.uri] = {
      ...trackData,
      energy: nextEnergy,
    };
  });

  return nextDraft;
}

export function calculateBatchChanges(
  tracks: Array<{ uri: string }>,
  originalTrackDataMap: DraftTagState,
  draftTags: DraftTagState,
): BatchTagUpdate[] {
  const changes: BatchTagUpdate[] = [];

  tracks.forEach((track) => {
    const originalData = originalTrackDataMap[track.uri] ?? createDefaultDraftTrackData();
    const draftData = draftTags[track.uri] ?? createDefaultDraftTrackData();

    const toAdd = draftData.tagIds.filter(
      (draftTag) => !hasTrackTag(originalData.tagIds, draftTag),
    );

    const toRemove = originalData.tagIds.filter(
      (originalTag) => !hasTrackTag(draftData.tagIds, originalTag),
    );

    const ratingChanged = originalData.rating !== draftData.rating;
    const energyChanged = originalData.energy !== draftData.energy;

    if (toAdd.length === 0 && toRemove.length === 0 && !ratingChanged && !energyChanged) {
      return;
    }

    const change: BatchTagUpdate = {
      trackUri: track.uri,
      toAdd,
      toRemove,
    };

    if (ratingChanged) {
      change.newRating = draftData.rating;
    }

    if (energyChanged) {
      change.newEnergy = draftData.energy;
    }

    changes.push(change);
  });

  return changes;
}
