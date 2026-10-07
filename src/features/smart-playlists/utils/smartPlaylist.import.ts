import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";

export interface SpotifyPlaylistReference {
  playlistId: string;
  playlistName: string;
}

export interface PreparedSmartPlaylistImport {
  playlists: SmartPlaylistCriteria[];
  relinkedCount: number;
  unresolvedCount: number;
}

export interface SmartPlaylistImportSummary {
  importedCount: number;
  skippedCount?: number;
  relinkedCount: number;
  unresolvedCount: number;
  verificationUnavailable: boolean;
  recipeImport?: boolean;
  createdTagCount?: number;
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function prepareSmartPlaylistImport(
  imported: SmartPlaylistCriteria[],
  currentSpotifyPlaylists: SpotifyPlaylistReference[],
): PreparedSmartPlaylistImport {
  const byId = new Map(
    currentSpotifyPlaylists.map((playlist) => [playlist.playlistId, playlist]),
  );
  const byName = new Map<string, SpotifyPlaylistReference[]>();
  currentSpotifyPlaylists.forEach((playlist) => {
    const name = normalizedName(playlist.playlistName);
    byName.set(name, [...(byName.get(name) ?? []), playlist]);
  });

  let relinkedCount = 0;
  let unresolvedCount = 0;
  const playlists = imported.map((playlist) => {
    const exactId = byId.get(playlist.playlistId);
    const sameName = byName.get(normalizedName(playlist.playlistName)) ?? [];
    const replacement = exactId ?? (sameName.length === 1 ? sameName[0] : null);

    if (!replacement) {
      unresolvedCount += 1;
      return {
        ...playlist,
        playlistId: "",
        isActive: false,
        lastSyncAt: 0,
        smartPlaylistTrackUris: [],
      };
    }

    if (replacement.playlistId !== playlist.playlistId) {
      relinkedCount += 1;
    }
    return {
      ...playlist,
      playlistId: replacement.playlistId,
      playlistName: replacement.playlistName,
      lastSyncAt: 0,
      smartPlaylistTrackUris: [],
    };
  });

  return { playlists, relinkedCount, unresolvedCount };
}

/**
 * Adds imported Smart Playlists to the existing ones. An imported rule replaces
 * the existing rule with the same identity; rules missing from the file stay.
 */
export function mergeImportedSmartPlaylists(
  current: SmartPlaylistCriteria[],
  imported: SmartPlaylistCriteria[],
): SmartPlaylistCriteria[] {
  const identity = (playlist: SmartPlaylistCriteria) =>
    playlist.id ? `id:${playlist.id}` : playlist.playlistId ? `playlist:${playlist.playlistId}` : null;
  const importedIdentities = new Set(imported.map(identity).filter((key): key is string => key !== null));
  return [
    ...current.filter((playlist) => {
      const key = identity(playlist);
      return key === null || !importedIdentities.has(key);
    }),
    ...imported,
  ];
}
