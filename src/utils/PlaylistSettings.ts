import { normalizeSpotifyUserIdentity } from "./SpotifyUserIdentity";

export type PlaylistOverrideMode = "inherit" | "include" | "exclude";
export type PlaylistSelectionMode = "rules" | "tree";

export interface PlaylistSettings {
  selectionMode: PlaylistSelectionMode;
  excludeNonOwnedPlaylists: boolean;
  excludedPlaylistKeywords: string[];
  excludedPlaylistIds: string[];
  excludeByDescription: string[];
  playlistOverrides: Record<string, PlaylistOverrideMode>;
}

export interface PlaylistDecisionOptions {
  playlistId: string;
  playlistName: string;
  playlistOwnerId?: string | null;
  playlistDescription?: string | null;
  currentUserId?: string | null;
  settings?: PlaylistSettings;
}

export interface PlaylistDecision {
  included: boolean;
  overrideMode: PlaylistOverrideMode;
  reason: string;
  matchedRule:
    | "override"
    | "owner"
    | "id"
    | "keyword"
    | "description"
    | null;
}

const SETTINGS_KEY = "tagify:playlistSettings";

const DEFAULT_SETTINGS: PlaylistSettings = {
  selectionMode: "rules",
  excludeNonOwnedPlaylists: true,
  excludedPlaylistKeywords: ["Daylist", "Discover Weekly", "Release Radar"],
  excludedPlaylistIds: [],
  excludeByDescription: ["ignore"],
  playlistOverrides: {},
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  value.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }

    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
}

function normalizePlaylistOverrides(
  value: unknown
): Record<string, PlaylistOverrideMode> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, PlaylistOverrideMode> = {};
  Object.entries(value as Record<string, unknown>).forEach(([playlistId, mode]) => {
    if (!playlistId) {
      return;
    }

    if (mode === "inherit" || mode === "include" || mode === "exclude") {
      normalized[playlistId] = mode;
    }
  });

  return normalized;
}

export function normalizePlaylistSettings(rawValue: unknown): PlaylistSettings {
  const raw = rawValue && typeof rawValue === "object" ? rawValue : {};

  return {
    selectionMode:
      (raw as PlaylistSettings).selectionMode === "tree"
        ? "tree"
        : DEFAULT_SETTINGS.selectionMode,
    excludeNonOwnedPlaylists:
      typeof (raw as PlaylistSettings).excludeNonOwnedPlaylists === "boolean"
        ? (raw as PlaylistSettings).excludeNonOwnedPlaylists
        : DEFAULT_SETTINGS.excludeNonOwnedPlaylists,
    excludedPlaylistKeywords: normalizeStringArray(
      (raw as PlaylistSettings).excludedPlaylistKeywords
    ),
    excludedPlaylistIds: normalizeStringArray(
      (raw as PlaylistSettings).excludedPlaylistIds
    ),
    excludeByDescription: normalizeStringArray(
      (raw as PlaylistSettings).excludeByDescription
    ),
    playlistOverrides: normalizePlaylistOverrides(
      (raw as PlaylistSettings).playlistOverrides
    ),
  };
}

export function getDefaultPlaylistSettings(): PlaylistSettings {
  return { ...DEFAULT_SETTINGS, playlistOverrides: {} };
}

export function getPlaylistSettings(): PlaylistSettings {
  try {
    const settingsString = localStorage.getItem(SETTINGS_KEY);
    if (settingsString) {
      return normalizePlaylistSettings(JSON.parse(settingsString));
    }
  } catch (error) {
    console.error("Tagify: Error reading playlist settings:", error);
  }

  return getDefaultPlaylistSettings();
}

export function savePlaylistSettings(settings: PlaylistSettings): void {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify(normalizePlaylistSettings(settings))
    );
  } catch (error) {
    console.error("Tagify: Error saving playlist settings:", error);
  }
}

export function getPlaylistOverrideMode(
  playlistId: string,
  settings: PlaylistSettings = getPlaylistSettings()
): PlaylistOverrideMode {
  return settings.playlistOverrides[playlistId] || "inherit";
}

export function getPlaylistDecision({
  playlistId,
  playlistName,
  playlistOwnerId,
  playlistDescription,
  currentUserId,
  settings = getPlaylistSettings(),
}: PlaylistDecisionOptions): PlaylistDecision {
  const overrideMode = getPlaylistOverrideMode(playlistId, settings);
  const selectionMode = settings.selectionMode || DEFAULT_SETTINGS.selectionMode;
  const normalizedPlaylistOwnerId = normalizeSpotifyUserIdentity(playlistOwnerId);
  const normalizedCurrentUserId = normalizeSpotifyUserIdentity(currentUserId);
  const matchedKeyword = (settings.excludedPlaylistKeywords || []).find((keyword) =>
    playlistName.toLowerCase().includes(keyword.toLowerCase())
  );
  const description = playlistDescription || "";
  const matchedDescriptionTerm = (settings.excludeByDescription || []).find((term) =>
    description.toLowerCase().includes(term.toLowerCase())
  );

  if (selectionMode === "tree") {
    if (overrideMode === "include") {
      return {
        included: true,
        overrideMode,
        reason: "Included manually from the Spotify Tree",
        matchedRule: "override",
      };
    }

    if (overrideMode === "exclude") {
      return {
        included: false,
        overrideMode,
        reason: "Excluded manually from the Spotify Tree",
        matchedRule: "override",
      };
    }
  }

  if (
    settings.excludeNonOwnedPlaylists &&
    normalizedPlaylistOwnerId &&
    normalizedCurrentUserId &&
    normalizedPlaylistOwnerId !== normalizedCurrentUserId
  ) {
    return {
      included: false,
      overrideMode,
      reason: "Excluded because it is not owned by you",
      matchedRule: "owner",
    };
  }

  if ((settings.excludedPlaylistIds || []).includes(playlistId)) {
    return {
      included: false,
      overrideMode,
      reason: "Excluded by playlist ID rule",
      matchedRule: "id",
    };
  }

  if (matchedKeyword) {
    return {
      included: false,
      overrideMode,
      reason: `Excluded because the name matches "${matchedKeyword}"`,
      matchedRule: "keyword",
    };
  }

  if (matchedDescriptionTerm) {
    return {
      included: false,
      overrideMode,
      reason: `Excluded because the description matches "${matchedDescriptionTerm}"`,
      matchedRule: "description",
    };
  }

  return {
    included: true,
    overrideMode: "inherit",
    reason:
      selectionMode === "tree"
        ? "Included by the Spotify Tree"
        : "Included by the current source-playlist rules",
    matchedRule: null,
  };
}

export function shouldExcludePlaylist(
  playlistId: string,
  playlistName: string,
  playlistOwner: string,
  playlistDescription: string,
  currentUserId: string
): boolean {
  return !getPlaylistDecision({
    playlistId,
    playlistName,
    playlistOwnerId: playlistOwner,
    playlistDescription,
    currentUserId,
  }).included;
}

export function resetToDefaultSettings(): void {
  savePlaylistSettings(getDefaultPlaylistSettings());
}
