import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { normalizeSmartPlaylistCriteriaList } from "@/features/tag-data";

export const SMART_PLAYLIST_STORAGE_KEY = "tagify:smartPlaylists";

export function loadSmartPlaylistsFromStorage(): SmartPlaylistCriteria[] {
  try {
    const raw = localStorage.getItem(SMART_PLAYLIST_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeSmartPlaylistCriteriaList(parsed);
  } catch {
    return [];
  }
}

export function saveSmartPlaylistsToStorage(
  playlists: SmartPlaylistCriteria[],
): void {
  localStorage.setItem(SMART_PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
}
