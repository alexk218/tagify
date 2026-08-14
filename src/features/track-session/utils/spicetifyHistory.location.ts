import { SpicetifyHistoryLocation } from "@/types/SpotifyTypes";

export interface ParsedHistoryTrackSelection {
  trackUri: string | null;
  trackUris: string[] | null;
  playlistUri: string | null;
  artistUri: string | null;
}

function readTrackUriFromSearch(location: SpicetifyHistoryLocation): string | null {
  const historyParams = new URLSearchParams(location.search || "");
  if (historyParams.has("uri")) {
    return historyParams.get("uri");
  }

  return null;
}

function readPlaylistUriFromSearch(
  location: SpicetifyHistoryLocation,
): string | null {
  const historyParams = new URLSearchParams(location.search || "");
  if (historyParams.has("playlistUri")) {
    return historyParams.get("playlistUri");
  }

  return null;
}

function readArtistUriFromSearch(
  location: SpicetifyHistoryLocation,
): string | null {
  const historyParams = new URLSearchParams(location.search || "");
  if (historyParams.has("artistUri")) {
    return historyParams.get("artistUri");
  }

  return null;
}

function readTrackUrisFromState(
  location: SpicetifyHistoryLocation,
): string[] | null {
  if (!Array.isArray(location.state?.trackUris)) {
    return null;
  }

  const validTrackUris = location.state.trackUris.filter(
    (uri): uri is string => typeof uri === "string" && uri.length > 0,
  );

  return validTrackUris.length > 0 ? validTrackUris : null;
}

export function parseHistoryTrackSelection(
  location: SpicetifyHistoryLocation | null | undefined,
): ParsedHistoryTrackSelection {
  if (!location) {
    return {
      trackUri: null,
      trackUris: null,
      playlistUri: null,
      artistUri: null,
    };
  }

  const trackUriFromSearch = readTrackUriFromSearch(location);
  const trackUri =
    trackUriFromSearch ||
    (typeof location.state?.trackUri === "string" ? location.state.trackUri : null);

  return {
    trackUri,
    trackUris: readTrackUrisFromState(location),
    playlistUri:
      readPlaylistUriFromSearch(location) ||
      (typeof location.state?.playlistUri === "string"
        ? location.state.playlistUri
        : null),
    artistUri:
      readArtistUriFromSearch(location) ||
      (typeof location.state?.artistUri === "string"
        ? location.state.artistUri
        : null),
  };
}
