import { TrackInfo } from "@/services/SpotifyService";
import { SpotifyTrack } from "@/types/SpotifyTypes";
import { parseLocalFileUri } from "@/utils/LocalFileParser";

interface SpicetifyPlayerItem {
  uri?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
  duration?: number | { milliseconds?: number };
}

function resolveDurationMs(duration: SpicetifyPlayerItem["duration"]): number {
  if (typeof duration === "number") {
    return duration;
  }

  if (
    typeof duration === "object" &&
    duration !== null &&
    typeof duration.milliseconds === "number"
  ) {
    return duration.milliseconds;
  }

  return 0;
}

export function createLocalSpotifyTrack(uri: string): SpotifyTrack {
  const parsedFile = parseLocalFileUri(uri);

  return {
    uri,
    name: parsedFile.title,
    artists: [{ name: parsedFile.artist }],
    album: { name: parsedFile.album },
    duration_ms: 0,
  };
}

export function createSpotifyTrackFromTrackInfo(
  uri: string,
  trackInfo: TrackInfo,
): SpotifyTrack {
  return {
    uri,
    name: trackInfo.name,
    artists: trackInfo.artistsData.map((artist) => ({ name: artist.name })),
    album: { name: trackInfo.albumName },
    duration_ms: trackInfo.duration_ms,
  };
}

export function createSpotifyTrackFromPlayerItem(
  item: SpicetifyPlayerItem | null | undefined,
): SpotifyTrack | null {
  if (!item?.uri) {
    return null;
  }

  return {
    uri: item.uri,
    name: item.name || "Unknown Track",
    artists:
      item.artists && item.artists.length > 0
        ? item.artists.map((artist) => ({ name: artist?.name || "Unknown Artist" }))
        : [{ name: "Unknown Artist" }],
    album: { name: item.album?.name || "Unknown Album" },
    duration_ms: resolveDurationMs(item.duration),
  };
}

export function createLoadingSpotifyTrack(uri: string): SpotifyTrack {
  return {
    uri,
    name: "Loading...",
    artists: [{ name: "Loading..." }],
    album: { name: "Loading..." },
    duration_ms: 0,
  };
}

export function createFailedSpotifyTrack(uri: string): SpotifyTrack {
  return {
    uri,
    name: "Failed to load",
    artists: [{ name: "Error" }],
    album: { name: "Error" },
    duration_ms: 0,
  };
}
