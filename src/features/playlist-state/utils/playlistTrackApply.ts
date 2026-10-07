import { BatchTagUpdate, BatchTrackAlbumDetails, TrackData } from "@/types/tagData";

/** The album or playlist's own values that can be copied onto its tracks. */
export interface PlaylistTrackApplyValues {
  tagIds: string[];
  rating: number;
  energy: number;
}

export interface PlaylistTrackApplyChoices {
  tags: boolean;
  rating: boolean;
  energy: boolean;
}

export interface PlaylistTrackApplyPreview {
  trackCount: number;
  /** Tracks missing at least one of the tags. */
  tagTrackCount: number;
  /** Tracks without a rating of their own. */
  ratingTrackCount: number;
  /** Tracks without energy of their own. */
  energyTrackCount: number;
}

function getMissingTagIds(track: TrackData | undefined, tagIds: string[]): string[] {
  return tagIds.filter((tagId) => !track?.tagIds.includes(tagId));
}

function hasRating(track: TrackData | undefined): boolean {
  return (track?.rating || 0) > 0;
}

function hasEnergy(track: TrackData | undefined): boolean {
  return (track?.energy || 0) > 0;
}

export function previewPlaylistTrackApply(
  trackUris: string[],
  tracks: Record<string, TrackData>,
  values: PlaylistTrackApplyValues,
): PlaylistTrackApplyPreview {
  const uniqueTrackUris = Array.from(new Set(trackUris));

  return {
    trackCount: uniqueTrackUris.length,
    tagTrackCount:
      values.tagIds.length > 0
        ? uniqueTrackUris.filter(
            (trackUri) => getMissingTagIds(tracks[trackUri], values.tagIds).length > 0,
          ).length
        : 0,
    ratingTrackCount:
      values.rating > 0
        ? uniqueTrackUris.filter((trackUri) => !hasRating(tracks[trackUri])).length
        : 0,
    energyTrackCount:
      values.energy > 0
        ? uniqueTrackUris.filter((trackUri) => !hasEnergy(tracks[trackUri])).length
        : 0,
  };
}

/**
 * Tags are added to every track. Rating and energy only fill in tracks that do
 * not have their own, so nothing the user set on a track is replaced. Album
 * details let newly added tracks count toward their album straight away.
 */
export function buildPlaylistTrackApplyUpdates(
  trackUris: string[],
  tracks: Record<string, TrackData>,
  values: PlaylistTrackApplyValues,
  choices: PlaylistTrackApplyChoices,
  albumDetails?: BatchTrackAlbumDetails,
): BatchTagUpdate[] {
  return Array.from(new Set(trackUris)).flatMap((trackUri) => {
    const track = tracks[trackUri];
    const toAdd = choices.tags ? getMissingTagIds(track, values.tagIds) : [];
    const shouldSetRating = choices.rating && values.rating > 0 && !hasRating(track);
    const shouldSetEnergy = choices.energy && values.energy > 0 && !hasEnergy(track);

    if (toAdd.length === 0 && !shouldSetRating && !shouldSetEnergy) {
      return [];
    }

    return [
      {
        trackUri,
        toAdd,
        toRemove: [],
        ...(shouldSetRating ? { newRating: values.rating } : {}),
        ...(shouldSetEnergy ? { newEnergy: values.energy } : {}),
        ...(albumDetails ? { albumDetails } : {}),
      },
    ];
  });
}
