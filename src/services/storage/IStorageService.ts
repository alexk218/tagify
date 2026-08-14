import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";

/**
 * Abstract storage interface for tag data persistence.
 * Allows swapping storage backends (localStorage, IndexedDB, etc.)
 * without changing consuming code.
 */
export interface IStorageService {
  /**
   * Initialize the storage backend. Must be called before any other operations.
   * @returns true if initialization succeeded
   */
  init(): Promise<boolean>;

  /**
   * Check if storage has been initialized and contains data
   */
  isInitialized(): Promise<boolean>;

  /**
   * Load all tag data (taxonomy + all tracks)
   */
  loadAll(): Promise<TagDataStructure | null>;

  /**
   * Save all tag data (full replacement)
   */
  saveAll(data: TagDataStructure): Promise<boolean>;

  /**
   * Get the taxonomy document only
   */
  getTaxonomy(): Promise<TagTaxonomy>;

  /**
   * Save taxonomy (replaces all taxonomy entities)
   */
  saveTaxonomy(taxonomy: TagTaxonomy): Promise<boolean>;

  /**
   * Get a single track by URI
   */
  getTrack(uri: string): Promise<TrackData | null>;

  /**
   * Save/update a single track
   */
  saveTrack(uri: string, data: TrackData): Promise<boolean>;

  /**
   * Delete a single track
   */
  deleteTrack(uri: string): Promise<boolean>;

  /**
   * Get multiple tracks by URIs
   */
  getTracks(uris: string[]): Promise<Map<string, TrackData>>;

  /**
   * Save multiple tracks in a single transaction
   */
  saveTracks(tracks: Map<string, TrackData>): Promise<boolean>;

  /**
   * Get a single playlist by URI
   */
  getPlaylist(uri: string): Promise<PlaylistData | null>;

  /**
   * Save/update a single playlist
   */
  savePlaylist(uri: string, data: PlaylistData): Promise<boolean>;

  /**
   * Delete a single playlist
   */
  deletePlaylist(uri: string): Promise<boolean>;

  /**
   * Save multiple playlists in a single transaction
   */
  savePlaylists(playlists: Map<string, PlaylistData>): Promise<boolean>;

  /**
   * Get a single artist by URI
   */
  getArtist(uri: string): Promise<ArtistData | null>;

  /**
   * Save/update a single artist
   */
  saveArtist(uri: string, data: ArtistData): Promise<boolean>;

  /**
   * Delete a single artist
   */
  deleteArtist(uri: string): Promise<boolean>;

  /**
   * Save multiple artists in a single transaction
   */
  saveArtists(artists: Map<string, ArtistData>): Promise<boolean>;

  /**
   * Get all track URIs
   */
  getAllTrackUris(): Promise<string[]>;

  /**
   * Get total track count
   */
  getTrackCount(): Promise<number>;

  /**
   * Get total playlist count
   */
  getPlaylistCount(): Promise<number>;

  /**
   * Get total artist count
   */
  getArtistCount(): Promise<number>;

  /**
   * Clear all data (use with caution)
   */
  clearAll(): Promise<boolean>;

  /**
   * Get storage metadata (for debugging/diagnostics)
   */
  getMetadata(): Promise<StorageMetadata>;
}

export interface StorageMetadata {
  backend: "indexeddb" | "localstorage" | "memory";
  trackCount: number;
  playlistCount: number;
  artistCount: number;
  categoryCount: number;
  lastModified: number | null;
  estimatedSizeBytes: number | null;
}
