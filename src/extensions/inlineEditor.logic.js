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
