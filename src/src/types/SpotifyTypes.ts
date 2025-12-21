/**
 * Simplified track interface for internal use in the app
 */
export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string };
  duration_ms: number;
}

/**
 * Spicetify history location interface for navigation state
 */
export interface SpicetifyHistoryLocation {
  pathname: string;
  search?: string;
  state?: {
    trackUri?: string;
    trackUris?: string[];
    [key: string]: any;
  };
}

/**
 * Spotify album artwork image
 */
export interface SpotifyImage {
  url: string;
  width: number;
  height: number;
}

/**
 * External URLs for Spotify entities
 * @example { spotify: "https://open.spotify.com/track/..." }
 */
export interface SpotifyExternalUrls {
  spotify: string;
  /** Additional external URLs that may be present */
  [key: string]: string;
}

/**
 * External identifiers for tracks
 * Based on observed API responses - may contain additional fields
 */
export interface SpotifyExternalIds {
  /** International Standard Recording Code */
  isrc?: string;
  /** Allow for other external IDs we haven't encountered yet */
  [key: string]: string | undefined;
}

/**
 * Spotify artist object from API responses
 * Conservative typing based on actual API responses
 */
export interface SpotifyArtist {
  external_urls: SpotifyExternalUrls;
  href: string;
  id: string;
  name: string;
  /** Observed: "artist" - using string for flexibility */
  type: string;
  uri: string;
}

/**
 * Spotify album object from track API responses
 * Field types based on actual API responses, not documentation assumptions
 */
export interface SpotifyAlbum {
  /** Observed: "single" - likely also "album", "compilation" */
  album_type: string;
  artists: SpotifyArtist[];
  available_markets: string[];
  external_urls: SpotifyExternalUrls;
  href: string;
  id: string;
  /** Album artwork in multiple sizes */
  images: SpotifyImage[];
  name: string;
  /** Format: YYYY-MM-DD or YYYY-MM or YYYY */
  release_date: string;
  /** Observed: "day" - likely also "month", "year" */
  release_date_precision: string;
  total_tracks: number;
  /** Observed: "album" */
  type: string;
  uri: string;
}

/**
 * Complete Spotify track response from /v1/tracks/{id} endpoint
 * Matches actual Spicetify CosmosAsync.get() response structure
 */
export interface SpotifyTrackResponse {
  album: SpotifyAlbum;
  artists: SpotifyArtist[];
  available_markets: string[];
  disc_number: number;
  duration_ms: number;
  explicit: boolean;
  external_ids: SpotifyExternalIds;
  external_urls: SpotifyExternalUrls;
  href: string;
  id: string;
  is_local: boolean;
  name: string;
  /** Track popularity score 0-100 */
  popularity: number;
  /** 30-second preview URL */
  preview_url: string;
  track_number: number;
  /** Observed: "track" */
  type: string;
  uri: string;
}

/**
 * Response from Spotify Web API /v1/tracks endpoint (batch request)
 * Wraps multiple track responses in a tracks array
 */
export interface SpotifyBatchTracksResponse {
  tracks: (SpotifyTrackResponse | null)[];
}

export interface SpotifyPlaylistTrackItem {
  track: {
    uri: string;
  } | null;
}

export interface SpotifyPlaylistTracksResponse {
  items: SpotifyPlaylistTrackItem[];
  total: number;
}

export interface SpotifyUserPlaylistsResponse {
  items: SpotifyPlaylistItem[];
  total: number;
}

export interface SpotifyPlaylistItem {
  id: string;
}

export interface SpotifyPlaylistTracksCountResponse {
  total: number;
}

export interface SpotifyTrackAudioFeaturesResponse {
  acousticness: number;
  danceability: number;
  duration_ms: number;
  energy: number;
  instrumentalness: number;
  key: number;
  mode: number;
  speechiness: number;
  tempo: number;
  type: string;
  valence: number;
}
