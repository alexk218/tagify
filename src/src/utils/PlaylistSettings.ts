export interface PlaylistSettings {
  excludeNonOwnedPlaylists: boolean;
  excludedPlaylistKeywords: string[];
  excludedPlaylistIds: string[];
  excludeByDescription: string[];
}

const SETTINGS_KEY = "tagify:playlistSettings";

const DEFAULT_SETTINGS: PlaylistSettings = {
  excludeNonOwnedPlaylists: true,
  excludedPlaylistKeywords: ["Daylist", "Discover Weekly", "Release Radar"],
  excludedPlaylistIds: [],
  excludeByDescription: ["ignore"],
};

export function getPlaylistSettings(): PlaylistSettings {
  try {
    const settingsString = localStorage.getItem(SETTINGS_KEY);
    if (settingsString) {
      return JSON.parse(settingsString);
    }
  } catch (error) {
    console.error("Tagify: Error reading playlist settings:", error);
  }

  return DEFAULT_SETTINGS;
}

export function savePlaylistSettings(settings: PlaylistSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Tagify: Error saving playlist settings:", error);
  }
}

export function shouldExcludePlaylist(
  playlistId: string,
  playlistName: string,
  playlistOwner: string,
  playlistDescription: string,
  currentUserId: string
): boolean {
  const settings = getPlaylistSettings();

  // Check ownership filter
  if (settings.excludeNonOwnedPlaylists && playlistOwner !== currentUserId) {
    return true;
  }

  // Check specific excluded playlists
  if (settings.excludedPlaylistIds.includes(playlistId)) {
    return true;
  }

  // Check for excluded keywords in name
  if (
    settings.excludedPlaylistKeywords.some((keyword) =>
      playlistName.toLowerCase().includes(keyword.toLowerCase())
    )
  ) {
    return true;
  }

  // Check for description exclusions
  if (
    settings.excludeByDescription.some(
      (term) =>
        playlistDescription && playlistDescription.toLowerCase().includes(term.toLowerCase())
    )
  ) {
    return true;
  }

  return false;
}

export function resetToDefaultSettings(): void {
  savePlaylistSettings(DEFAULT_SETTINGS);
}
