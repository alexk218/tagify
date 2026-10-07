import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { requestSpicetifyGraphQL } from "@/services/spicetifyGraphQL";
import { graphqlRateLimiter } from "@/utils/RateLimiter";

const ALBUM_GRAPHQL_PAGE_SIZE = 50;
// Ten pages cover even very long compilations without endless paging.
const ALBUM_TRACK_PAGE_LIMIT = 10;

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

interface GraphQLAlbumTrackItem {
  track?: {
    uri?: unknown;
    name?: unknown;
    discNumber?: unknown;
    trackNumber?: unknown;
    artists?: { items?: Array<{ profile?: { name?: string } } | null> };
  };
}

export interface SpotifyAlbumTrack {
  uri: string;
  name: string;
  artists: string;
  discNumber: number;
  trackNumber: number;
}

export interface SpotifyArtistMetadata {
  uri: string;
  name: string;
  imageUrl: string | null;
  followerCount: number | null;
  genres: string[];
}

class SpotifyApiService {
  private playlistReadsBlockedUntil = 0;
  private getAccessToken(): string | null {
    return (
      Spicetify.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken ||
      (Spicetify.Platform.PlaylistAPI as any)?._builder?._accessToken ||
      null
    );
  }

  createPrivatePlaylist = async (name: string, description = ""): Promise<string> => {
    const token = this.getAccessToken();
    if (!token) throw new Error("Spotify needs you to sign in again before creating a playlist.");
    let response: Response;
    try {
      response = await fetch("https://api.spotify.com/v1/me/playlists", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, public: false, collaborative: false }),
      });
    } catch {
      throw new Error("Spotify didn’t confirm whether your playlist was created. Check your Spotify library before trying again.");
    }
    if (!response.ok) {
      if (response.status === 429) throw new Error("Spotify needs a short break. Wait a moment, then try creating your playlist again.");
      throw new Error("Spotify couldn’t create a private playlist. Check that Spotify is online and signed in, then try again.");
    }
    let result: { id?: unknown };
    try { result = await response.json(); } catch { throw new Error("Spotify didn’t return your new playlist. Check your Spotify library before trying again."); }
    if (typeof result.id !== "string" || !/^[A-Za-z0-9]+$/.test(result.id)) throw new Error("Spotify didn’t return your new playlist. Check your Spotify library before trying again.");
    return result.id;
  };

  private hasUsableName(value: unknown, placeholder: string): value is string {
    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().toLowerCase() !== placeholder.toLowerCase()
    );
  }

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
    const playlistUri = this.normalizePlaylistUri(playlistUriOrId);
    if (playlistUri.startsWith("spotify:album:")) {
      return this.getAlbumMetadata(playlistUri);
    }

    try {
      const metadata = await (
        Spicetify.Platform.PlaylistAPI as any
      ).getMetadata(playlistUri);

      if (this.hasUsableName(metadata?.name, "Unknown Playlist")) {
        return {
          uri: playlistUri,
          name: metadata.name,
          ownerName:
            metadata?.owner?.displayName ||
            metadata?.owner?.display_name ||
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
      }
    } catch (error) {
      console.warn("PlaylistAPI metadata lookup failed; trying Web API:", error);
    }

    return this.getPlaylistMetadataFromWebApi(playlistUri);
  };

  private getPlaylistMetadataFromWebApi = async (
    playlistUri: string,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    try {
      const playlistId = this.extractPlaylistId(playlistUri);
      const token = this.getAccessToken();

      if (!playlistId || !token) {
        return null;
      }

      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        return null;
      }

      const playlist = await response.json();
      if (!this.hasUsableName(playlist?.name, "Unknown Playlist")) {
        return null;
      }

      return {
        uri: playlistUri,
        name: playlist.name,
        ownerName:
          playlist?.owner?.display_name ||
          playlist?.owner?.displayName ||
          playlist?.owner?.id ||
          null,
        imageUrl: playlist?.images?.[0]?.url || null,
        description: playlist?.description || null,
        trackCount:
          typeof playlist?.tracks?.total === "number" ? playlist.tracks.total : null,
        snapshotId: playlist?.snapshot_id || null,
      };
    } catch (error) {
      console.warn("Error fetching playlist metadata from Spotify Web API:", error);
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

    return this.getAlbumMetadataFromGraphQL(albumUri);
  };

  /** Album details from Spotify's own client API, which keeps working when the Web API is throttled. */
  private getAlbumMetadataFromGraphQL = async (
    albumUri: string,
    pageSize: number = ALBUM_GRAPHQL_PAGE_SIZE,
  ): Promise<SpotifyPlaylistMetadata | null> => {
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
        const response = await requestSpicetifyGraphQL<any>(definition, {
          uri: albumUri,
          locale,
          offset: 0,
          limit: pageSize,
        });
        const album = this.findAlbumMetadataNode(response?.data, albumUri);
        const metadata = this.mapAlbumMetadata(albumUri, album, pageSize);

        if (metadata && metadata.name !== "Unknown Album") {
          return metadata;
        }
      }

      return null;
    } catch (error) {
      console.error("Error fetching album metadata:", error);
      return null;
    }
  };

  /**
   * How many tracks an album has, asked of Spotify's own client API one album
   * at a time. Returns null when Spotify cannot say.
   */
  getAlbumTrackTotal = async (albumUri: string): Promise<number | null> =>
    graphqlRateLimiter.execute(`albumTrackTotal:${albumUri}`, async () => {
      // One track per page keeps the answer small; the total comes with it.
      const metadata = await this.getAlbumMetadataFromGraphQL(albumUri, 1);
      return metadata?.trackCount ?? null;
    });

  /**
   * An album's tracks in album order, from Spotify's own client API first (it
   * keeps working when the Web API is throttled). Null when Spotify cannot say.
   */
  getAlbumTracks = async (albumUri: string): Promise<SpotifyAlbumTrack[] | null> => {
    const graphQLTracks = await graphqlRateLimiter
      .execute(`albumTracks:${albumUri}`, () => this.getAlbumTracksFromGraphQL(albumUri))
      .catch(() => null);
    if (graphQLTracks && graphQLTracks.length > 0) {
      return graphQLTracks;
    }

    return this.getAlbumTracksFromWebApi(albumUri);
  };

  private getAlbumTracksFromGraphQL = async (
    albumUri: string,
  ): Promise<SpotifyAlbumTrack[] | null> => {
    const { GraphQL, Locale } = Spicetify;
    const definition =
      GraphQL?.Definitions?.getAlbum || GraphQL?.Definitions?.queryAlbumTracks;
    if (!definition) {
      return null;
    }

    const locale = Locale?.getLocale?.() || "en";
    const tracks: SpotifyAlbumTrack[] = [];
    for (let page = 0; page < ALBUM_TRACK_PAGE_LIMIT; page += 1) {
      const offset = page * ALBUM_GRAPHQL_PAGE_SIZE;
      const response = await requestSpicetifyGraphQL<{ data?: unknown }>(definition, {
        uri: albumUri,
        locale,
        offset,
        limit: ALBUM_GRAPHQL_PAGE_SIZE,
      });
      const trackPage: { items?: unknown; totalCount?: unknown } | undefined =
        this.findAlbumMetadataNode(response?.data, albumUri)?.tracksV2;
      const items: GraphQLAlbumTrackItem[] = Array.isArray(trackPage?.items)
        ? trackPage.items
        : [];

      items.forEach((item, index) => {
        const track = item?.track;
        if (typeof track?.uri !== "string" || !track.uri.startsWith("spotify:track:")) {
          return;
        }
        tracks.push({
          uri: track.uri,
          name: typeof track.name === "string" ? track.name : "Unknown Track",
          artists: Array.isArray(track.artists?.items)
            ? track.artists.items
                .map((artist) => artist?.profile?.name)
                .filter(Boolean)
                .join(", ")
            : "",
          discNumber: typeof track.discNumber === "number" ? track.discNumber : 1,
          trackNumber:
            typeof track.trackNumber === "number" ? track.trackNumber : offset + index + 1,
        });
      });

      const totalCount =
        typeof trackPage?.totalCount === "number" ? trackPage.totalCount : null;
      if (
        items.length < ALBUM_GRAPHQL_PAGE_SIZE ||
        (totalCount !== null && offset + items.length >= totalCount)
      ) {
        break;
      }
    }

    return tracks;
  };

  private getAlbumTracksFromWebApi = async (
    albumUri: string,
  ): Promise<SpotifyAlbumTrack[] | null> => {
    const albumId = this.extractAlbumId(albumUri);
    const token = this.getAccessToken();
    if (!albumId || !token) {
      return null;
    }

    try {
      const tracks: SpotifyAlbumTrack[] = [];
      for (let page = 0; page < ALBUM_TRACK_PAGE_LIMIT; page += 1) {
        const response = await fetch(
          `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50&offset=${page * 50}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) {
          return tracks.length > 0 ? tracks : null;
        }

        const body: {
          items?: Array<{
            uri?: string;
            name?: string;
            artists?: Array<{ name?: string }>;
            disc_number?: number;
            track_number?: number;
          }>;
          next?: string | null;
        } = await response.json();
        (body.items || []).forEach((track) => {
          if (typeof track.uri === "string" && track.uri.startsWith("spotify:track:")) {
            tracks.push({
              uri: track.uri,
              name: track.name || "Unknown Track",
              artists: (track.artists || [])
                .map((artist) => artist.name)
                .filter(Boolean)
                .join(", "),
              discNumber: track.disc_number ?? 1,
              trackNumber: track.track_number ?? tracks.length + 1,
            });
          }
        });
        if (!body.next) {
          break;
        }
      }
      return tracks;
    } catch (error) {
      console.warn("Error fetching album tracks from Spotify Web API:", error);
      return null;
    }
  };

  /**
   * Look up how many tracks each album has, 20 albums per Web API request.
   * Returns null when Spotify cannot answer; albums it does not know are omitted.
   */
  getAlbumTrackTotals = async (
    albumUris: string[],
  ): Promise<Map<string, number> | null> => {
    const token = this.getAccessToken();
    if (!token) {
      return null;
    }

    const totals = new Map<string, number>();
    const albumIds = Array.from(
      new Set(
        albumUris
          .map((albumUri) => this.extractAlbumId(albumUri))
          .filter((albumId): albumId is string => Boolean(albumId)),
      ),
    );

    try {
      for (let index = 0; index < albumIds.length; index += 20) {
        const groupIds = albumIds.slice(index, index + 20);
        const response = await fetch(
          `https://api.spotify.com/v1/albums?ids=${groupIds.join(",")}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok) {
          return null;
        }

        const body: { albums?: Array<{ total_tracks?: unknown } | null> } =
          await response.json();
        const albums = Array.isArray(body?.albums) ? body.albums : [];
        // Spotify answers in request order, with null for albums it cannot find.
        groupIds.forEach((albumId, albumIndex) => {
          const totalTracks = albums[albumIndex]?.total_tracks;
          if (typeof totalTracks === "number" && totalTracks > 0) {
            totals.set(`spotify:album:${albumId}`, totalTracks);
          }
        });
      }
    } catch (error) {
      console.warn("Error fetching album lengths from Spotify Web API:", error);
      return null;
    }

    return totals;
  };

  private getAlbumMetadataFromWebApi = async (
    albumUri: string,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    try {
      const albumId = this.extractAlbumId(albumUri);
      const token = this.getAccessToken();

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
      if (!this.hasUsableName(album?.name, "Unknown Album")) {
        return null;
      }

      return {
        uri: albumUri,
        name: album.name,
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
    pageSize: number = ALBUM_GRAPHQL_PAGE_SIZE,
  ): SpotifyPlaylistMetadata | null {
    if (!album || typeof album !== "object") {
      return null;
    }

    const name =
      album.name ||
      album.title ||
      album.metadata?.name ||
      album.profile?.name;
    if (!this.hasUsableName(name, "Unknown Album")) {
      return null;
    }
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
      album.tracksV2?.items ||
      album.tracks?.items ||
      album.discs?.items?.flatMap((disc: any) => disc?.tracks?.items || []) ||
      [];
    const discTrackCounts: unknown[] = Array.isArray(album.discs?.items)
      ? album.discs.items.map(
          (disc: { tracks?: { totalCount?: unknown } } | null) => disc?.tracks?.totalCount,
        )
      : [];
    const discTrackTotal =
      discTrackCounts.length > 0 &&
      discTrackCounts.every((count): count is number => typeof count === "number")
        ? discTrackCounts.reduce((total: number, count) => total + (count as number), 0)
        : null;
    // Spotify's current client reports album length as tracksV2.totalCount.
    const reportedTrackCount = [
      album.tracksV2?.totalCount,
      album.tracks?.totalCount,
      album.tracks?.total,
      album.totalTracks,
      discTrackTotal,
    ].find((count): count is number => typeof count === "number" && count > 0);
    // A full page of items may be only part of the album, so it is not a length.
    const trackCount =
      reportedTrackCount ??
      (Array.isArray(trackItems) && trackItems.length > 0 && trackItems.length < pageSize
        ? trackItems.length
        : null);
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
    const artistUri = this.normalizeArtistUri(artistUriOrId);
    const webApiMetadata = await this.getArtistMetadataFromWebApi(artistUri);
    if (webApiMetadata) {
      return webApiMetadata;
    }

    try {
      const { GraphQL, Locale } = Spicetify;
      const definitions = [
        GraphQL.Definitions.queryArtistOverview,
        GraphQL.Definitions.queryArtistMinimal,
        GraphQL.Definitions.browseArtist,
      ].filter(Boolean);

      for (const definition of definitions) {
        const response = await requestSpicetifyGraphQL<any>(definition, {
          uri: artistUri,
          locale: Locale?.getLocale?.() || "en",
        });
        const artist = this.findArtistMetadataNode(response?.data, artistUri);
        const metadata = this.mapArtistMetadata(artistUri, artist);
        if (metadata) {
          return metadata;
        }
      }

      return null;
    } catch (error) {
      console.error("Error fetching artist metadata:", error);
      return null;
    }
  };

  private getArtistMetadataFromWebApi = async (
    artistUri: string,
  ): Promise<SpotifyArtistMetadata | null> => {
    try {
      const artistId = this.extractArtistId(artistUri);
      const token = this.getAccessToken();
      if (!artistId || !token) {
        return null;
      }

      const response = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        return null;
      }

      const artist = await response.json();
      return this.mapArtistMetadata(artistUri, artist);
    } catch (error) {
      console.warn("Error fetching artist metadata from Spotify Web API:", error);
      return null;
    }
  };

  private findArtistMetadataNode(value: any, artistUri: string): any {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (
      value.uri === artistUri ||
      value.type === "ARTIST" ||
      value.__typename === "Artist" ||
      value.__typename === "ArtistUnion"
    ) {
      return value;
    }

    const directCandidate =
      value.artistUnion ||
      value.artist ||
      value.browseArtist ||
      value.artistOverview;
    if (directCandidate) {
      return this.findArtistMetadataNode(directCandidate, artistUri) || directCandidate;
    }

    for (const child of Object.values(value)) {
      const match = this.findArtistMetadataNode(child, artistUri);
      if (match) {
        return match;
      }
    }

    return null;
  }

  private mapArtistMetadata(
    artistUri: string,
    artist: any,
  ): SpotifyArtistMetadata | null {
    if (!artist || typeof artist !== "object") {
      return null;
    }
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
      artist?.profile?.name || artist?.name || artist?.sharingInfo?.shareName;
    if (!this.hasUsableName(name, "Unknown Artist")) {
      return null;
    }
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
  }

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
   * Fetch playlist membership without converting API failures into an empty
   * playlist. Reconciliation callers must distinguish those two states so a
   * transient Spotify failure cannot overwrite the last confirmed membership.
   */
  getAllTrackUrisInPlaylistStrict = async (
    playlistId: string,
  ): Promise<string[]> => {
    const playlistUri = `spotify:playlist:${playlistId}`;
    try {
      const contents = await (
        Spicetify.Platform.PlaylistAPI as any
      ).getContents(playlistUri);
      if (!Array.isArray(contents?.items)) {
        throw new Error(`Spotify returned invalid contents for ${playlistUri}`);
      }
      if (
        typeof contents.totalLength === "number" &&
        contents.totalLength > contents.items.length
      ) {
        return this.getPlaylistTrackUrisFromWebApi(playlistId);
      }
      const uris = contents.items.map((item: any) => item?.uri ?? item?.link);
      if (uris.some((uri: unknown) => typeof uri !== "string")) {
        throw new Error(`Spotify returned incomplete contents for ${playlistUri}`);
      }
      return uris;
    } catch (desktopError) {
      try {
        return await this.getPlaylistTrackUrisFromWebApi(playlistId);
      } catch (webError) {
        console.error("Spotify playlist reads failed in both clients:", { desktopError, webError });
        throw webError;
      }
    }
  };

  private getPlaylistTrackUrisFromWebApi = async (playlistId: string): Promise<string[]> => {
    if (Date.now() < this.playlistReadsBlockedUntil) {
      throw new Error("Spotify playlist reads are waiting for the rate limit to clear");
    }
    const token = this.getAccessToken();
    if (!token) throw new Error("Spotify access token is unavailable");

    const trackUris: string[] = [];
    let offset = 0;
    for (;;) {
      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?limit=100&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const seconds = retryAfter ? Number(retryAfter) : NaN;
          const until = Number.isFinite(seconds)
            ? Date.now() + Math.max(1, seconds) * 1000
            : Date.parse(retryAfter || "");
          this.playlistReadsBlockedUntil = Number.isFinite(until) ? until : Date.now() + 60_000;
        }
        throw new Error(`Spotify playlist items request failed (${response.status})`);
      }
      const page = await response.json();
      if (!Array.isArray(page?.items)) {
        throw new Error("Spotify playlist items response is incomplete");
      }
      for (const item of page.items) {
        const uri = item?.track?.uri ?? item?.item?.uri;
        if (typeof uri === "string" && uri.startsWith("spotify:track:")) {
          trackUris.push(uri);
        }
      }
      if (!page.next) return trackUris;
      if (page.items.length === 0) {
        throw new Error("Spotify playlist items pagination stopped unexpectedly");
      }
      offset += page.items.length;
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
          const response = await requestSpicetifyGraphQL<any>(definition, {
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
    // A failed read does not mean the track is absent. Never write on that guess.
    return (await this.getAllTrackUrisInPlaylistStrict(playlistId)).includes(trackUri);
  };

  /**
   * Get all user playlist IDs using Platform API
   */
  getAllUserPlaylistsStrict = async (): Promise<string[]> => {
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

    if (!contents || !Array.isArray(contents.items)) {
      throw new Error("Spotify rootlist response did not contain playlist items");
    }
    return extractPlaylistIds(contents.items);
  };

  getAllUserPlaylistReferencesStrict = async (): Promise<
    Array<{ playlistId: string; playlistName: string }>
  > => {
    const playlistIds = await this.getAllUserPlaylistsStrict();
    const references = await Promise.all(
      playlistIds.map(async (playlistId) => {
        try {
          const metadata = await (
            Spicetify.Platform.PlaylistAPI as any
          ).getMetadata(`spotify:playlist:${playlistId}`);
          return typeof metadata?.name === "string" && metadata.name.trim()
            ? { playlistId, playlistName: metadata.name }
            : null;
        } catch (error) {
          console.error(
            `Error fetching playlist metadata for ${playlistId}:`,
            error,
          );
          return null;
        }
      }),
    );

    return references.filter(
      (reference): reference is { playlistId: string; playlistName: string } =>
        reference !== null,
    );
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

  /** Remove only repeated occurrences, including local files which cannot be re-added. */
  removeDuplicatePlaylistOccurrences = async (playlistId: string): Promise<number> => {
    const playlistUri = `spotify:playlist:${playlistId}`;
    const api = Spicetify.Platform.PlaylistAPI as unknown as {
      getContents(uri: string): Promise<{ items: Array<{ uri: string; uid?: string }> }>;
      remove(uri: string, items: Array<{ uri: string; uid: string }>): Promise<unknown>;
    };
    const contents = await api.getContents(playlistUri);
    const seen = new Set<string>();
    const duplicates = contents.items.filter((item: { uri: string }) => {
      if (seen.has(item.uri)) return true;
      seen.add(item.uri);
      return false;
    });
    if (duplicates.some((item: { uid?: string }) => !item.uid)) {
      throw new Error("Spotify could not identify the duplicate songs. Please try again.");
    }
    if (duplicates.length) await api.remove(playlistUri, duplicates.map((item) => ({ uri: item.uri, uid: item.uid! })));
    return duplicates.length;
  };
}

export const spotifyApiService = new SpotifyApiService();
