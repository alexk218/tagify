import { audioFeaturesService } from "@/services/AudioFeaturesService";

export interface TrackAudioFeaturesResult {
  bpm: number | null;
  camelotKey: string | null;
}

export interface SpotifyPlaylistMetadata {
  uri: string;
  name: string;
  ownerName: string | null;
  imageUrl: string | null;
  description: string | null;
  trackCount: number | null;
  snapshotId: string | null;
}

export interface SpotifyArtistMetadata {
  uri: string;
  name: string;
  imageUrl: string | null;
  followerCount: number | null;
  genres: string[];
}

class SpotifyApiService {
  normalizePlaylistUri = (playlistUriOrId: string): string => {
    if (
      playlistUriOrId.startsWith("spotify:playlist:") ||
      playlistUriOrId.startsWith("spotify:album:")
    ) {
      return playlistUriOrId;
    }

    return `spotify:playlist:${playlistUriOrId}`;
  };

  extractPlaylistId = (playlistUriOrId: string): string | null => {
    const normalizedUri = this.normalizePlaylistUri(playlistUriOrId);
    return normalizedUri.split(":").pop() || null;
  };

  extractAlbumId = (albumUriOrId: string): string | null => {
    const normalizedUri = albumUriOrId.startsWith("spotify:album:")
      ? albumUriOrId
      : `spotify:album:${albumUriOrId}`;
    return normalizedUri.split(":").pop() || null;
  };

  normalizeArtistUri = (artistUriOrId: string): string => {
    if (artistUriOrId.startsWith("spotify:artist:")) {
      return artistUriOrId;
    }

    return `spotify:artist:${artistUriOrId}`;
  };

  extractArtistId = (artistUriOrId: string): string | null => {
    const normalizedUri = this.normalizeArtistUri(artistUriOrId);
    return normalizedUri.split(":").pop() || null;
  };

  getPlaylistMetadata = async (
    playlistUriOrId: string,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    try {
      const playlistUri = this.normalizePlaylistUri(playlistUriOrId);
      if (playlistUri.startsWith("spotify:album:")) {
        return this.getAlbumMetadata(playlistUri);
      }

      const metadata = await (
        Spicetify.Platform.PlaylistAPI as any
      ).getMetadata(playlistUri);

      return {
        uri: playlistUri,
        name: metadata?.name || "Unknown Playlist",
        ownerName:
          metadata?.owner?.displayName ||
          metadata?.owner?.name ||
          metadata?.owner?.username ||
          metadata?.ownerName ||
          null,
        imageUrl:
          metadata?.images?.[0]?.url ||
          metadata?.image ||
          metadata?.picture ||
          null,
        description: metadata?.description || null,
        trackCount:
          typeof metadata?.totalLength === "number"
            ? metadata.totalLength
            : typeof metadata?.tracks?.total === "number"
              ? metadata.tracks.total
              : null,
        snapshotId: metadata?.snapshotId || metadata?.snapshot_id || null,
      };
    } catch (error) {
      console.error("Error fetching playlist metadata:", error);
      return null;
    }
  };

  private getAlbumMetadata = async (
    albumUri: string,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    const webApiMetadata = await this.getAlbumMetadataFromWebApi(albumUri);
    if (webApiMetadata) {
      return webApiMetadata;
    }

    try {
      const { GraphQL, Locale } = Spicetify;
      const locale = Locale?.getLocale?.() || "en";
      const definitions = [
        GraphQL.Definitions.getAlbum,
        GraphQL.Definitions.getAlbumNameAndTracks,
        GraphQL.Definitions.albumMetadata,
        GraphQL.Definitions.browseAlbum,
      ].filter(Boolean);

      for (const definition of definitions) {
        const response = await GraphQL.Request(definition, {
          uri: albumUri,
          locale,
          offset: 0,
          limit: 50,
        });
        const album = this.findAlbumMetadataNode(response?.data, albumUri);
        const metadata = this.mapAlbumMetadata(albumUri, album);

        if (metadata && metadata.name !== "Unknown Album") {
          return metadata;
        }
      }

      return this.createUnknownAlbumMetadata(albumUri);
    } catch (error) {
      console.error("Error fetching album metadata:", error);
      return this.createUnknownAlbumMetadata(albumUri);
    }
  };

  private getAlbumMetadataFromWebApi = async (
    albumUri: string,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    try {
      const albumId = this.extractAlbumId(albumUri);
      const token =
        Spicetify.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken;

      if (!albumId || !token) {
        return null;
      }

      const response = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      const album = await response.json();
      return {
        uri: albumUri,
        name: album?.name || "Unknown Album",
        ownerName: Array.isArray(album?.artists)
          ? album.artists
              .map((artist: any) => artist?.name)
              .filter(Boolean)
              .join(", ") || null
          : null,
        imageUrl: album?.images?.[0]?.url || null,
        description: album?.release_date ? `Released ${album.release_date}` : null,
        trackCount:
          typeof album?.total_tracks === "number" ? album.total_tracks : null,
        snapshotId: null,
      };
    } catch (error) {
      console.warn("Error fetching album metadata from Spotify Web API:", error);
      return null;
    }
  };

  private createUnknownAlbumMetadata(albumUri: string): SpotifyPlaylistMetadata {
    return {
      uri: albumUri,
      name: "Unknown Album",
      ownerName: null,
      imageUrl: null,
      description: null,
      trackCount: null,
      snapshotId: null,
    };
  }

  private findAlbumMetadataNode(value: any, albumUri: string): any {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (
      value.uri === albumUri ||
      value.type === "ALBUM" ||
      value.__typename === "Album" ||
      value.__typename === "AlbumUnion"
    ) {
      return value;
    }

    const directCandidate =
      value.albumUnion ||
      value.album ||
      value.albumMetadata ||
      value.browseAlbum ||
      value.albumV2;

    if (directCandidate) {
      return this.findAlbumMetadataNode(directCandidate, albumUri) || directCandidate;
    }

    for (const child of Object.values(value)) {
      const match = this.findAlbumMetadataNode(child, albumUri);
      if (match) {
        return match;
      }
    }

    return null;
  }

  private mapAlbumMetadata(
    albumUri: string,
    album: any,
  ): SpotifyPlaylistMetadata | null {
    if (!album || typeof album !== "object") {
      return null;
    }

    const name =
      album.name ||
      album.title ||
      album.metadata?.name ||
      album.profile?.name ||
      "Unknown Album";
    const artistItems =
      album.artists?.items ||
      album.artists ||
      album.artist?.items ||
      album.albumArtists?.items ||
      [];
    const ownerName = Array.isArray(artistItems)
      ? artistItems
          .map((artist: any) => artist?.profile?.name || artist?.name)
          .filter(Boolean)
          .join(", ") || null
      : album.artist?.profile?.name || album.artist?.name || null;
    const coverSources =
      album.coverArt?.sources ||
      album.visuals?.coverArt?.sources ||
      album.images ||
      album.image?.sources ||
      [];
    const imageUrl =
      coverSources?.[0]?.url ||
      album.image ||
      album.cover ||
      null;
    const trackItems =
      album.tracks?.items ||
      album.discs?.items?.flatMap((disc: any) => disc?.tracks?.items || []) ||
      [];
    const trackCount =
      typeof album.tracks?.totalCount === "number"
        ? album.tracks.totalCount
        : typeof album.tracks?.total === "number"
          ? album.tracks.total
          : typeof album.totalTracks === "number"
            ? album.totalTracks
            : Array.isArray(trackItems) && trackItems.length > 0
              ? trackItems.length
              : null;
    const releaseDate =
      album.date?.isoString ||
      album.releaseDate?.isoString ||
      album.release_date ||
      null;

    return {
      uri: albumUri,
      name,
      ownerName,
      imageUrl,
      description: releaseDate ? `Released ${releaseDate}` : null,
      trackCount,
      snapshotId: null,
    };
  }

  getArtistMetadata = async (
    artistUriOrId: string,
  ): Promise<SpotifyArtistMetadata | null> => {
    try {
      const artistUri = this.normalizeArtistUri(artistUriOrId);
      const { GraphQL, Locale } = Spicetify;
      const definition =
        GraphQL.Definitions.queryArtistOverview ||
        GraphQL.Definitions.queryArtistMinimal ||
        GraphQL.Definitions.browseArtist;

      if (!definition) {
        return {
          uri: artistUri,
          name: "Unknown Artist",
          imageUrl: null,
          followerCount: null,
          genres: [],
        };
      }

      const response = await GraphQL.Request(definition, {
        uri: artistUri,
        locale: Locale?.getLocale?.() || "en",
      });
      const artist =
        response?.data?.artistUnion ||
        response?.data?.artist ||
        response?.data?.browseArtist ||
        response?.data?.artistOverview ||
        response?.data;
      const visual =
        artist?.visuals?.avatarImage ||
        artist?.visuals?.headerImage ||
        artist?.avatarImage ||
        artist?.coverArt;
      const imageUrl =
        visual?.sources?.[0]?.url ||
        artist?.images?.[0]?.url ||
        artist?.image ||
        null;
      const name =
        artist?.profile?.name ||
        artist?.name ||
        artist?.sharingInfo?.shareName ||
        "Unknown Artist";
      const followerCount =
        typeof artist?.stats?.followers === "number"
          ? artist.stats.followers
          : typeof artist?.followers?.total === "number"
            ? artist.followers.total
            : typeof artist?.followers === "number"
              ? artist.followers
              : null;
      const genres = Array.isArray(artist?.genres)
        ? artist.genres
            .map((genre: unknown) =>
              typeof genre === "string"
                ? genre
                : typeof (genre as { name?: unknown })?.name === "string"
                  ? (genre as { name: string }).name
                  : null,
            )
            .filter((genre: string | null): genre is string => Boolean(genre))
        : [];

      return {
        uri: artistUri,
        name,
        imageUrl,
        followerCount,
        genres,
      };
    } catch (error) {
      console.error("Error fetching artist metadata:", error);
      return null;
    }
  };

  /**
   * Get all track URIs in a playlist using Platform API
   */
  getAllTrackUrisInPlaylist = async (playlistId: string): Promise<string[]> => {
    try {
      const playlistUri = `spotify:playlist:${playlistId}`;
      const contents = await (
        Spicetify.Platform.PlaylistAPI as any
      ).getContents(playlistUri);

      return contents.items
        .filter((item: any) => item.uri)
        .map((item: any) => item.uri);
    } catch (error) {
      console.error("Error fetching tracks in playlist:", error);
      return [];
    }
  };

  /**
   * Get all track URIs in an album using Web API with GraphQL fallback.
   */
  getAllTrackUrisInAlbum = async (albumUriOrId: string): Promise<string[]> => {
    const webApiTrackUris = await this.getAllTrackUrisInAlbumFromWebApi(
      albumUriOrId,
    );

    if (webApiTrackUris.length > 0) {
      return webApiTrackUris;
    }

    return this.getAllTrackUrisInAlbumFromGraphQL(albumUriOrId);
  };

  private getAllTrackUrisInAlbumFromWebApi = async (
    albumUriOrId: string,
  ): Promise<string[]> => {
    try {
      const albumId = this.extractAlbumId(albumUriOrId);
      const token =
        Spicetify.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken;

      if (!albumId || !token) {
        return [];
      }

      const trackUris: string[] = [];
      let offset = 0;
      const limit = 50;
      let total: number | null = null;

      do {
        const response = await fetch(
          `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=${limit}&offset=${offset}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!response.ok) {
          return [];
        }

        const page = await response.json();
        const items = Array.isArray(page?.items) ? page.items : [];

        items.forEach((track: any) => {
          if (typeof track?.uri === "string" && track.uri.startsWith("spotify:track:")) {
            trackUris.push(track.uri);
          }
        });

        total = typeof page?.total === "number" ? page.total : trackUris.length;
        offset += items.length;

        if (items.length === 0) {
          break;
        }
      } while (total === null || offset < total);

      return trackUris;
    } catch (error) {
      console.warn("Error fetching album tracks from Spotify Web API:", error);
      return [];
    }
  };

  private getAllTrackUrisInAlbumFromGraphQL = async (
    albumUriOrId: string,
  ): Promise<string[]> => {
    try {
      const albumId = this.extractAlbumId(albumUriOrId);
      const albumUri = albumUriOrId.startsWith("spotify:album:")
        ? albumUriOrId
        : `spotify:album:${albumId}`;
      const { GraphQL, Locale } = Spicetify;
      const locale = Locale?.getLocale?.() || "en";
      const definitions = [
        GraphQL.Definitions.queryAlbumTrackUris,
        GraphQL.Definitions.queryAlbumTracks,
        GraphQL.Definitions.getAlbumNameAndTracks,
        GraphQL.Definitions.getAlbum,
      ].filter(Boolean);

      if (!albumId || definitions.length === 0) {
        return [];
      }

      const trackUris = new Set<string>();
      let offset = 0;
      const limit = 50;

      for (const definition of definitions) {
        trackUris.clear();
        offset = 0;

        for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
          const response = await GraphQL.Request(definition, {
            id: albumId,
            uri: albumUri,
            albumUri,
            locale,
            offset,
            limit,
          });
          const pageTrackUris = this.extractTrackUrisFromGraphQL(response?.data);

          pageTrackUris.forEach((trackUri) => trackUris.add(trackUri));

          if (pageTrackUris.length < limit) {
            break;
          }

          offset += limit;
        }

        if (trackUris.size > 0) {
          return Array.from(trackUris);
        }
      }

      return [];
    } catch (error) {
      console.error("Error fetching tracks in album:", error);
      return [];
    }
  };

  private extractTrackUrisFromGraphQL(value: any): string[] {
    const trackUris = new Set<string>();

    const visit = (node: any) => {
      if (!node) {
        return;
      }

      if (typeof node === "string") {
        if (node.startsWith("spotify:track:")) {
          trackUris.add(node);
        }
        return;
      }

      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }

      if (typeof node !== "object") {
        return;
      }

      if (
        typeof node.uri === "string" &&
        node.uri.startsWith("spotify:track:")
      ) {
        trackUris.add(node.uri);
      }

      Object.values(node).forEach(visit);
    };

    visit(value);
    return Array.from(trackUris);
  }

  isTrackInPlaylist = async (
    trackUri: string,
    playlistId: string
  ): Promise<boolean> => {
    try {
      const playlistUri = `spotify:playlist:${playlistId}`;
      const contents = await (
        Spicetify.Platform.PlaylistAPI as any
      ).getContents(playlistUri);

      return contents.items.some(
        (item: any) => item.uri === trackUri || item.link === trackUri
      );
    } catch (error) {
      console.error("Error checking if track is in playlist:", error);
      return false;
    }
  };

  /**
   * Get all user playlist IDs using Platform API
   */
  getAllUserPlaylists = async (): Promise<string[]> => {
    try {
      const contents = await (
        Spicetify.Platform.RootlistAPI as any
      ).getContents();

      const extractPlaylistIds = (items: any[]): string[] => {
        const ids: string[] = [];
        for (const item of items) {
          if (item.type === "playlist" && item.uri) {
            ids.push(item.uri.split(":").pop());
          } else if (item.type === "folder" && item.items) {
            ids.push(...extractPlaylistIds(item.items));
          }
        }
        return ids;
      };

      return extractPlaylistIds(contents.items || []);
    } catch (error) {
      console.error("Error fetching user playlists:", error);
      return [];
    }
  };

  /**
   * Get track count for a playlist using Platform API
   */
  getPlaylistTrackCount = async (playlistId: string): Promise<number> => {
    try {
      const playlistUri = `spotify:playlist:${playlistId}`;
      const metadata = await (
        Spicetify.Platform.PlaylistAPI as any
      ).getMetadata(playlistUri);
      return metadata?.totalLength || 0;
    } catch (error) {
      console.error("Error fetching playlist track count:", error);
      return 0;
    }
  };

  /**
   * Get track counts for multiple playlists
   */
  getPlaylistTrackCounts = async (
    playlistIds: string[]
  ): Promise<Record<string, number>> => {
    const counts: Record<string, number> = {};

    await Promise.all(
      playlistIds.map(async (playlistId) => {
        counts[playlistId] = await this.getPlaylistTrackCount(playlistId);
      })
    );

    return counts;
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
   * Fetch audio features for a track
   */
  fetchAudioFeatures = async (
    trackUri: string
  ): Promise<TrackAudioFeaturesResult> => {
    const trackId = this.extractTrackId(trackUri);
    if (!trackId) {
      return {
        bpm: null,
        camelotKey: null,
      };
    }

    const features = await audioFeaturesService.getAudioFeaturesByTrackId(trackId);

    return {
      bpm: features?.bpm ?? null,
      camelotKey: features?.camelotKey ?? null,
    };
  };

  /**
   * Fetch BPM for a track
   */
  fetchBpm = async (trackUri: string): Promise<number | null> => {
    const features = await this.fetchAudioFeatures(trackUri);
    return features.bpm;
  };

  /**
   * Add single track to playlist using Platform API
   */
  addTrackToSpotifyPlaylist = async (
    trackUri: string,
    playlistId: string
  ): Promise<{ success: boolean; wasAdded: boolean }> => {
    try {
      if (trackUri.startsWith("spotify:local:")) {
        return { success: true, wasAdded: false };
      }

      const playlistUri = `spotify:playlist:${playlistId}`;
      const isAlreadyInPlaylist = await this.isTrackInPlaylist(
        trackUri,
        playlistId
      );

      if (isAlreadyInPlaylist) {
        return { success: true, wasAdded: false };
      }

      await (Spicetify.Platform.PlaylistAPI as any).add(
        playlistUri,
        [trackUri],
        { after: "end" }
      );

      return { success: true, wasAdded: true };
    } catch (error) {
      console.error("Error adding track to playlist:", error);
      return { success: false, wasAdded: false };
    }
  };

  /**
   * Remove track from playlist using Platform API
   */
  removeTrackFromPlaylist = async (
    trackUri: string,
    playlistId: string
  ): Promise<boolean> => {
    try {
      const playlistUri = `spotify:playlist:${playlistId}`;
      const contents = await (
        Spicetify.Platform.PlaylistAPI as any
      ).getContents(playlistUri);

      const tracksToRemove = contents.items
        .filter((item: any) => item.uri === trackUri)
        .map((item: any) => ({ uri: item.uri, uid: item.uid }));

      if (tracksToRemove.length > 0) {
        await (Spicetify.Platform.PlaylistAPI as any).remove(
          playlistUri,
          tracksToRemove
        );
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error removing track from playlist:", error);
      return false;
    }
  };
}

export const spotifyApiService = new SpotifyApiService();
