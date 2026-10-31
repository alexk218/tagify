import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { searchSpotifyTracks } from "@/services/SpotifyTrackSearch";
import {
  NOW_PLAYING_LOOKUP_FEATURE, NOW_PLAYING_LOOKUP_HOURLY_SEARCHES, NOW_PLAYING_LOOKUP_SEARCH_INTERVAL_MS,
  withinLookupDailyCap, type NowPlayingLookupSources,
} from "./CommunityNowPlayingLookups";

/**
 * Spotify's in-app song search for Now playing lookups: GraphQL `searchTracks` through the shared
 * wrapper at background priority (no search while Spotify asks Tagify to wait; a 429 sets that
 * pause), never the Web API, under the lane's own reservations (`community-now-playing-lookups`,
 * apart from the catalog filler's) and its daily cap on this computer.
 */
export function communityNowPlayingLookupSources(): NowPlayingLookupSources {
  return {
    search: (term) => searchSpotifyTracks(term, { priority: "background" }),
    reserve: withinLookupDailyCap((identity) =>
      spotifyBackgroundPolicy.reserve(NOW_PLAYING_LOOKUP_FEATURE, identity, NOW_PLAYING_LOOKUP_HOURLY_SEARCHES)),
    pausedUntil: () => spotifyBackgroundPolicy.retryAt(),
    pace: () => new Promise<void>((resolve) => setTimeout(resolve, NOW_PLAYING_LOOKUP_SEARCH_INTERVAL_MS)),
  };
}
