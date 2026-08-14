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

  updates.forEach(({ trackUri, toAdd, toRemove, newRating, newEnergy }) => {
    if (!nextData.tracks[trackUri]) {
      nextData.tracks[trackUri] = {
        rating: 0,
        energy: 0,
        bpm: null,
        tagIds: [],
        dateCreated: now,
        dateModified: now,
      };
    }

    let trackTags = [...(nextData.tracks[trackUri].tagIds || [])];

    toRemove.forEach((tagToRemove) => {
      trackTags = trackTags.filter((tag) => !isSameTrackTag(tag, tagToRemove));
    });

    toAdd.forEach((tagToAdd) => {
      const exists = trackTags.some((tag) => isSameTrackTag(tag, tagToAdd));
      if (!exists) {
        trackTags.push(tagToAdd);
      }
    });

    const updatedTrackData: TrackData = {
      ...nextData.tracks[trackUri],
      tagIds: trackTags,
      rating: newRating !== undefined ? newRating : nextData.tracks[trackUri].rating,
      energy: newEnergy !== undefined ? newEnergy : nextData.tracks[trackUri].energy,
      dateModified: now,
      dateCreated: nextData.tracks[trackUri].dateCreated || now,
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
