import {
  ArtistData,
  TagDataStructure,
  TagTaxonomy,
  PlaylistData,
  TrackData,
  TrackTag,
} from "@/types/tagData";
import { normalizeCamelotKey } from "@/utils/camelotKey";

export function areTrackDataEqual(
  currentTrack: TrackData,
  incomingTrack: TrackData,
): boolean {
  if (
    currentTrack.rating !== incomingTrack.rating ||
    currentTrack.energy !== incomingTrack.energy ||
    currentTrack.bpm !== incomingTrack.bpm ||
    normalizeCamelotKey(currentTrack.camelotKey) !==
      normalizeCamelotKey(incomingTrack.camelotKey) ||
    currentTrack.dateCreated !== incomingTrack.dateCreated ||
    currentTrack.dateModified !== incomingTrack.dateModified ||
    currentTrack.name !== incomingTrack.name ||
    currentTrack.artists !== incomingTrack.artists ||
    currentTrack.backfillAttempts !== incomingTrack.backfillAttempts ||
    currentTrack.tagIds.length !== incomingTrack.tagIds.length
  ) {
    return false;
  }

  for (let index = 0; index < currentTrack.tagIds.length; index += 1) {
    if (currentTrack.tagIds[index] !== incomingTrack.tagIds[index]) {
      return false;
    }
  }

  return true;
}

export function isTrackEmpty(trackData: TrackData): boolean {
  return (
    trackData.rating === 0 &&
    trackData.energy === 0 &&
    trackData.tagIds.length === 0
  );
}

export function isPlaylistEmpty(playlistData: PlaylistData): boolean {
  return (
    playlistData.rating === 0 &&
    playlistData.energy === 0 &&
    playlistData.tagIds.length === 0
  );
}

export function isArtistEmpty(artistData: ArtistData): boolean {
  return (
    artistData.rating === 0 &&
    artistData.energy === 0 &&
    artistData.tagIds.length === 0
  );
}

export function isSameTrackTag(left: TrackTag, right: TrackTag): boolean {
  return left === right;
}

export function keepTracksWithValidTags(
  tracks: TagDataStructure["tracks"],
  validTagIds: Set<string>,
): Record<string, TrackData> {
  const updatedTracks: Record<string, TrackData> = {};

  Object.entries(tracks).forEach(([uri, trackData]) => {
    const validTags = trackData.tagIds.filter((tagId) => validTagIds.has(tagId));

    const updatedTrackData: TrackData = {
      ...trackData,
      tagIds: validTags,
    };

    if (!isTrackEmpty(updatedTrackData)) {
      updatedTracks[uri] = updatedTrackData;
    }
  });

  return updatedTracks;
}

export function keepPlaylistsWithValidTags(
  playlists: TagDataStructure["playlists"],
  validTagIds: Set<string>,
): Record<string, PlaylistData> {
  const updatedPlaylists: Record<string, PlaylistData> = {};

  Object.entries(playlists).forEach(([uri, playlistData]) => {
    const validTags = playlistData.tagIds.filter((tagId) =>
      validTagIds.has(tagId),
    );

    const updatedPlaylistData: PlaylistData = {
      ...playlistData,
      tagIds: validTags,
    };

    if (!isPlaylistEmpty(updatedPlaylistData)) {
      updatedPlaylists[uri] = updatedPlaylistData;
    }
  });

  return updatedPlaylists;
}

export function keepArtistsWithValidTags(
  artists: TagDataStructure["artists"],
  validTagIds: Set<string>,
): Record<string, ArtistData> {
  const updatedArtists: Record<string, ArtistData> = {};

  Object.entries(artists).forEach(([uri, artistData]) => {
    const validTags = artistData.tagIds.filter((tagId) => validTagIds.has(tagId));

    const updatedArtistData: ArtistData = {
      ...artistData,
      tagIds: validTags,
    };

    if (!isArtistEmpty(updatedArtistData)) {
      updatedArtists[uri] = updatedArtistData;
    }
  });

  return updatedArtists;
}

export function findTagNameInTaxonomy(
  taxonomy: TagTaxonomy,
  tagId: string,
): string {
  return taxonomy.tagsById[tagId]?.name || "";
}
