import {
  SmartPlaylistCriteria,
  SmartPlaylistFilterCriteria,
} from "@/features/smart-playlists/model/smartPlaylist.types";
import { TagDataStructure } from "@/types/tagData";
import { evaluateTrackMatchesCriteria } from "./smartPlaylist.criteria";

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

export function calculatePlaylistTrackDelta(
  currentTrackUris: string[],
  matchingTrackUris: string[],
): {
  tracksToAdd: string[];
  tracksToRemove: string[];
} {
  const tracksToAdd = matchingTrackUris.filter(
    (uri) => !currentTrackUris.includes(uri),
  );
  const tracksToRemove = currentTrackUris.filter(
    (uri) => !matchingTrackUris.includes(uri),
  );

  return {
    tracksToAdd,
    tracksToRemove,
  };
}

export function withUpdatedPlaylistTrackUris(
  playlists: SmartPlaylistCriteria[],
  playlistId: string,
  smartPlaylistTrackUris: string[],
): SmartPlaylistCriteria[] {
  return playlists.map((playlist) =>
    playlist.playlistId === playlistId
      ? {
          ...playlist,
          smartPlaylistTrackUris,
          lastSyncAt: Date.now(),
        }
      : playlist,
  );
}
