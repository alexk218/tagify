import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { searchSpotifyPage } from "@/services/SpotifyTrackSearch";
import {
  SPOTIFY_SEARCH_LOOKUP_FEATURE, SPOTIFY_SEARCH_LOOKUP_HOURLY_SEARCHES, SPOTIFY_SEARCH_LOOKUP_SEARCH_INTERVAL_MS,
  withinSpotifySearchDailyCap, type SpotifySearchLookupSources,
} from "./CommunitySpotifySearchLookups";

/**
 * Spotify's in-app search for members' Search Spotify: GraphQL through the shared wrapper at
 * background priority (no search while Spotify asks Tagify to wait; a 429 sets that pause), never
 * the Web API, under the lane's own reservations (`community-spotify-search-lookups`) and its daily
 * cap on this computer. Songs (handoff slice 1), albums and artists (slice 2), one page each.
 */
export function communitySpotifySearchLookupSources(): SpotifySearchLookupSources {
  return {
    searches: {
      track: (query) => searchSpotifyPage("track", query, { priority: "background" }),
      album: (query) => searchSpotifyPage("album", query, { priority: "background" }),
      artist: (query) => searchSpotifyPage("artist", query, { priority: "background" }),
    },
    reserve: withinSpotifySearchDailyCap((identity) =>
      spotifyBackgroundPolicy.reserve(SPOTIFY_SEARCH_LOOKUP_FEATURE, identity, SPOTIFY_SEARCH_LOOKUP_HOURLY_SEARCHES)),
    pausedUntil: () => spotifyBackgroundPolicy.retryAt(),
    pace: () => new Promise<void>((resolve) => setTimeout(resolve, SPOTIFY_SEARCH_LOOKUP_SEARCH_INTERVAL_MS)),
  };
}
