import { rememberPlaylistAdditions } from "./SpotifyPlaylistWriteOrigins";
import { spotifyRequestAccounting } from "@/utils/spotifyRequestAccounting";
import type { RequestOptions } from "@/utils/RateLimiter";
import { spotifyFetch, spotifyRead, spotifyWrite, spotifyAccountKey, promoteSpotifyRequest, spotifyReadGeneration, assertSpotifyWriteSettled, throwIfSpotifyRequestStopped } from "./SpotifyRequests";
import { rememberRuleFacts } from "@/features/automatic-tags/facts";
import { normalizeRecordingIdentity } from "@/features/recording-reuse/utils/recordingReuse";
import { normalizeQueuePage } from "@/features/track-session/utils/taggingQueue.logic";
import { trackArtistIdentitiesStore, type TrackArtist } from "@/services/trackArtistIdentities";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { requestSpicetifyGraphQL } from "@/services/spicetifyGraphQL";

const ALBUM_GRAPHQL_PAGE_SIZE = 50;
// Ten pages cover even very long compilations without endless paging.
const ALBUM_TRACK_PAGE_LIMIT = 10;

export interface PlaylistTrackUpdateOptions extends RequestOptions {
  beforeWrite?: (uris: string[], action: "add" | "remove") => Promise<void>;
}

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
    duration?: { totalMilliseconds?: number };
    discNumber?: unknown;
    trackNumber?: unknown;
    artists?: { items?: Array<{ uri?: string; profile?: { name?: string } } | null> };
  };
}

export interface SpotifyAlbumTrack {
  uri: string;
  name: string;
  artists: string;
  artistsData?: Array<{ uri: string; name: string }>;
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
  private recordingReadsBlockedUntil = 0;
  private getAccessToken(): string | null {
    return (
      Spicetify.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken ||
      (Spicetify.Platform.PlaylistAPI as any)?._builder?._accessToken ||
      null
    );
  }

  getRecordingIdentity = async (uri: string, signal?: AbortSignal, options?: RequestOptions) => {
    const id = uri.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1];
    if (!id) throw new Error("Recording matching is available for Spotify songs.");
    const token = this.getAccessToken();
    if (!token) throw new Error("Sign in to Spotify again to check this recording.");
    // Desktop metadata carries the same ISRC without relying on Web API availability.
    if (Spicetify.URI?.idToHex && Spicetify.URI?.hexToId && Date.now() >= this.recordingReadsBlockedUntil) {
      try {
        const hex = Spicetify.URI.idToHex(id);
        if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error("Invalid Spotify song identity");
        const response = await spotifyFetch(`https://spclient.wg.spotify.com/metadata/4/track/${hex}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal,
        }, undefined, options);
        if (response.status === 429) {
          const retry = Number(response.headers.get("Retry-After"));
          this.recordingReadsBlockedUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000;
        }
        if (response.ok) {
          const value = await response.json();
          if (typeof value.gid === "string" && value.gid.toLowerCase() === hex.toLowerCase()) {
            const identity = normalizeRecordingIdentity({
              isrc: value.external_id?.find((entry: { type?: string }) => entry.type?.toLowerCase() === "isrc")?.id?.toUpperCase(),
              artistIds: value.artist?.map((artist: { gid?: string }) =>
                typeof artist.gid === "string" && /^[a-f0-9]{32}$/i.test(artist.gid) ? Spicetify.URI.hexToId(artist.gid) : undefined),
              durationMs: value.duration, name: value.name,
            });
            if (identity) return identity;
          }
        }
      } catch (error) {
      throwIfSpotifyRequestStopped(error);
        if (signal?.aborted) throw error;
        // Unsupported desktop metadata can still be confirmed by the Web API.
      }
    }
    if (signal?.aborted) throw new DOMException("Recording check cancelled", "AbortError");
    if (Date.now() < this.playlistReadsBlockedUntil) throw new Error("Spotify needs a short break. Wait a moment, then try again.");
    const response = await spotifyFetch(`https://api.spotify.com/v1/tracks/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal }, undefined, options);
    if (!response.ok) {
      if (response.status === 429) {
        const retry = Number(response.headers.get("Retry-After"));
        this.playlistReadsBlockedUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000;
      }
      throw new Error("Spotify couldn't check this recording. Wait a moment, then try again.");
    }
    const value = await response.json();
    return normalizeRecordingIdentity({ isrc: value.external_ids?.isrc?.toUpperCase(), artistIds: value.artists?.map((artist: { id?: string }) => artist.id), durationMs: value.duration_ms, name: value.name });
  };

  getTaggingQueuePage = async (playlistId: string | null, offset = 0, signal?: AbortSignal, useWebApi = false) => {
    const limit = 50;
    if (Date.now() < this.playlistReadsBlockedUntil) throw new Error("Spotify needs a short break. Wait a moment, then check more tracks.");
    try {
      if (useWebApi) throw new Error("Use precise library paging");
      const native = playlistId
        ? await spotifyRead<any>(`desktop:playlist:getContents:${JSON.stringify([`spotify:playlist:${playlistId}`,{ offset, limit }])}`, () => (Spicetify.Platform.PlaylistAPI as any).getContents(`spotify:playlist:${playlistId}`, { offset, limit }), { signal })
        : await spotifyRead<any>(`desktop:library:getTracks:${JSON.stringify([{ offset, limit }])}`, () => (Spicetify.Platform.LibraryAPI as any).getTracks({ offset, limit }), { signal });
      if (!Array.isArray(native?.items) || native.items.length > limit || (typeof native.offset === "number" && native.offset !== offset)) {
        throw new Error("Desktop library paging is unavailable");
      }
      return { ...normalizeQueuePage(native, offset), backend: "desktop" as const };
    } catch (error) {
      throwIfSpotifyRequestStopped(error);
      if (signal?.aborted) throw error;
      if ((error as any)?.status === 429) {
        this.playlistReadsBlockedUntil = Date.now() + 60_000;
        throw new Error("Spotify needs a short break. Wait a moment, then check more tracks.");
      }
    }
    const token = this.getAccessToken();
    if (!token) throw new Error("Spotify needs you to sign in again before checking your library.");
    const endpoint = playlistId ? `playlists/${encodeURIComponent(playlistId)}/items` : "me/tracks";
    const response = await spotifyFetch(`https://api.spotify.com/v1/${endpoint}?limit=${limit}&offset=${offset}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) {
      if (response.status === 429) {
        const retry = Number(response.headers.get("Retry-After"));
        this.playlistReadsBlockedUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000;
        throw new Error("Spotify needs a short break. Wait a moment, then check more tracks.");
      }
      throw new Error("Spotify couldn't check those tracks. Make sure you're online and can open this library, then try again.");
    }
    const page = await response.json();
    if (typeof page.offset === "number" && page.offset !== offset) throw new Error("Spotify repeated a page of your library. Your progress is kept; try again later.");
    return { ...normalizeQueuePage(page, offset), backend: "web" as const };
  };

  createPrivatePlaylist = async (name: string, description = ""): Promise<string> => {
    const token = this.getAccessToken();
    if (!token) throw new Error("Spotify needs you to sign in again before creating a playlist.");
    let response: Response;
    try {
      response = await spotifyFetch("https://api.spotify.com/v1/me/playlists", {
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
    options?: RequestOptions,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    const playlistUri = this.normalizePlaylistUri(playlistUriOrId);
    if (playlistUri.startsWith("spotify:album:")) {
      return this.getAlbumMetadata(playlistUri, options);
    }

    try {
      const metadata = await spotifyRead<any>(`desktop:playlist:getMetadata:${JSON.stringify([playlistUri])}`, () => (
        Spicetify.Platform.PlaylistAPI as any
      ).getMetadata(playlistUri), options);

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
      throwIfSpotifyRequestStopped(error);
      console.warn("PlaylistAPI metadata lookup failed; trying Web API:", error);
    }

    return this.getPlaylistMetadataFromWebApi(playlistUri, options);
  };

  private getPlaylistMetadataFromWebApi = async (
    playlistUri: string,
    options?: RequestOptions,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    try {
      const playlistId = this.extractPlaylistId(playlistUri);
      const token = this.getAccessToken();

      if (!playlistId || !token) {
        return null;
      }

      const response = await spotifyFetch(
        `https://api.spotify.com/v1/playlists/${playlistId}`,
        { headers: { Authorization: `Bearer ${token}` } }, undefined, options,
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
      throwIfSpotifyRequestStopped(error);
      console.warn("Error fetching playlist metadata from Spotify Web API:", error);
      return null;
    }
  };

  private getAlbumMetadata = async (
    albumUri: string,
    options?: RequestOptions,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    const webApiMetadata = await this.getAlbumMetadataFromWebApi(albumUri, options);
    if (webApiMetadata) {
      return webApiMetadata;
    }

    return this.getAlbumMetadataFromGraphQL(albumUri, undefined, options);
  };

  /** Album details from Spotify's own client API, which keeps working when the Web API is throttled. */
  private getAlbumMetadataFromGraphQL = async (
    albumUri: string,
    pageSize: number = ALBUM_GRAPHQL_PAGE_SIZE,
    options?: RequestOptions,
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
        }, undefined, options);
        const album = this.findAlbumMetadataNode(response?.data, albumUri);
        const metadata = this.mapAlbumMetadata(albumUri, album, pageSize);

        if (metadata && metadata.name !== "Unknown Album") {
          return metadata;
        }
      }

      return null;
    } catch (error) {
      throwIfSpotifyRequestStopped(error);
      console.error("Error fetching album metadata:", error);
      return null;
    }
  };

  /**
   * How many tracks an album has, asked of Spotify's own client API one album
   * at a time. Returns null when Spotify cannot say.
   */
  getAlbumTrackTotal = async (albumUri: string, options?: RequestOptions): Promise<number | null> =>
    (async () => {
      // One track per page keeps the answer small; the total comes with it.
      const metadata = await this.getAlbumMetadataFromGraphQL(albumUri, 1, options);
      return metadata?.trackCount ?? null;
    })();

  /**
   * An album's tracks in album order, from Spotify's own client API first (it
   * shares the same cooldown as the Web API). Null when Spotify cannot say.
   */
  getAlbumTracks = async (albumUri: string, options?: RequestOptions): Promise<SpotifyAlbumTrack[] | null> => {
    const graphQLTracks = await (() => this.getAlbumTracksFromGraphQL(albumUri, options))()
      .catch((error) => { throwIfSpotifyRequestStopped(error); return null; });
    if (graphQLTracks && graphQLTracks.length > 0) {
      return graphQLTracks;
    }

    return this.getAlbumTracksFromWebApi(albumUri, options);
  };

  private getAlbumTracksFromGraphQL = async (
    albumUri: string,
    options?: RequestOptions,
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
      }, undefined, options);
      const trackPage: { items?: unknown; totalCount?: unknown } | undefined =
        this.findAlbumMetadataNode(response?.data, albumUri)?.tracksV2;
      const items: GraphQLAlbumTrackItem[] = Array.isArray(trackPage?.items)
        ? trackPage.items
        : [];
      if (items.some((item) => typeof item?.track?.uri !== "string" || !item.track.uri.startsWith("spotify:track:"))) return null;

      items.forEach((item, index) => {
        const track = item?.track;
        if (typeof track?.uri !== "string" || !track.uri.startsWith("spotify:track:")) {
          return;
        }
        rememberRuleFacts(track.uri, { durationMs: track.duration?.totalMilliseconds, albumUri: albumUri, name: typeof track.name === "string" ? track.name : undefined, artists: track.artists?.items?.map(artist => artist?.profile?.name).filter(Boolean).join(", ") });
        tracks.push({
          uri: track.uri,
          name: typeof track.name === "string" ? track.name : "Unknown Track",
          artists: Array.isArray(track.artists?.items)
            ? track.artists.items
                .map((artist) => artist?.profile?.name)
                .filter(Boolean)
                .join(", ")
            : "",
          artistsData: (track.artists?.items ?? []).flatMap((artist) =>
            artist?.uri?.startsWith("spotify:artist:") && artist.profile?.name
              ? [{ uri: artist.uri, name: artist.profile.name }] : []),
          discNumber: typeof track.discNumber === "number" ? track.discNumber : 1,
          trackNumber:
            typeof track.trackNumber === "number" ? track.trackNumber : offset + index + 1,
        });
      });

      const totalCount =
        typeof trackPage?.totalCount === "number" ? trackPage.totalCount : null;
      if ((totalCount !== null && offset + items.length >= totalCount) ||
        (totalCount === null && items.length < ALBUM_GRAPHQL_PAGE_SIZE)) return tracks;
      if (items.length < ALBUM_GRAPHQL_PAGE_SIZE) return null;
    }
    return null;
  };

  private getAlbumTracksFromWebApi = async (
    albumUri: string,
    options?: RequestOptions,
  ): Promise<SpotifyAlbumTrack[] | null> => {
    const albumId = this.extractAlbumId(albumUri);
    const token = this.getAccessToken();
    if (!albumId || !token) {
      return null;
    }

    try {
      const tracks: SpotifyAlbumTrack[] = [];
      for (let page = 0; page < ALBUM_TRACK_PAGE_LIMIT; page += 1) {
        const response = await spotifyFetch(
          `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50&offset=${page * 50}`,
          { headers: { Authorization: `Bearer ${token}` } }, undefined, options,
        );
        if (!response.ok) {
          return null;
        }

        const body: {
          items?: Array<{
            uri?: string;
            name?: string;
            artists?: Array<{ name?: string; uri?: string }>;
            disc_number?: number;
            track_number?: number;
            duration_ms?: number;
          }>;
          next?: string | null;
        } = await response.json();
        if (!Array.isArray(body.items) || body.items.some((track) => !track?.uri?.startsWith("spotify:track:"))) return null;
        (body.items || []).forEach((track) => {
          if (typeof track.uri === "string" && track.uri.startsWith("spotify:track:")) {
            rememberRuleFacts(track.uri, { durationMs: track.duration_ms, albumUri: `spotify:album:${albumId}`, name: track.name, artists: track.artists?.map(artist => artist.name).filter(Boolean).join(", ") });
            tracks.push({
              uri: track.uri,
              name: track.name || "Unknown Track",
              artists: (track.artists || [])
                .map((artist) => artist.name)
                .filter(Boolean)
                .join(", "),
              artistsData: (track.artists ?? []).flatMap((artist) =>
                artist.uri?.startsWith("spotify:artist:") && artist.name
                  ? [{ uri: artist.uri, name: artist.name }] : []),
              discNumber: track.disc_number ?? 1,
              trackNumber: track.track_number ?? tracks.length + 1,
            });
          }
        });
        if (!body.next) return tracks;
      }
      return null;
    } catch (error) {
      throwIfSpotifyRequestStopped(error);
      console.warn("Error fetching album tracks from Spotify Web API:", error);
      return null;
    }
  };

  /** Batch Web API reads are unavailable; the caller retains bounded cached single lookups. */
  getAlbumTrackTotals = async (_albumUris: string[], _options?: RequestOptions): Promise<Map<string, number> | null> => null;

  private getAlbumMetadataFromWebApi = async (
    albumUri: string,
    options?: RequestOptions,
  ): Promise<SpotifyPlaylistMetadata | null> => {
    try {
      const albumId = this.extractAlbumId(albumUri);
      const token = this.getAccessToken();

      if (!albumId || !token) {
        return null;
      }

      const response = await spotifyFetch(`https://api.spotify.com/v1/albums/${albumId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }, undefined, options);

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
      throwIfSpotifyRequestStopped(error);
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

  private artistMetadataCache = (() => {
    const shared = globalThis as typeof globalThis & { __tagifyArtistMetadataV1?: Map<string, { until: number; priorityToken: { current: "foreground" | "background" }; value: Promise<SpotifyArtistMetadata | null> }> };
    return shared.__tagifyArtistMetadataV1 ??= new Map();
  })();

  getArtistMetadata = async (artistUriOrId: string, options?: RequestOptions): Promise<SpotifyArtistMetadata | null> => {
    options?.assertCurrent?.();
    const artistUri = this.normalizeArtistUri(artistUriOrId), account = spotifyAccountKey();
    const key = `${account}:${artistUri}`, cached = this.artistMetadataCache.get(key);
    let value: Promise<SpotifyArtistMetadata | null>;
    if (cached && cached.until > Date.now()) {
      spotifyRequestAccounting.record(options?.feature ?? "artist-identities", "cached");
      if ((options?.priorityToken?.current ?? options?.priority) !== "background") promoteSpotifyRequest({ priorityToken: cached.priorityToken });
      value = cached.value;
    } else {
      const priorityToken = { current: options?.priorityToken?.current ?? options?.priority ?? "foreground" };
      const entry = { until: Date.now() + 10 * 60_000, priorityToken, value: Promise.resolve(null) as Promise<SpotifyArtistMetadata | null> };
      value = entry.value = this.readArtistMetadata(artistUri, { ...options, priorityToken }).then(metadata => {
        entry.until = Date.now() + (metadata ? 10 * 60_000 : 60_000);
        return metadata;
      }).catch(error => {
        if (this.artistMetadataCache.get(key) === entry) this.artistMetadataCache.delete(key);
        throw error;
      });
      this.artistMetadataCache.set(key, entry);
      while (this.artistMetadataCache.size > 200) this.artistMetadataCache.delete(this.artistMetadataCache.keys().next().value!);
    }
    const metadata = await value;
    options?.assertCurrent?.();
    if (account !== spotifyAccountKey()) throw new DOMException("Spotify account changed", "AbortError");
    return metadata ? { ...metadata, genres: [...metadata.genres] } : null;
  };

  private readArtistMetadata = async (artistUri: string, options?: RequestOptions): Promise<SpotifyArtistMetadata | null> => {
    const { GraphQL, Locale } = Spicetify;
    const definitions = [...new Set([
      GraphQL?.Definitions?.queryArtistOverview,
      GraphQL?.Definitions?.queryArtistMinimal,
      GraphQL?.Definitions?.browseArtist,
    ].filter(Boolean))];
    for (const definition of definitions) {
      try {
        const response = await requestSpicetifyGraphQL<any>(definition, {
          uri: artistUri, locale: Locale?.getLocale?.() || "en",
        }, undefined, options);
        const metadata = this.mapArtistMetadata(artistUri, this.findArtistMetadataNode(response?.data, artistUri));
        if (metadata) return metadata;
      } catch (error) {
        throwIfSpotifyRequestStopped(error);
        // Stop this lookup on transport failure; do not fan out across APIs.
        return null;
      }
    }
    return null;
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
      const contents = await spotifyRead<any>(`desktop:playlist:getContents:${JSON.stringify([playlistUri])}`, () => (
        Spicetify.Platform.PlaylistAPI as any
      ).getContents(playlistUri));

      return contents.items
        .filter((item: any) => item.uri)
        .map((item: any) => item.uri);
    } catch (error) {
      throwIfSpotifyRequestStopped(error);
      console.error("Error fetching tracks in playlist:", error);
      return [];
    }
  };

  /**
   * Fetch playlist membership without converting API failures into an empty
   * playlist. Reconciliation callers must distinguish those two states so a
   * transient Spotify failure cannot overwrite the last confirmed membership.
   */
  private membershipCache = (() => {
    const shared = globalThis as typeof globalThis & { __tagifyPlaylistMembershipV1?: Map<string, { at: number; uris: string[]; generation: string }> };
    return shared.__tagifyPlaylistMembershipV1 ??= new Map();
  })();
  getAllTrackUrisInPlaylistStrict = async (playlistId: string, maxAgeMs = 0, options?: RequestOptions): Promise<string[]> => {
    assertSpotifyWriteSettled(`spotify:playlist:${playlistId}`);
    const account = spotifyAccountKey(), resource = `spotify:playlist:${playlistId}`;
    const generation = spotifyReadGeneration(resource, account);
    const key = `${account}:${playlistId}`;
    const cached = this.membershipCache.get(key);
    if (cached && cached.generation === generation && maxAgeMs > 0 && Date.now() - cached.at < maxAgeMs) { spotifyRequestAccounting.record(options?.feature ?? "playlist-contents", "cached"); return [...cached.uris]; }
    const uris = await this.readPlaylistMembership(playlistId, options);
    if (generation === spotifyReadGeneration(resource, account)) this.membershipCache.delete(key);
    if (uris.length <= 5000 && generation === spotifyReadGeneration(resource, account)) {
      this.membershipCache.set(key, { at: Date.now(), uris, generation });
      while (this.membershipCache.size > 100 || [...this.membershipCache.values()].reduce((sum, entry) => sum + entry.uris.length, 0) > 50_000)
        this.membershipCache.delete(this.membershipCache.keys().next().value!);
    }
    return [...uris];
  };

  private versionedMembership = (() => {
    const shared = globalThis as typeof globalThis & { __tagifyPlaylistVersionsV1?: Map<string, { version: string; generation: string; at: number; uris: string[] }> };
    return shared.__tagifyPlaylistVersionsV1 ??= new Map();
  })();
  getPlaylistVersion = async (playlistId: string, options: RequestOptions): Promise<string | null> => {
    const uri = `spotify:playlist:${playlistId}`;
    try {
      const metadata = await spotifyRead<any>(`desktop:playlist:getMetadata:${JSON.stringify([uri])}`, () => (Spicetify.Platform.PlaylistAPI as any).getMetadata(uri), options);
      const version = metadata?.snapshotId ?? metadata?.snapshot_id;
      return typeof version === "string" && version.length > 0 ? version : null;
    } catch (error) { throwIfSpotifyRequestStopped(error); return null; }
  };
  /** Only automatic reads reuse versioned contents. Manual sync and write confirmations stay fresh. */
  getTrackUrisForBackgroundSync = async (playlistId: string, options: RequestOptions, knownSize: number): Promise<string[]> => {
    // Small playlists are already a single cheap read; version probes would add requests.
    if (knownSize < 200) return this.getAllTrackUrisInPlaylistStrict(playlistId, 0, options);
    const account = spotifyAccountKey(), resource = `spotify:playlist:${playlistId}`, key = `${account}:${playlistId}`;
    assertSpotifyWriteSettled(resource);
    const generation = spotifyReadGeneration(resource, account);
    const assertCurrent = () => {
      if (spotifyAccountKey() !== account) throw new DOMException("Spotify account changed", "AbortError");
      assertSpotifyWriteSettled(resource);
      if (spotifyReadGeneration(resource, account) !== generation) throw Object.assign(
        new Error("This playlist changed while it was being checked. It will be checked again."), { spotifyRequestStopped: true },
      );
    };
    const before = await this.getPlaylistVersion(playlistId, options);
    assertCurrent();
    const cached = this.versionedMembership.get(key);
    if (spotifyReadGeneration(resource, account) === generation && before && cached?.version === before && cached.generation === generation && Date.now() - cached.at < 60 * 60_000) {
      spotifyRequestAccounting.record("smart-playlists", "cached");
      return [...cached.uris];
    }
    this.versionedMembership.delete(key);
    const uris = await this.getAllTrackUrisInPlaylistStrict(playlistId, 0, options);
    assertCurrent();
    // Do not pair new contents with a version obtained before a concurrent Spotify edit.
    const after = before ? await this.getPlaylistVersion(playlistId, options) : null;
    assertCurrent();
    if (before && after && before !== after) throw Object.assign(
      new Error("This playlist changed while it was being checked. It will be checked again."), { spotifyRequestStopped: true },
    );
    if (before && before === after && uris.length <= 50_000) {
      this.versionedMembership.set(key, { version: before, generation, at: Date.now(), uris });
      while (this.versionedMembership.size > 20 || [...this.versionedMembership.values()].reduce((sum, entry) => sum + entry.uris.length, 0) > 50_000)
        this.versionedMembership.delete(this.versionedMembership.keys().next().value!);
    }
    return [...uris];
  };

  private readPlaylistMembership = async (playlistId: string, options?: RequestOptions): Promise<string[]> => {
    const contents = { items: await this.readPlaylistItems(playlistId, options) };
      trackArtistIdentitiesStore.rememberMany(contents.items.flatMap((item: { uri?: string; link?: string; artists?: Array<{ uri?: string; link?: string; name?: string }> }) => {
        const uri = item.uri ?? item.link;
        const artists = (Array.isArray(item.artists) ? item.artists : []).flatMap((artist): TrackArtist[] => {
          const artistUri = artist?.uri ?? artist?.link;
          return typeof artistUri === "string" && typeof artist?.name === "string" ? [{ uri: artistUri, name: artist.name }] : [];
        });
        return typeof uri === "string" ? [[uri, artists] as const] : [];
      }));
      contents.items.forEach((item: { uri?: string; link?: string; duration?: { milliseconds?: number; totalMilliseconds?: number }; duration_ms?: number; name?: string; artists?: Array<{ name?: string }>; album?: { uri?: string; link?: string } }) => rememberRuleFacts(item.uri ?? item.link ?? "", {
        durationMs: item.duration?.milliseconds ?? item.duration?.totalMilliseconds ?? item.duration_ms,
        albumUri: item.album?.uri ?? item.album?.link, name: item.name, artists: item.artists?.map(artist => artist.name).filter(Boolean).join(", "),
      }));
    return contents.items.map((item: any) => item.uri ?? item.link);
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
      let pages = 0;

      do {
        if (++pages > 100) throw new Error("Spotify album pagination exceeded its limit");
        const response = await spotifyFetch(
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
      throwIfSpotifyRequestStopped(error);
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
      throwIfSpotifyRequestStopped(error);
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
    const contents = await spotifyRead<any>(`desktop:rootlist:getContents:${JSON.stringify([])}`, () => (
      Spicetify.Platform.RootlistAPI as any
    ).getContents());

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

  getAllUserPlaylistReferencesStrict = async (signal?: AbortSignal): Promise<
    Array<{ playlistId: string; playlistName: string }>
  > => {
    const root = await spotifyRead<any>("desktop:rootlist:getContents:[]", () => (Spicetify.Platform.RootlistAPI as any).getContents(), { signal });
    if (!Array.isArray(root?.items)) throw new Error("Spotify did not return your playlists");
    const names = new Map<string, string>();
    const collect = (items: any[]) => {
      for (const item of items) {
        if (item.type === "playlist" && typeof item.uri === "string") names.set(item.uri.split(":").pop()!, typeof item.name === "string" ? item.name : "");
        else if (item.type === "folder" && Array.isArray(item.items)) collect(item.items);
      }
    };
    collect(root.items);
    const playlistIds = [...names.keys()];
    const references: Array<{ playlistId: string; playlistName: string } | null> = [];
    for (const playlistId of [...new Set(playlistIds)]) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (names.get(playlistId)?.trim()) { references.push({ playlistId, playlistName: names.get(playlistId)! }); continue; }
      try {
        const metadata = await spotifyRead<any>(`desktop:playlist:getMetadata:${JSON.stringify([`spotify:playlist:${playlistId}`])}`, () =>
          (Spicetify.Platform.PlaylistAPI as any).getMetadata(`spotify:playlist:${playlistId}`), { signal });
        references.push(typeof metadata?.name === "string" && metadata.name.trim()
          ? { playlistId, playlistName: metadata.name } : null);
      } catch (error) { throwIfSpotifyRequestStopped(error); }
    }

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
      const metadata = await spotifyRead<any>(`desktop:playlist:getMetadata:${JSON.stringify([playlistUri])}`, () => (
        Spicetify.Platform.PlaylistAPI as any
      ).getMetadata(playlistUri));
      return metadata?.totalLength || 0;
    } catch (error) {
      throwIfSpotifyRequestStopped(error);
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

    for (const playlistId of new Set(playlistIds)) {
      counts[playlistId] = await this.getPlaylistTrackCount(playlistId);
    }

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
    trackUri: string, options?: RequestOptions
  ): Promise<TrackAudioFeaturesResult> => {
    const trackId = this.extractTrackId(trackUri);
    if (!trackId) {
      return {
        bpm: null,
        camelotKey: null,
      };
    }

    const features = await audioFeaturesService.getAudioFeaturesByTrackId(trackId, options);

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

  /** A reconciliation pass reads once, writes in bounded batches, then its caller confirms. */
  updatePlaylistTracks = async (playlistId: string, additions: string[], removals: string[], knownMembership?: string[], options?: PlaylistTrackUpdateOptions) => {
    const account = spotifyAccountKey();
    const suppliedCheck = options?.assertCurrent;
    options = { ...options, assertCurrent: () => {
      suppliedCheck?.();
      if (spotifyAccountKey() !== account) throw new DOMException("Spotify account changed", "AbortError");
    } };
    const added: string[] = [], removed: string[] = [];
    this.membershipCache.delete(`${spotifyAccountKey()}:${playlistId}`);
    const uri = `spotify:playlist:${playlistId}`;
    const api = Spicetify.Platform.PlaylistAPI as any;
    try {
      assertSpotifyWriteSettled(uri);
      const membership = new Set(knownMembership ?? (additions.length ? await this.getAllTrackUrisInPlaylistStrict(playlistId, 0, options) : []));
      if (removals.length) {
        const contents = { items: (await this.readPlaylistItems(playlistId, options)).map(item => ({ uri: item.uri ?? item.link, uid: item.uid })) };
        const removing = new Set(removals);
        const items = contents.items.filter((item: any) => removing.has(item.uri));
        if (items.some((item: any) => !item.uid)) throw new Error("Spotify did not identify the songs to remove");
        const occurrences = new Map<string, number>();
        items.forEach((item: any) => occurrences.set(item.uri, (occurrences.get(item.uri) ?? 0) + 1));
        for (let index = 0; index < items.length; index += 100) {
          const batch = items.slice(index, index + 100).map((item: any) => ({ uri: item.uri, uid: item.uid }));
          await spotifyWrite(async signal => {
            await options?.beforeWrite?.([...new Set(batch.map((item: { uri: string }) => item.uri))], "remove");
            signal.throwIfAborted();
            options?.assertCurrent?.();
            return api.remove(uri, batch);
          }, { ...options, resource: uri });
          for (const item of batch) {
            const left = occurrences.get(item.uri)! - 1;
            occurrences.set(item.uri, left);
            if (!left) removed.push(item.uri);
          }
        }
      }
      const missing = [...new Set(additions)].filter(track => track.startsWith("spotify:track:") && !membership.has(track));
      for (let index = 0; index < missing.length; index += 100) {
        const batch = missing.slice(index, index + 100);
        await spotifyWrite(async signal => {
          await options?.beforeWrite?.(batch, "add");
          signal.throwIfAborted();
          options?.assertCurrent?.();
          if (options?.feature === "smart-playlists") rememberPlaylistAdditions(playlistId, batch);
          return api.add(uri, batch, { after: "end" });
        }, { ...options, resource: uri });
        added.push(...batch);
      }
      this.membershipCache.delete(`${spotifyAccountKey()}:${playlistId}`);
      return { added: [...new Set(added)], removed: [...new Set(removed)], success: true };
    } catch (error) {
      // Preserve confirmed batches; never retry an ambiguous mutation in this pass.
      console.warn("Spotify playlist update stopped", error);
      this.membershipCache.delete(`${spotifyAccountKey()}:${playlistId}`);
      return { added: [...new Set(added)], removed: [...new Set(removed)], success: false };
    }
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

      await spotifyWrite(() => (Spicetify.Platform.PlaylistAPI as any).add(
        playlistUri,
        [trackUri],
        { after: "end" }
      ), { resource: playlistUri });

      return { success: true, wasAdded: true };
    } catch (error) {
      console.error("Error adding track to playlist:", error);
      return { success: false, wasAdded: false };
    }
  };

  /**
   * Remove track from playlist using Platform API
   */
  removeTrackFromPlaylist = async (trackUri: string, playlistId: string): Promise<boolean> => {
    const result = await this.updatePlaylistTracks(playlistId, [], [trackUri]);
    return result.success && result.removed.includes(trackUri);
  };

  private readPlaylistItems = async (playlistId: string, options?: RequestOptions): Promise<any[]> => {
    const uri = `spotify:playlist:${playlistId}`;
    assertSpotifyWriteSettled(uri);
    const api = Spicetify.Platform.PlaylistAPI as any;
    const items: any[] = [];
    const account = spotifyAccountKey();
    let snapshot: string | undefined;
    const seenPages = new Set<string>();
    let total: number | undefined;
    for (let page = 0; page < 1000; page++) {
      if (account !== spotifyAccountKey()) throw new DOMException("Spotify account changed", "AbortError");
      options?.assertCurrent?.();
      const offset = items.length;
      const args = page === 0 ? [uri] : [uri, { offset, limit: 100 }];
      const result = await spotifyRead<any>(`desktop:playlist:getContents:${JSON.stringify(args)}`, () => api.getContents(...args), options);
      if (!Array.isArray(result?.items) || result.items.some((item: any) => typeof (item?.uri ?? item?.link) !== "string"))
        throw new Error("Spotify returned incomplete playlist occurrences");
      if (result.offset !== undefined && result.offset !== offset) throw new Error("Spotify repeated a playlist page");
      const currentTotal = typeof result.totalLength === "number" ? result.totalLength : undefined;
      if (total !== undefined && currentTotal !== undefined && currentTotal !== total) throw new Error("Spotify playlist changed during pagination");
      if (currentTotal !== undefined && (!Number.isSafeInteger(currentTotal) || currentTotal < 0)) throw new Error("Spotify returned an invalid playlist size");
      total ??= currentTotal;
      const currentSnapshot = result.snapshotId ?? result.snapshot_id;
      if (snapshot && currentSnapshot && snapshot !== currentSnapshot) throw new Error("Spotify playlist changed during pagination");
      if (typeof currentSnapshot === "string") snapshot ??= currentSnapshot;
      const signature = JSON.stringify(result.items.map((item: any) => [item.uri ?? item.link, item.uid]));
      if (seenPages.has(signature)) throw new Error("Spotify repeated a playlist page");
      seenPages.add(signature);
      for (const item of result.items) items.push(item);
      if (total === undefined || items.length === total) return items;
      if (items.length > total || !result.items.length) throw new Error("Spotify playlist pagination stopped unexpectedly");
    }
    throw new Error("Spotify playlist check exceeded its page limit");
  };

  /** Collect stable occurrence IDs before deleting so pagination cannot skip shifted rows. */
  removeDuplicatePlaylistOccurrences = async (playlistId: string, options?: RequestOptions): Promise<number> => {
    const playlistUri = `spotify:playlist:${playlistId}`;
    const api = Spicetify.Platform.PlaylistAPI as any;
    const items = (await this.readPlaylistItems(playlistId, options)).map(item => ({ uri: item.uri ?? item.link, uid: item.uid }));
    const seen = new Set<string>();
    const duplicates = items.filter(item => {
      if (seen.has(item.uri)) return true;
      seen.add(item.uri);
      return false;
    });
    if (duplicates.some(item => !item.uid)) throw new Error("Spotify could not identify the duplicate songs. Please try again.");
    for (let index = 0; index < duplicates.length; index += 100) {
      await spotifyWrite(() => api.remove(playlistUri, duplicates.slice(index, index + 100)), { ...options, resource: playlistUri });
    }
    return duplicates.length;
  };
}

export const spotifyApiService = new SpotifyApiService();
