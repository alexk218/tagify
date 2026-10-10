import { normalizeSmartPlaylistCriteriaList } from "@/features/tag-data";
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
  options: { keepSavedMembership?: boolean } = {},
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
      lastSyncAt: options.keepSavedMembership && exactId ? playlist.lastSyncAt : 0,
      smartPlaylistTrackUris: options.keepSavedMembership && exactId ? playlist.smartPlaylistTrackUris : [],
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
  const importedConnections = new Set(imported.map((playlist) => playlist.playlistId).filter(Boolean));
  const seenIdentities = new Set<string>();
  const seenConnections = new Set<string>();
  const uniqueImported = [...imported].reverse().filter((playlist) => {
    const key = identity(playlist);
    if ((key && seenIdentities.has(key)) || (playlist.playlistId && seenConnections.has(playlist.playlistId))) return false;
    if (key) seenIdentities.add(key);
    if (playlist.playlistId) seenConnections.add(playlist.playlistId);
    return true;
  }).reverse();
  return [
    ...current.filter((playlist) => {
      const key = identity(playlist);
      return (key === null || !importedIdentities.has(key)) && !importedConnections.has(playlist.playlistId);
    }),
    ...uniqueImported,
  ];
}

/** Personal backups retain Spotify connections; shared files deliberately do not. */
export function parsePersonalSmartPlaylistBackup(value: unknown): SmartPlaylistCriteria[] | null {
  const candidate = Array.isArray(value) ? value : value && typeof value === "object" &&
    "format" in value && value.format === "tagify-smart-playlist-backup" ? value : null;
  if (!candidate) return null;
  if (!Array.isArray(candidate) && (!("version" in candidate) || candidate.version !== 1)) {
    throw new Error("This backup needs a newer Tagify. Update Tagify, then try again.");
  }
  const items = Array.isArray(candidate) ? candidate : "playlists" in candidate ? candidate.playlists : null;
  if (!Array.isArray(items) || !items.length || items.some((item) => !item || typeof item !== "object" || !item.criteria || typeof item.criteria !== "object" || Array.isArray(item.criteria))) {
    throw new Error("This file does not contain complete Smart Playlists. Choose the original backup file.");
  }
  for (const item of items) {
    const criteria = item.criteria;
    const arrayFields = ["includeTagClauses", "includeTagGroups", "activeTagFilters", "excludedTagFilters", "clauseConnectors", "ratingFilters", "camelotKeyFilters"];
    const numberFields = ["energyMinFilter", "energyMaxFilter", "bpmMinFilter", "bpmMaxFilter"];
    if (arrayFields.some((field) => criteria[field] !== undefined && !Array.isArray(criteria[field])) ||
        numberFields.some((field) => criteria[field] !== undefined && criteria[field] !== null && !Number.isFinite(criteria[field])) ||
        criteria.includeTagClauses?.some((clause: unknown) => !clause || typeof clause !== "object" ||
          !("tagIds" in clause) || !Array.isArray(clause.tagIds) ||
          !("excludedTagIds" in clause) || !Array.isArray(clause.excludedTagIds) ||
          !("operator" in clause) || !["AND", "OR"].includes(String(clause.operator)))) {
      throw new Error("Some playlist filters could not be read. Choose the original backup file.");
    }
  }
  const normalized = normalizeSmartPlaylistCriteriaList(items);
  if (normalized.length !== items.length) throw new Error("Some Smart Playlists could not be read. Choose the original backup file.");
  return normalized;
}

export function downloadPersonalSmartPlaylistBackup(playlists: SmartPlaylistCriteria[]): void {
  const blob = new Blob([JSON.stringify({ format: "tagify-smart-playlist-backup", version: 1,
    exportedAt: new Date().toISOString(), playlists }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tagify-smart-playlists-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
