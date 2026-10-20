import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { storageService } from "@/services/storage/StorageService";
import { SONG_RELEASE_FEATURE, SONG_RELEASE_HOURLY_READS, type SongReleaseSources } from "./CommunitySongReleases";

const READ_INTERVAL_MS = 1_000;

/**
 * Spotify's desktop app as the source of songs' ISRCs and releases: the desktop metadata read
 * (spclient) and GraphQL getAlbum only, paced in the background, never the Web API.
 */
export function communitySongReleaseSources(): SongReleaseSources {
  return {
    async knownSongs(uris) {
      const tracks = await storageService.getTracks(uris);
      return new Map([...tracks].map(([uri, track]) => [uri, { isrc: track.recordingIdentity?.isrc ?? null, albumUri: track.albumUri ?? null }] as const));
    },
    trackRelease: (uri) => spotifyApiService.getTrackRelease(uri, { priority: "background", feature: "recording-matching" }),
    albumRelease: (albumUri) => spotifyApiService.getAlbumRelease(albumUri, { priority: "background", feature: "metadata-backfill" }),
    reserve: (identity) => spotifyBackgroundPolicy.reserve(SONG_RELEASE_FEATURE, identity, SONG_RELEASE_HOURLY_READS),
    pace: () => new Promise((resolve) => setTimeout(resolve, READ_INTERVAL_MS)),
  };
}
