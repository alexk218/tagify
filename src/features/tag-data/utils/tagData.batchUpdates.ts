import { BatchTagUpdate, TagDataStructure, TrackData } from "@/types/tagData";
import { isSameTrackTag, isTrackEmpty } from "./tagData.helpers";

export interface BatchTagUpdateResult {
  nextData: TagDataStructure;
  finalTrackDataMap: Record<string, TrackData | null>;
}

export function applyBatchTagUpdatesToData(
  currentData: TagDataStructure,
  updates: BatchTagUpdate[],
  now: number,
): BatchTagUpdateResult {
  const finalTrackDataMap: Record<string, TrackData | null> = {};

  const nextData: TagDataStructure = {
    ...currentData,
    tracks: { ...currentData.tracks },
  };

  updates.forEach(({ trackUri, toAdd, toRemove, newRating, newEnergy, albumDetails }) => {
    const existingTrack: TrackData = nextData.tracks[trackUri] || {
      rating: 0,
      energy: 0,
      bpm: null,
      tagIds: [],
      dateCreated: now,
      dateModified: now,
    };
    const existingTags = existingTrack.tagIds || [];
    let trackTags = [...existingTags];

    toRemove.forEach((tagToRemove) => {
      trackTags = trackTags.filter((tag) => !isSameTrackTag(tag, tagToRemove));
    });

    toAdd.forEach((tagToAdd) => {
      const exists = trackTags.some((tag) => isSameTrackTag(tag, tagToAdd));
      if (!exists) {
        trackTags.push(tagToAdd);
      }
    });

    const rating = newRating !== undefined ? newRating : existingTrack.rating;
    const energy = newEnergy !== undefined ? newEnergy : existingTrack.energy;
    const tagsChanged =
      trackTags.length !== existingTags.length ||
      trackTags.some((tag, index) => !isSameTrackTag(tag, existingTags[index]));

    // An update that changes nothing must not move the track in Last Updated order.
    if (!tagsChanged && rating === existingTrack.rating && energy === existingTrack.energy) {
      return;
    }

    // Details only describe tracks that are not already linked to another album.
    const sameAlbumDetails =
      albumDetails &&
      (!existingTrack.albumUri || existingTrack.albumUri === albumDetails.albumUri)
        ? albumDetails
        : undefined;
    const updatedTrackData: TrackData = {
      ...existingTrack,
      ...(sameAlbumDetails?.albumUri && !existingTrack.albumUri
        ? { albumUri: sameAlbumDetails.albumUri }
        : {}),
      ...(sameAlbumDetails?.albumName && !existingTrack.albumName
        ? { albumName: sameAlbumDetails.albumName }
        : {}),
      ...(sameAlbumDetails?.albumImageUrl && !existingTrack.albumImageUrl
        ? { albumImageUrl: sameAlbumDetails.albumImageUrl }
        : {}),
      tagIds: trackTags,
      rating,
      energy,
      dateModified: now,
      dateCreated: existingTrack.dateCreated || now,
    };

    nextData.tracks[trackUri] = updatedTrackData;

    if (isTrackEmpty(updatedTrackData)) {
      delete nextData.tracks[trackUri];
      finalTrackDataMap[trackUri] = null;
    } else {
      finalTrackDataMap[trackUri] = updatedTrackData;
    }
  });

  return { nextData, finalTrackDataMap };
}
