import { debugLog } from "@/utils/debug";
import { graphqlRateLimiter } from "@/utils/RateLimiter";

interface GraphQLTrackAlbum {
  uri: string;
  name: string;
  date?: {
    isoString: string;
  };
  coverArt?: {
    sources: Array<{
      url: string;
      width: number;
      height: number;
    }>;
  };
}

interface GraphQLArtistItem {
  uri: string;
  profile?: {
    name: string;
  };
  name?: string;
}

interface GraphQLTrackUnion {
  uri: string;
  name: string;
  duration: {
    totalMilliseconds: number;
  };
  playcount?: string;
  albumOfTrack?: GraphQLTrackAlbum;
  firstArtist?: {
    items: GraphQLArtistItem[];
  };
  otherArtists?: {
    items: GraphQLArtistItem[];
  };
  artists?: {
    items: GraphQLArtistItem[];
  };
}

interface GraphQLTrackResponse {
  data?: {
    trackUnion?: GraphQLTrackUnion;
  };
  errors?: Array<{ message: string }>;
}

// Simplified track info for internal use
export interface TrackInfo {
  name: string;
  artists: string;
  albumName: string;
  albumUri: string | null;
  artistsData: Array<{ name: string; uri: string }>;
  duration_ms: number;
  release_date: string;
}

// Batch track info result
export interface BatchTrackResult {
  [uri: string]: TrackInfo;
}

export interface TrackMetadata {
  releaseDate: string;
  trackLength: string;
  playCount: number | null;
  albumCoverUrl: string | null;
  genres: string[];
}

export interface ContextInfo {
  uri: string;
  name: string;
  type: string;
}


/**
 * SpotifyService - Centralized service for all Spotify API interactions
 * Uses GraphQL and internal APIs instead of CosmosAsync to avoid rate limiting (429 errors)
 */
class SpotifyService {
  private locale: string = "en";
  private getTrackGraphQLCallCount = 0;

  constructor() {
    this.initLocale();
  }

  private initLocale(): void {
    try {
      if (Spicetify?.Locale?.getLocale) {
        this.locale = Spicetify.Locale.getLocale();
      }
    } catch (error) {
      console.warn("SpotifyService: Could not get locale, using default 'en'");
    }
  }

  private async requestTrackGraphQL(
    trackUri: string,
    caller: string,
  ): Promise<GraphQLTrackResponse> {
    this.getTrackGraphQLCallCount += 1;
    debugLog(
      `[API #${this.getTrackGraphQLCallCount}] GraphQL.getTrack (${caller}): ${trackUri}`,
    );

    const { GraphQL, Locale } = Spicetify;

    return GraphQL.Request(GraphQL.Definitions.getTrack, {
      uri: trackUri,
      locale: Locale?.getLocale() || this.locale,
    });
  }

  /**
   * Get track info using GraphQL
   * Replacement for CosmosAsync.get(`https://api.spotify.com/v1/tracks/${trackId}`)
   */
  async getTrack(trackUri: string): Promise<TrackInfo | null> {
    return graphqlRateLimiter.execute(`getTrack:${trackUri}`, async () => {
      try {
        const response = await this.requestTrackGraphQL(
          trackUri,
          "getTrack",
        );

        if (response.errors) {
          console.error("SpotifyService: GraphQL errors:", response.errors);
          return null;
        }

        const trackUnion = response.data?.trackUnion;
        if (!trackUnion) {
          return null;
        }

        return this.parseGraphQLTrack(trackUnion);
      } catch (error) {
        console.error("SpotifyService: Failed to get track:", error);
        throw error; // Re-throw so rate limiter can track errors
      }
    });
  }

  /**
   * Get multiple tracks using GraphQL (batch operation)
   * Replacement for CosmosAsync.get(`https://api.spotify.com/v1/tracks?ids=...`)
   *
   * Note: GraphQL doesn't have a native batch endpoint like the REST API,
   * so we process tracks in parallel with controlled concurrency
   */
  async getBatchTracks(
    trackUris: string[],
    concurrency: number = 5
  ): Promise<BatchTrackResult> {
    const results: BatchTrackResult = {};

    // Filter out local files
    const spotifyUris = trackUris.filter(
      (uri) => !uri.startsWith("spotify:local:")
    );

    // Process in batches with controlled concurrency
    for (let i = 0; i < spotifyUris.length; i += concurrency) {
      const batch = spotifyUris.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map((uri) => this.getTrack(uri))
      );

      batchResults.forEach((result, index) => {
        const uri = batch[index];
        if (result.status === "fulfilled" && result.value) {
          results[uri] = result.value;
        }
      });

      // Small delay between batches to avoid overwhelming the API
      if (i + concurrency < spotifyUris.length) {
        await this.delay(50);
      }
    }

    return results;
  }

  /**
   * Get album info for a track
   * Returns the album URI for navigation purposes
   */
  async getTrackAlbumUri(trackUri: string): Promise<string | null> {
    if (trackUri.startsWith("spotify:local:")) {
      return null;
    }

    return graphqlRateLimiter.execute(
      `getTrackAlbumUri:${trackUri}`,
      async () => {
        try {
          const response = await this.requestTrackGraphQL(
            trackUri,
            "getTrackAlbumUri",
          );

          return response.data?.trackUnion?.albumOfTrack?.uri || null;
        } catch (error) {
          console.error("SpotifyService: Failed to get album URI:", error);
          throw error;
        }
      }
    );
  }

  /**
   * Get artist info from a track for navigation
   * Returns array of artists with their URIs
   */
  async getTrackArtists(
    trackUri: string
  ): Promise<Array<{ name: string; uri: string }>> {
    if (trackUri.startsWith("spotify:local:")) {
      return [];
    }

    return graphqlRateLimiter.execute(
      `getTrackArtists:${trackUri}`,
      async () => {
        try {
          const response = await this.requestTrackGraphQL(
            trackUri,
            "getTrackArtists",
          );

          const trackUnion = response.data?.trackUnion;
          if (!trackUnion) {
            return [];
          }

          return this.extractArtists(trackUnion);
        } catch (error) {
          console.error("SpotifyService: Failed to get artists:", error);
          throw error;
        }
      }
    );
  }

  /**
   * Get playlist name by URI
   */
  async getPlaylistName(playlistUri: string): Promise<string | null> {
    try {
      const { GraphQL, Locale } = Spicetify;

      const response = await GraphQL.Request(GraphQL.Definitions.getPlaylist, {
        uri: playlistUri,
        locale: Locale?.getLocale() || this.locale,
      });

      return response.data?.playlistV2?.name || null;
    } catch (error) {
      console.error("SpotifyService: Failed to get playlist name:", error);
      return null;
    }
  }

  async getAlbumCover(
    trackUri: string,
    preferredSize: number = 300
  ): Promise<string | null> {
    if (trackUri.startsWith("spotify:local:")) {
      return null;
    }

    return graphqlRateLimiter.execute(
      `getAlbumCover:${trackUri}:${preferredSize}`,
      async () => {
        try {
          const response = await this.requestTrackGraphQL(
            trackUri,
            "getAlbumCover",
          );

          const sources =
            response.data?.trackUnion?.albumOfTrack?.coverArt?.sources;
          if (!sources || sources.length === 0) {
            return null;
          }

          const image =
            sources.find((img) => img.height === preferredSize) || sources[0];
          return image.url;
        } catch (error) {
          console.error("SpotifyService: Failed to get album cover:", error);
          throw error;
        }
      }
    );
  }

  /**
   * Get comprehensive track metadata for TrackDetails display
   * Consolidates multiple GraphQL calls into one
   */
  async getTrackMetadata(trackUri: string): Promise<TrackMetadata | null> {
    if (trackUri.startsWith("spotify:local:")) {
      return {
        releaseDate: "",
        trackLength: "",
        playCount: null,
        albumCoverUrl: null,
        genres: [],
      };
    }

    return graphqlRateLimiter.execute(
      `getTrackMetadata:${trackUri}`,
      async () => {
        try {
          const response = await this.requestTrackGraphQL(
            trackUri,
            "getTrackMetadata",
          );

          if (response.errors) {
            console.error("SpotifyService: GraphQL errors:", response.errors);
            return null;
          }

          const trackUnion = response.data?.trackUnion;
          if (!trackUnion) {
            return null;
          }

          // Extract album cover
          let albumCoverUrl: string | null = null;
          const sources = trackUnion.albumOfTrack?.coverArt?.sources;
          if (sources && sources.length > 0) {
            const image =
              sources.find((img: any) => img.height === 300) || sources[0];
            albumCoverUrl = image.url;
          }

          // Extract play count
          let playCount: number | null = null;
          if (trackUnion.playcount) {
            playCount = parseInt(trackUnion.playcount, 10) || null;
          }

          // Format release date
          const releaseDate = this.formatDate(
            trackUnion.albumOfTrack?.date?.isoString || ""
          );

          // Format track length
          const trackLength = this.formatDuration(
            trackUnion.duration?.totalMilliseconds || 0
          );

          return {
            releaseDate,
            trackLength,
            playCount,
            albumCoverUrl,
            genres: [], // Genres require a separate artist query
          };
        } catch (error) {
          console.error("SpotifyService: Failed to get track metadata:", error);
          throw error;
        }
      }
    );
  }

  /**
   * Get context (playlist/album) name for display
   */
  async getContextName(contextUri: string): Promise<string | null> {
    if (!contextUri) return null;

    const parts = contextUri.split(":");
    if (parts.length < 3) return null;

    const contextType = parts[1];

    // Handle special cases that don't need API calls
    if (contextType === "collection" && parts.includes("tracks")) {
      return "Liked Songs";
    }
    if (contextType === "user") {
      return "Liked Songs";
    }

    // Only fetch for playlists (albums/artists can use local data)
    if (contextType === "playlist") {
      return graphqlRateLimiter.execute(
        `getContextName:${contextUri}`,
        async () => {
          try {
            const name = await this.getPlaylistName(contextUri);
            return name || "Playlist";
          } catch (error) {
            console.error("SpotifyService: Failed to get context name:", error);
            return "Playlist";
          }
        }
      );
    }

    return null;
  }

  // ============ Private Helper Methods ============

  private formatDate(dateStr: string): string {
    if (!dateStr) return "";
    if (dateStr.length === 4) return dateStr;

    try {
      const date = new Date(dateStr);
      return date.toISOString().split("T")[0];
    } catch {
      return dateStr;
    }
  }

  private formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  private parseGraphQLTrack(trackUnion: GraphQLTrackUnion): TrackInfo {
    const artists = this.extractArtists(trackUnion);

    return {
      name: trackUnion.name,
      artists: artists.map((a) => a.name).join(", "),
      albumName: trackUnion.albumOfTrack?.name || "Unknown Album",
      albumUri: trackUnion.albumOfTrack?.uri || null,
      artistsData: artists,
      duration_ms: trackUnion.duration?.totalMilliseconds || 0,
      release_date: trackUnion.albumOfTrack?.date?.isoString || "",
    };
  }

  private extractArtists(
    trackUnion: GraphQLTrackUnion
  ): Array<{ name: string; uri: string }> {
    const artists: Array<{ name: string; uri: string }> = [];

    // Method 1: firstArtist.items + otherArtists.items pattern (actual structure)
    if (
      trackUnion.firstArtist?.items &&
      trackUnion.firstArtist.items.length > 0
    ) {
      trackUnion.firstArtist.items.forEach((artist: any) => {
        const name = artist.profile?.name || artist.name || "";
        const uri = artist.uri || "";
        if (name) {
          artists.push({ name, uri });
        }
      });

      // Also check otherArtists
      trackUnion.otherArtists?.items?.forEach((artist: any) => {
        const name = artist.profile?.name || artist.name || "";
        const uri = artist.uri || "";
        if (name) {
          artists.push({ name, uri });
        }
      });
    }

    // Method 2: artists.items array (alternative structure)
    if (artists.length === 0 && trackUnion.artists?.items) {
      trackUnion.artists.items.forEach((artist: any) => {
        const name = artist.profile?.name || artist.name || "";
        const uri = artist.uri || "";
        if (name) {
          artists.push({ name, uri });
        }
      });
    }

    return artists;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const spotifyService = new SpotifyService();
