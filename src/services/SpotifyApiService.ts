import { rememberPlaylistAdditions } from "./SpotifyPlaylistWriteOrigins";
import { spotifyRequestAccounting } from "@/utils/spotifyRequestAccounting";
import type { RequestOptions } from "@/utils/RateLimiter";
import { spotifyFetch, spotifyRead, spotifyWrite, spotifyAccountKey, promoteSpotifyRequest, spotifyReadGeneration, assertSpotifyWriteSettled, throwIfSpotifyRequestStopped } from "./SpotifyRequests";
import { rememberRuleFacts } from "@/features/automatic-tags/facts";
import { normalizeRecordingIdentity } from "@/features/recording-reuse/utils/recordingReuse";
import { normalizeQueuePage } from "@/features/track-session/utils/taggingQueue.logic";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
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

/** Spotify's desktop Liked Songs calls (checked live on 2026-10-19; SPOTIFY_ENDPOINT_POLICY.md). */
interface DesktopLikedSongs {
  contains(...uris: string[]): Promise<unknown>;
  add(options: { uris: string[] }): Promise<unknown>;
}
const desktopLikedSongs = () => Spicetify.Platform.LibraryAPI as unknown as DesktopLikedSongs;

class SpotifyApiService {
  private playlistReadsBlockedUntil = 0;
  private getAccessToken(): string | null {
    return (
      Spicetify.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken ||
      (Spicetify.Platform.PlaylistAPI as any)?._builder?._accessToken ||
      null
    );
  }

  /**
   * Recording identity (ISRC, artists, length) from Spotify's desktop metadata.
   * The Web API answers desktop sign-ins with 429 on every route (see
   * SPOTIFY_ENDPOINT_POLICY.md), so there is no Web API fallback. A song the
   * desktop metadata can't describe has no identity for now and is retried later.
   */
  getRecordingIdentity = async (uri: string, signal?: AbortSignal, options?: RequestOptions) => {
    const value = await this.readTrackMetadata(uri, signal, options);
    if (!value) return undefined;
    return normalizeRecordingIdentity({
      isrc: value.external_id?.find((entry: { type?: string }) => entry.type?.toLowerCase() === "isrc")?.id?.toUpperCase(),
      artistIds: value.artist?.map((artist: { gid?: string }) =>
        typeof artist.gid === "string" && /^[a-f0-9]{32}$/i.test(artist.gid) ? Spicetify.URI.hexToId(artist.gid) : undefined),
      durationMs: value.duration, name: value.name,
    });
  };

  /**
   * A song's ISRC and the album Spotify files it under, from the same desktop
   * metadata as getRecordingIdentity (one request, no Web API). `isrc` is null
   * when Spotify lists none; `albumUri` is null when the answer names no album.
   * Undefined when Spotify can't describe the song right now.
   */
  getTrackRelease = async (uri: string, options?: RequestOptions): Promise<{ isrc: string | null; albumUri: string | null } | undefined> => {
    const value = await this.readTrackMetadata(uri, undefined, options);
    if (!value) return undefined;
    const isrc = Array.isArray(value.external_id)
      ? value.external_id.find((entry: { type?: unknown }) => typeof entry?.type === "string" && entry.type.toLowerCase() === "isrc")?.id
      : undefined;
    const albumGid = value.album?.gid;
    const albumId = typeof albumGid === "string" && /^[a-f0-9]{32}$/i.test(albumGid) ? Spicetify.URI.hexToId(albumGid) : undefined;
    return {
      isrc: typeof isrc === "string" ? isrc : null,
      albumUri: typeof albumId === "string" && /^[A-Za-z0-9]{22}$/.test(albumId) ? `spotify:album:${albumId}` : null,
    };
  };

  /** Spotify's desktop metadata for one song, or undefined when Spotify can't describe it. */
  private readTrackMetadata = async (uri: string, signal?: AbortSignal, options?: RequestOptions): Promise<any | undefined> => {
    const id = uri.match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1];
    if (!id) throw new Error("Recording matching is available for Spotify songs.");
    const token = this.getAccessToken();
    if (!token) throw new Error("Sign in to Spotify again to check this recording.");
    if (!Spicetify.URI?.idToHex || !Spicetify.URI?.hexToId) throw new Error("Spotify couldn't check this recording. Wait a moment, then try again.");
    const hex = Spicetify.URI.idToHex(id);
    if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error("Spotify couldn't check this recording. Wait a moment, then try again.");
    const response = await spotifyFetch(`https://spclient.wg.spotify.com/metadata/4/track/${hex}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal,
    }, undefined, options);
    // A 429 throws inside spotifyFetch and pauses requests; other failures mean no answer yet.
    if (!response.ok) return undefined;
    const value = await response.json();
    if (typeof value?.gid !== "string" || value.gid.toLowerCase() !== hex.toLowerCase()) return undefined;
    return value;
  };

  getTaggingQueuePage = async (playlistId: string | null, offset = 0, signal?: AbortSignal) => {
    const limit = 50;
    if (Date.now() < this.playlistReadsBlockedUntil) throw new Error("Spotify needs a short break. Wait a moment, then check more tracks.");
    let native: any;
    try {
      native = playlistId
        ? await spotifyRead<any>(`desktop:playlist:getContents:${JSON.stringify([`spotify:playlist:${playlistId}`,{ offset, limit }])}`, () => (Spicetify.Platform.PlaylistAPI as any).getContents(`spotify:playlist:${playlistId}`, { offset, limit }), { signal })
        : await spotifyRead<any>(`desktop:library:getTracks:${JSON.stringify([{ offset, limit }])}`, () => (Spicetify.Platform.LibraryAPI as any).getTracks({ offset, limit }), { signal });
    } catch (error) {
      throwIfSpotifyRequestStopped(error);
      if (signal?.aborted) throw error;
      if ((error as any)?.status === 429) {
        this.playlistReadsBlockedUntil = Date.now() + 60_000;
        throw new Error("Spotify needs a short break. Wait a moment, then check more tracks.");
      }
      throw new Error("Spotify couldn't check those tracks. Make sure you're online and can open this library, then try again.");
    }
    // PlaylistAPI pages by offset but always reports offset 0 (Spotify 1.2.92), so
    // only a different non-zero offset is evidence of a wrong page. The queue
    // also stops when a page repeats the previous one.
    const reportedOffset = typeof native?.offset === "number" && !(playlistId && native.offset === 0) ? native.offset : offset;
    if (!Array.isArray(native?.items) || native.items.length > limit || reportedOffset !== offset) {
      throw new Error("Spotify couldn't check those tracks. Make sure you're online and can open this library, then try again.");
    }
    return normalizeQueuePage(native, offset);
  };

  /**
   * A new playlist through Spotify's desktop API (the Web API rejects desktop
   * sign-ins), with the description and privacy the user chose. Spotify makes new
   * playlists public, so one that could not be made private is removed again
   * rather than left public.
   */
  createPlaylist = async (name: string, { description = "", isPublic = false }: { description?: string; isPublic?: boolean } = {}): Promise<string> => {
    const rootlist = Spicetify.Platform.RootlistAPI as any, playlists = Spicetify.Platform.PlaylistAPI as any;
    const permissions = (Spicetify.Platform as any).PlaylistPermissionsAPI;
    if (typeof rootlist?.createPlaylist !== "function" || (!isPublic && (typeof permissions?.setBasePermission !== "function" || typeof permissions?.getBasePermission !== "function"))) {
      throw new Error("Spotify needs an update before Tagify can create playlists. Update Spotify, then try again.");
    }
    let uri: unknown;
    try {
      uri = await spotifyWrite(() => rootlist.createPlaylist(name, { before: "start" }), { feature: "playlist-details" });
    } catch (error) {
      throwIfSpotifyRequestStopped(error);
      throw new Error("Spotify didn’t confirm whether your playlist was created. Check your Spotify library before trying again.");
    }
    const id = typeof uri === "string" ? uri.match(/^spotify:playlist:([^:/?#\s]+)$/)?.[1] : undefined;
    if (!id) throw new Error("Spotify couldn’t create your playlist. Check that Spotify is online and signed in, then try again.");
    const playlistUri = `spotify:playlist:${id}`;
    if (!isPublic) {
      try {
        // A brand-new playlist ignores the first privacy change, so confirm it and retry briefly.
        let privacy: unknown;
        for (let attempt = 0; attempt < 6 && privacy !== "BLOCKED"; attempt++) {
          if (attempt) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
          await spotifyWrite(() => permissions.setBasePermission(playlistUri, "BLOCKED"), { resource: playlistUri, feature: "playlist-details" });
          privacy = await spotifyRead(`desktop:permissions:getBasePermission:${JSON.stringify([playlistUri, attempt])}`, () => permissions.getBasePermission(playlistUri), { resource: playlistUri, feature: "playlist-details" });
        }
        if (privacy !== "BLOCKED") throw new Error("Playlist stayed public");
      } catch (error) {
        const removed = await spotifyWrite(() => rootlist.remove([{ uri: playlistUri }]), { feature: "playlist-details" }).then(() => true, () => false);
        if (!removed) throw new Error(`Spotify created “${name}” but couldn’t make it private. Make it private or delete it in Spotify, then try again.`);
        throwIfSpotifyRequestStopped(error);
        throw new Error("Spotify couldn’t make the new playlist private, so Tagify removed it. Try again in a moment.");
      }
    }
    if (description) {
      // The description is optional detail; the playlist is already usable.
      await spotifyWrite(() => playlists.updateDetails(playlistUri, { description }), { resource: playlistUri, feature: "playlist-details" }).catch(() => {});
    }
    return id;
  };

  createPrivatePlaylist = (name: string, description = ""): Promise<string> => this.createPlaylist(name, { description, isPublic: false });

  /**
   * Whether a playlist is still in the member's library and theirs to change. Spotify keeps a
   * deleted playlist readable, so deletion shows as `isSaved: false`.
   */
  ownPlaylistState = async (playlistId: string): Promise<"mine" | "gone"> => {
    const uri = `spotify:playlist:${playlistId}`;
    const metadata = await spotifyRead<any>(`desktop:playlist:getMetadata:${JSON.stringify([uri])}`, () => (Spicetify.Platform.PlaylistAPI as any).getMetadata(uri), { resource: uri, feature: "playlist-details" });
    if (!metadata || typeof metadata !== "object") throw new Error("Spotify didn't describe the playlist");
    return metadata.isOwnedBySelf === true && metadata.isSaved === true && metadata.canEditItems !== false ? "mine" : "gone";
  };

  /** Renames a playlist and sets its description through Spotify's desktop app. */
  updatePlaylistDetails = async (playlistId: string, details: { name: string; description: string }): Promise<void> => {
    const uri = `spotify:playlist:${playlistId}`;
    await spotifyWrite(() => (Spicetify.Platform.PlaylistAPI as any).updateDetails(uri, details), { resource: uri, feature: "playlist-details" });
  };

  /**
   * Leaves a playlist holding exactly `uris`, in order, through Spotify's desktop app. Songs that
   * already start the playlist in the right order stay; everything after them is removed (by
   * occurrence) and the rest added at the end, then the result is read back and checked.
   */
  replacePlaylistTracks = async (playlistId: string, uris: string[], options?: RequestOptions): Promise<void> => {
    const uri = `spotify:playlist:${playlistId}`;
    const api = Spicetify.Platform.PlaylistAPI as any;
    options = { feature: "playlist-contents", ...options };
    this.membershipCache.delete(`${spotifyAccountKey()}:${playlistId}`);
    try {
      const current = (await this.readPlaylistItems(playlistId, options)).map(item => ({ uri: (item.uri ?? item.link) as string, uid: item.uid as string | undefined }));
      let keep = 0;
      while (keep < current.length && keep < uris.length && current[keep].uri === uris[keep]) keep++;
      const removing = current.slice(keep);
      if (removing.some(item => !item.uid)) throw new Error("Spotify did not identify the songs to remove");
      for (let index = 0; index < removing.length; index += 100) {
        const batch = removing.slice(index, index + 100).map(item => ({ uri: item.uri, uid: item.uid }));
        await spotifyWrite(() => api.remove(uri, batch), { ...options, resource: uri });
      }
      const adding = uris.slice(keep);
      for (let index = 0; index < adding.length; index += 100) {
        const batch = adding.slice(index, index + 100);
        await spotifyWrite(() => api.add(uri, batch, { after: "end" }), { ...options, resource: uri });
      }
      if (!removing.length && !adding.length) return;
      const written = (await this.readPlaylistItems(playlistId, options)).map(item => item.uri ?? item.link);
      if (written.length !== uris.length || written.some((value, index) => value !== uris[index])) throw new Error("Spotify didn't keep the playlist's songs in order");
    } finally {
      this.membershipCache.delete(`${spotifyAccountKey()}:${playlistId}`);
    }
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
      console.warn("PlaylistAPI metadata lookup failed:", error);
    }

    return null;
  };

  /**
   * Album details from Spotify's own album lookup. The Web API answers desktop
   * sign-ins with 429 on every route, and each 429 pauses every Tagify request,
   * so there is no Web API fallback (see SPOTIFY_ENDPOINT_POLICY.md).
   */
  private getAlbumMetadata = async (
    albumUri: string,
    options?: RequestOptions,
  ): Promise<SpotifyPlaylistMetadata | null> => this.getAlbumMetadataFromGraphQL(albumUri, undefined, options);

  /** Album details from Spotify's own client API, the same lookup Spotify's album page uses. */
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
   * An album's artists (IDs and names) from Spotify's own client API, the
   * main artist first. Empty when Spotify lists none; there is no Web API fallback.
   */
  getAlbumArtists = async (albumUri: string, options?: RequestOptions): Promise<Array<{ uri: string; name: string }>> => {
    const { GraphQL, Locale } = Spicetify;
    const definition = GraphQL?.Definitions?.getAlbum || GraphQL?.Definitions?.albumMetadata;
    if (!definition) return [];
    const response = await requestSpicetifyGraphQL<{ data?: unknown }>(definition, {
      uri: albumUri, locale: Locale?.getLocale?.() || "en", offset: 0, limit: 1,
    }, undefined, options);
    const album = this.findAlbumMetadataNode(response?.data, albumUri);
    const items: unknown = album?.artists?.items ?? album?.albumArtists?.items ?? [];
    return (Array.isArray(items) ? items : []).flatMap((artist: { uri?: unknown; profile?: { name?: unknown }; name?: unknown }) => {
      const name = artist?.profile?.name ?? artist?.name;
      return typeof artist?.uri === "string" && artist.uri.startsWith("spotify:artist:") && typeof name === "string" ? [{ uri: artist.uri, name }] : [];
    });
  };

  /**
   * What Spotify's own client API says about a release: its name, kind
   * (ALBUM, SINGLE, EP or COMPILATION), release date and cover, unchecked.
   * One getAlbum request; null when Spotify can't describe this album.
   */
  getAlbumRelease = async (albumUri: string, options?: RequestOptions): Promise<{ name: unknown; type: unknown; date: unknown; coverSources: unknown } | null> => {
    const { GraphQL, Locale } = Spicetify;
    const definition = GraphQL?.Definitions?.getAlbum;
    if (!definition) return null;
    const response = await requestSpicetifyGraphQL<{ data?: unknown }>(definition, {
      uri: albumUri, locale: Locale?.getLocale?.() || "en", offset: 0, limit: 1,
    }, undefined, options);
    const album = this.findAlbumMetadataNode(response?.data, albumUri);
    // Never describe one release with another's details.
    if (!album || album.uri !== albumUri) return null;
    return { name: album.name, type: album.type, date: album.date, coverSources: album.coverArt?.sources };
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
   * An album's tracks in album order from Spotify's own client API. Null when
   * Spotify cannot say; there is no Web API fallback (see getAlbumMetadata).
   */
  getAlbumTracks = async (albumUri: string, options?: RequestOptions): Promise<SpotifyAlbumTrack[] | null> => {
    const tracks = await this.getAlbumTracksFromGraphQL(albumUri, options)
      .catch((error) => { throwIfSpotifyRequestStopped(error); return null; });
    return tracks?.length ? tracks : null;
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

  /** Batch Web API reads are unavailable; the caller retains bounded cached single lookups. */
  getAlbumTrackTotals = async (_albumUris: string[], _options?: RequestOptions): Promise<Map<string, number> | null> => null;

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


  /** All track URIs in an album from Spotify's own client API (see getAlbumMetadata). */
  getAllTrackUrisInAlbum = async (albumUriOrId: string): Promise<string[]> =>
    this.getAllTrackUrisInAlbumFromGraphQL(albumUriOrId);

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

  /** Every playlist in the member's library, in Spotify's order, with the folders it sits in. */
  getAllUserPlaylistReferencesStrict = async (signal?: AbortSignal): Promise<RootlistPlaylist[]> => {
    const root = await spotifyRead<any>("desktop:rootlist:getContents:[]", () => (Spicetify.Platform.RootlistAPI as any).getContents(), { signal });
    if (!Array.isArray(root?.items)) throw new Error("Spotify did not return your playlists");
    const references: Array<RootlistPlaylist | null> = [];
    for (const playlist of rootlistPlaylists(root.items)) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (playlist.playlistName.trim()) { references.push(playlist); continue; }
      try {
        const metadata = await spotifyRead<any>(`desktop:playlist:getMetadata:${JSON.stringify([`spotify:playlist:${playlist.playlistId}`])}`, () =>
          (Spicetify.Platform.PlaylistAPI as any).getMetadata(`spotify:playlist:${playlist.playlistId}`), { signal });
        references.push(typeof metadata?.name === "string" && metadata.name.trim()
          ? { ...playlist, playlistName: metadata.name } : null);
      } catch (error) { throwIfSpotifyRequestStopped(error); }
    }

    return references.filter((reference): reference is RootlistPlaylist => reference !== null);
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

  /** Whether each song is in the member's Liked Songs, read fresh from Spotify's desktop app. */
  likedSongsContain = async (uris: string[]): Promise<boolean[]> => {
    const flags = await spotifyRead<unknown>(`desktop:library:contains:${JSON.stringify(uris)}`, () => desktopLikedSongs().contains(...uris), { feature: "library" });
    if (!Array.isArray(flags) || flags.length !== uris.length) throw new Error("Spotify couldn't check your Liked Songs");
    return flags.map(Boolean);
  };

  /** Saves songs to the member's Liked Songs through Spotify's desktop app, never the Web API. */
  saveToLikedSongs = async (uris: string[]): Promise<void> => {
    await spotifyWrite(() => desktopLikedSongs().add({ uris }), { feature: "library" });
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

  /** Every song in a playlist through the desktop API (strict pagination), for Tagify Community's lists. */
  readPlaylistTracks = async (playlistId: string, options?: RequestOptions): Promise<SpotifyTrack[]> => {
    const items = await this.readPlaylistItems(playlistId, { feature: "playlist-contents", priority: "background", ...options });
    return normalizeQueuePage({ items, totalLength: items.length }, 0).tracks;
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

/** A Spotify playlist folder: Spotify's own ID for it (never the account name in its address) and its name. */
export interface RootlistFolder { id: string; name: string }
/** A playlist in the member's library, with the folders it sits in, outermost first (only where Tagify read them). */
export interface RootlistPlaylist { playlistId: string; playlistName: string; folders?: RootlistFolder[] }

const ROOTLIST_FOLDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A folder's ID: Spotify's `hash` for it, or the part of its address after ":folder:". */
function rootlistFolderId(item: { hash?: unknown; uri?: unknown }): string | null {
  if (typeof item.hash === "string" && ROOTLIST_FOLDER_ID.test(item.hash)) return item.hash;
  const match = typeof item.uri === "string" ? /:folder:([A-Za-z0-9_-]{1,64})(?::|$)/.exec(item.uri) : null;
  return match ? match[1] : null;
}

/**
 * The playlists in Spotify's library tree (RootlistAPI.getContents), in Spotify's order, each with
 * the folders it sits in, outermost first. A playlist listed twice keeps its first place. A folder
 * Tagify can't identify is left out, and its playlists sit in the folder around it.
 */
export function rootlistPlaylists(items: unknown[]): Array<Required<RootlistPlaylist>> {
  const found = new Map<string, Required<RootlistPlaylist>>();
  const visit = (nodes: unknown[], folders: RootlistFolder[]) => {
    for (const node of nodes) {
      const item = node as { type?: unknown; uri?: unknown; name?: unknown; items?: unknown; hash?: unknown } | null;
      if (!item) continue;
      if (item.type === "playlist" && typeof item.uri === "string") {
        const playlistId = item.uri.split(":").pop()!;
        if (!found.has(playlistId)) found.set(playlistId, { playlistId, playlistName: typeof item.name === "string" ? item.name : "", folders });
      } else if (item.type === "folder" && Array.isArray(item.items)) {
        const id = rootlistFolderId(item);
        const inside = id && !folders.some((folder) => folder.id === id) ? [...folders, { id, name: typeof item.name === "string" ? item.name : "" }] : folders;
        visit(item.items, inside);
      }
    }
  };
  visit(items, []);
  return [...found.values()];
}
