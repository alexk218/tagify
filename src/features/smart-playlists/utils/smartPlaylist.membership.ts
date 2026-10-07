import type { SmartPlaylistCriteria } from "../model/smartPlaylist.types";

/** Membership belongs to this device's Spotify observations, not the cloud definition. */
export function preserveSmartPlaylistMembership(
  incoming: SmartPlaylistCriteria[],
  previous: SmartPlaylistCriteria[],
): SmartPlaylistCriteria[] {
  return incoming.map((playlist) => {
    const existing = previous.find((candidate) => candidate.id === playlist.id &&
      candidate.playlistId === playlist.playlistId && candidate.createdAt === playlist.createdAt);
    return existing ? {
      ...playlist,
      smartPlaylistTrackUris: existing.smartPlaylistTrackUris,
      lastSyncAt: existing.lastSyncAt,
      pendingTagChoices: [...new Set([...(playlist.pendingTagChoices ?? []), ...(existing.pendingTagChoices ?? [])])],
    } : playlist;
  });
}
