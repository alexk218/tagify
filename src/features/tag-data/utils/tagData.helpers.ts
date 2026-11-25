import {
  ArtistData,
  TagDataStructure,
  TagTaxonomy,
  PlaylistData,
  TrackData,
  TrackTag,
} from "@/types/tagData";
import { normalizeCamelotKey } from "@/utils/camelotKey";

function isSameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => (left as Record<string, unknown>)[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => (right as Record<string, unknown>)[key] !== undefined);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => isSameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/**
 * Whether two saved copies of a song say the same thing, so the page can skip showing one again.
 * Every field counts (album, length, release dates and song matching included): a change to any of
 * them has to reach the page.
 */
export function areTrackDataEqual(
  currentTrack: TrackData,
  incomingTrack: TrackData,
): boolean {
  if (normalizeCamelotKey(currentTrack.camelotKey) !== normalizeCamelotKey(incomingTrack.camelotKey)) {
    return false;
  }
  return isSameValue(
    { ...currentTrack, camelotKey: undefined },
    { ...incomingTrack, camelotKey: undefined },
  );
}

export function isTrackEmpty(trackData: TrackData): boolean {
  return (
    !trackData.recordingGroupId &&
    !trackData.recordingReuseDisabled &&
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

/**
 * Takes removed tags off the records that have them. Records without those
 * tags are returned as they are, so saving a tag change only rewrites the
 * records it affects. Records left with nothing on them are removed.
 */
export function withoutRemovedTags<T extends { tagIds: string[] }>(
  records: Record<string, T>,
  removedTagIds: Set<string>,
  isEmpty: (record: T) => boolean,
): Record<string, T> {
  if (removedTagIds.size === 0) return records;
  let result = records;
  for (const [uri, record] of Object.entries(records)) {
    if (!record.tagIds.some((tagId) => removedTagIds.has(tagId))) continue;
    if (result === records) result = { ...records };
    const updated = { ...record, tagIds: record.tagIds.filter((tagId) => !removedTagIds.has(tagId)) };
    if (isEmpty(updated)) delete result[uri];
    else result[uri] = updated;
  }
  return result;
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
