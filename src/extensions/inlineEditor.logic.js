export const STAR_RATINGS = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);
export const ENERGY_RATINGS = Array.from({ length: 10 }, (_, index) => index + 1);

export function clampRating(value, allowedValues) {
  const numericValue = Number(value);
  return allowedValues.includes(numericValue) ? numericValue : 0;
}

export function createUpdatedTrack(track, changes, now) {
  const currentTrack = track || {};

  return {
    ...currentTrack,
    rating: clampRating(
      changes.rating ?? currentTrack.rating ?? 0,
      [0, ...STAR_RATINGS],
    ),
    energy: clampRating(
      changes.energy ?? currentTrack.energy ?? 0,
      [0, ...ENERGY_RATINGS],
    ),
    bpm: currentTrack.bpm ?? null,
    tagIds: Array.isArray(changes.tagIds)
      ? changes.tagIds
      : Array.isArray(currentTrack.tagIds)
        ? currentTrack.tagIds
        : [],
    dateCreated: currentTrack.dateCreated ?? now,
    dateModified: now,
  };
}

export function toggleTagId(tagIds, tagId) {
  return tagIds.includes(tagId)
    ? tagIds.filter((id) => id !== tagId)
    : [...tagIds, tagId];
}

export function toggleTagIdForSelection(tagIdsByTrack, tagId) {
  const normalizedTagIds = tagIdsByTrack.map((tagIds) =>
    Array.isArray(tagIds) ? tagIds : [],
  );
  const shouldRemove =
    normalizedTagIds.length > 0 &&
    normalizedTagIds.every((tagIds) => tagIds.includes(tagId));

  return normalizedTagIds.map((tagIds) => {
    if (shouldRemove) {
      return tagIds.filter((id) => id !== tagId);
    }

    return tagIds.includes(tagId) ? tagIds : [...tagIds, tagId];
  });
}

export function getRatingUpdateForSelection(currentRatings, selectedRating) {
  const allHaveSelectedRating =
    currentRatings.length > 0 &&
    currentRatings.every((rating) => Number(rating) === selectedRating);

  return allHaveSelectedRating ? 0 : selectedRating;
}

export function addRecentTag(recentTagIds, tagId, limit = 5) {
  return [tagId, ...recentTagIds.filter((id) => id !== tagId)].slice(0, limit);
}

export function getTagIndicatorStatus(track, tagCount) {
  if (tagCount <= 0) {
    return "none";
  }

  return track?.rating > 0 && track?.energy > 0 ? "complete" : "incomplete";
}
