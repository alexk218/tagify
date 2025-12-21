import {
  SpotifyPlaylistTracksCountResponse,
  SpotifyPlaylistTracksResponse,
  SpotifyTrackAudioFeaturesResponse,
  SpotifyUserPlaylistsResponse,
} from "../types/SpotifyTypes";

class SpotifyApiService {
  constructor(private baseUrl: string = "https://api.spotify.com/v1") {}

  async *paginatePlaylistTracks(playlistId: string) {
    try {
      let offset = 0;
      const limit = 100;

      while (true) {
        const response: SpotifyPlaylistTracksResponse = await Spicetify.CosmosAsync.get(
          `${this.baseUrl}/playlists/${playlistId}/tracks?offset=${offset}&limit=${limit}&fields=items(track(uri)),total`
        );

        if (!response?.items) {
          break;
        }

        const batchUris = response.items
          .filter((item) => item.track?.uri)
          .map((item) => item.track!.uri);

        yield batchUris;

        if (response.items.length < limit || offset + limit >= response.total) {
          break;
        }

        offset += limit;
      }
    } catch (error) {
      console.error("Error fetching tracks in playlist:", error);
      return;
    }
  }

  getAllTrackUrisInPlaylist = async (playlistId: string): Promise<string[]> => {
    const trackUris: string[] = [];
    try {
      for await (const batchUris of this.paginatePlaylistTracks(playlistId)) {
        trackUris.push(...batchUris);
      }
    } catch (error) {
      console.error("Error fetching tracks in playlist:", error);
      return [];
    }
    return trackUris;
  };

  isTrackInPlaylist = async (trackUri: string, playlistId: string): Promise<boolean> => {
    try {
      for await (const batchUris of this.paginatePlaylistTracks(playlistId)) {
        if (batchUris.includes(trackUri)) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("Error fetching tracks in playlist:", error);
      return false;
    }
  };

  getAllUserPlaylists = async (): Promise<string[]> => {
    try {
      const allApiPlaylistIds: string[] = [];
      let offset = 0;
      const limit = 50;
      while (true) {
        const response: SpotifyUserPlaylistsResponse = await Spicetify.CosmosAsync.get(
          `${this.baseUrl}/me/playlists?offset=${offset}&limit=${limit}&fields=items(id),total`
        );

        if (!response?.items?.length) break;

        const batchIds = response.items.map((p: { id: string }) => p.id);
        allApiPlaylistIds.push(...batchIds);

        if (response.items.length < limit || offset + limit >= response.total) {
          break;
        }

        offset += limit;
      }
      return allApiPlaylistIds;
    } catch (error) {
      console.error(`Problem fetching or processing playlists:`, error);
      return [];
    }
  };

  /**
   * Get track count for multiple playlists
   */
  getPlaylistTrackCounts = async (playlistIds: string[]): Promise<Record<string, number>> => {
    const counts: Record<string, number> = {};

    await Promise.all(
      playlistIds.map(async (playlistId) => {
        try {
          const response: SpotifyPlaylistTracksCountResponse = await Spicetify.CosmosAsync.get(
            `${this.baseUrl}/playlists/${playlistId}/tracks?limit=1&fields=total`
          );
          counts[playlistId] = response?.total || 0;
        } catch (error) {
          console.error(`Error fetching track count for playlist ${playlistId}:`, error);
          counts[playlistId] = 0;
        }
      })
    );

    return counts;
  };

  /**
   * Get audio features for a track (for BPM)
   */
  getAudioFeatures = async (trackId: string): Promise<{ tempo: number } | null> => {
    try {
      const audioFeatures: SpotifyTrackAudioFeaturesResponse = await Spicetify.CosmosAsync.get(
        `${this.baseUrl}/audio-features/${trackId}`
      );
      return audioFeatures?.tempo ? { tempo: audioFeatures.tempo } : null;
    } catch (error) {
      console.error("Error fetching audio features:", error);
      return null;
    }
  };

  /**
   * Extract track ID from Spotify URI
   */
  extractTrackId(trackUri: string): string | null {
    if (trackUri.startsWith("spotify:local:")) {
      return null;
    }
    return trackUri.split(":").pop() || null;
  }

  /**
   * Fetch BPM for a track
   */
  fetchBpm = async (trackUri: string): Promise<number | null> => {
    const trackId = this.extractTrackId(trackUri);
    if (!trackId) return null;

    const audioFeatures = await this.getAudioFeatures(trackId);
    return audioFeatures ? Math.round(audioFeatures.tempo) : null;
  };

  /**
   * Add single track to playlist (with duplicate check)
   */
  addTrackToSpotifyPlaylist = async (
    trackUri: string,
    playlistId: string
  ): Promise<{ success: boolean; wasAdded: boolean }> => {
    try {
      if (trackUri.startsWith("spotify:local:")) {
        return { success: true, wasAdded: false };
      }

      const isAlreadyInPlaylist = await this.isTrackInPlaylist(trackUri, playlistId);

      if (isAlreadyInPlaylist) {
        return { success: true, wasAdded: false };
      }

      await Spicetify.CosmosAsync.post(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          uris: [trackUri],
        }
      );

      return { success: true, wasAdded: true };
    } catch (error) {
      console.error("Error creating Spotify playlist:", error);
      return { success: false, wasAdded: false };
    }
  };

  /**
   * Remove track from playlist
   */
  removeTrackFromPlaylist = async (trackUri: string, playlistId: string): Promise<boolean> => {
    try {
      await Spicetify.CosmosAsync.del(`${this.baseUrl}/playlists/${playlistId}/tracks`, {
        tracks: [{ uri: trackUri }],
      });

      // Add delay for Spotify cache sync
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return true;
    } catch (error) {
      console.error("Error removing track from playlist:", error);
      return false;
    }
  };
}

export const spotifyApiService = new SpotifyApiService();
