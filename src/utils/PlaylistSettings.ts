// Define the settings structure
export interface PlaylistSettings {
  // Ownership filters
  excludeNonOwnedPlaylists: boolean;

  // Keyword-based exclusions for playlist names
  excludedKeywords: string[];

  // Specific playlist exclusions
  excludedPlaylistIds: string[];

  // Description-based exclusions
  excludeByDescription: string[];
}

// Storage key for settings
const SETTINGS_KEY = "tagify:playlistSettings";

// Default settings
const DEFAULT_SETTINGS: PlaylistSettings = {
  excludeNonOwnedPlaylists: true,
  excludedKeywords: ["Daylist", "Unchartify", "Discover Weekly", "Release Radar"],
  excludedPlaylistIds: [],
  excludeByDescription: ["ignore"],
};

// Get settings from localStorage
export function getPlaylistSettings(): PlaylistSettings {
  try {
    const settingsString = localStorage.getItem(SETTINGS_KEY);
    if (settingsString) {
      return JSON.parse(settingsString);
    }
  } catch (error) {
    console.error("Tagify: Error reading playlist settings:", error);
  }

  // Return default settings if not found or error
  return DEFAULT_SETTINGS;
}

// Save settings to localStorage
export function savePlaylistSettings(settings: PlaylistSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    console.log("Tagify: Saved playlist settings");
  } catch (error) {
    console.error("Tagify: Error saving playlist settings:", error);
  }
}

// Helper function to check if a playlist should be excluded
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
    settings.excludedKeywords.some((keyword) =>
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

  if (playlistName === "TAGGED") {
    return true;
  }

  return false;
}

// Add a specific playlist to exclusions
export function addExcludedPlaylist(playlistId: string): void {
  const settings = getPlaylistSettings();
  if (!settings.excludedPlaylistIds.includes(playlistId)) {
    settings.excludedPlaylistIds.push(playlistId);
    savePlaylistSettings(settings);
  }
}

// Remove a specific playlist from exclusions
export function removeExcludedPlaylist(playlistId: string): void {
  const settings = getPlaylistSettings();
  settings.excludedPlaylistIds = settings.excludedPlaylistIds.filter((id) => id !== playlistId);
  savePlaylistSettings(settings);
}

// Helper to reset all settings to default
export function resetToDefaultSettings(): void {
  savePlaylistSettings(DEFAULT_SETTINGS);
}
