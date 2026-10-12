import type { SmartPlaylistCriteria } from "../model/smartPlaylist.types";

/** Membership belongs to this device's Spotify observations, not the cloud definition. */
export function preserveSmartPlaylistMembership(
  incoming: SmartPlaylistCriteria[],
  previous: SmartPlaylistCriteria[],
  options?: { pendingChoices: "current" },
): SmartPlaylistCriteria[] {
  return incoming.map((playlist) => {
    const existing = previous.find((candidate) => candidate.id === playlist.id &&
      candidate.playlistId === playlist.playlistId && candidate.createdAt === playlist.createdAt);
    return existing ? {
      ...playlist,
      smartPlaylistTrackUris: existing.smartPlaylistTrackUris,
      lastSyncAt: existing.lastSyncAt,
      pendingTagChoices: options?.pendingChoices === "current" ? existing.pendingTagChoices ?? []
        : [...new Set([...(playlist.pendingTagChoices ?? []), ...(existing.pendingTagChoices ?? [])])],
    } : playlist;
  });
}

/** A running pass may keep membership progress, but must not use replaced or disabled rules. */
export function sameSmartPlaylistRules(expected: SmartPlaylistCriteria, current: SmartPlaylistCriteria | undefined): boolean {
  return Boolean(current?.isActive && current.id === expected.id && current.playlistId === expected.playlistId &&
    current.createdAt === expected.createdAt && JSON.stringify(current.criteria) === JSON.stringify(expected.criteria));
}
