import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";
import { IStorageService, StorageMetadata } from "./IStorageService";
import { normalizeTagDataStructure } from "@/features/tag-data/utils/tagData.schema";
import {
  buildCategoryTree,
  createEmptyTaxonomy,
  TAG_DATA_SCHEMA_VERSION,
} from "@/utils/tagTaxonomy";

const DB_NAME = "tagify-db";
const DB_VERSION = 5;

// Object store names
const STORES = {
  TRACKS: "tracks",
  PLAYLISTS: "playlists",
  ARTISTS: "artists",
  CATEGORIES: "categories",
  METADATA: "metadata",
} as const;

// Metadata keys
const META_KEYS = {
  LAST_MODIFIED: "lastModified",
  VERSION: "version",
} as const;

const CATEGORY_DOCUMENT_KEYS = {
  TAXONOMY: "taxonomy",
  LEGACY_CATEGORIES: "categories",
} as const;

/**
 * IndexedDB implementation of the storage service.
 *
 * Schema:
 * - tracks: { uri (key), ...TrackData }
 * - categories: { id: "categories", data: TagCategory[] }
 * - metadata: { key, value }
 *
 * Indexes on tracks:
 * - by-rating: for filtering by star rating
 * - by-energy: for filtering by energy level
 * - by-dateModified: for sorting by last modified
 * - by-bpm: for filtering by BPM
 * - by-camelot-key: for filtering by Camelot key
 */
export class IndexedDBStorageService implements IStorageService {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<boolean> | null = null;

  async init(): Promise<boolean> {
    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.isConnectionHealthy()) {
      return true;
    }

    this.initPromise = this.openDatabase();
    const result = await this.initPromise;
    this.initPromise = null;
    return result;
  }

  private openDatabase(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
          console.error("IndexedDB: Failed to open database", event);
          resolve(false);
        };

        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;

          // Handle connection errors
          this.db.onerror = (event) => {
            console.error("IndexedDB: Database error", event);
          };

          // Handle version change (another tab upgraded the db)
          this.db.onversionchange = () => {
            this.db?.close();
            this.db = null;
            console.warn(
              "IndexedDB: Database version changed, connection closed"
            );
          };

          resolve(true);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const transaction = (event.target as IDBOpenDBRequest).transaction;
          this.createSchema(db, transaction ?? undefined);
        };
      } catch (error) {
        console.error("IndexedDB: Exception during init", error);
        resolve(false);
      }
    });
  }

  private ensureTrackIndexes(trackStore: IDBObjectStore): void {
    if (!trackStore.indexNames.contains("by-rating")) {
      trackStore.createIndex("by-rating", "rating", { unique: false });
    }
    if (!trackStore.indexNames.contains("by-energy")) {
      trackStore.createIndex("by-energy", "energy", { unique: false });
    }
    if (!trackStore.indexNames.contains("by-dateModified")) {
      trackStore.createIndex("by-dateModified", "dateModified", {
        unique: false,
      });
    }
    if (!trackStore.indexNames.contains("by-bpm")) {
      trackStore.createIndex("by-bpm", "bpm", { unique: false });
    }
    if (!trackStore.indexNames.contains("by-camelot-key")) {
      trackStore.createIndex("by-camelot-key", "camelotKey", { unique: false });
    }
  }

  private createSchema(db: IDBDatabase, transaction?: IDBTransaction): void {
    // Tracks store with indexes
    let trackStore: IDBObjectStore | null = null;
    if (!db.objectStoreNames.contains(STORES.TRACKS)) {
      trackStore = db.createObjectStore(STORES.TRACKS, {
        keyPath: "uri",
      });
    } else if (transaction) {
      trackStore = transaction.objectStore(STORES.TRACKS);
    }

    if (trackStore) {
      this.ensureTrackIndexes(trackStore);
    }

    let playlistStore: IDBObjectStore | null = null;
    if (!db.objectStoreNames.contains(STORES.PLAYLISTS)) {
      playlistStore = db.createObjectStore(STORES.PLAYLISTS, {
        keyPath: "uri",
      });
    } else if (transaction) {
      playlistStore = transaction.objectStore(STORES.PLAYLISTS);
    }

    if (playlistStore) {
      if (!playlistStore.indexNames.contains("by-name")) {
        playlistStore.createIndex("by-name", "name", { unique: false });
      }
      if (!playlistStore.indexNames.contains("by-dateModified")) {
        playlistStore.createIndex("by-dateModified", "dateModified", {
          unique: false,
        });
      }
      if (!playlistStore.indexNames.contains("by-trackCount")) {
        playlistStore.createIndex("by-trackCount", "trackCount", {
          unique: false,
        });
      }
    }

    let artistStore: IDBObjectStore | null = null;
    if (!db.objectStoreNames.contains(STORES.ARTISTS)) {
      artistStore = db.createObjectStore(STORES.ARTISTS, {
        keyPath: "uri",
      });
    } else if (transaction) {
      artistStore = transaction.objectStore(STORES.ARTISTS);
    }

    if (artistStore) {
      if (!artistStore.indexNames.contains("by-name")) {
        artistStore.createIndex("by-name", "name", { unique: false });
      }
      if (!artistStore.indexNames.contains("by-dateModified")) {
        artistStore.createIndex("by-dateModified", "dateModified", {
          unique: false,
        });
      }
      if (!artistStore.indexNames.contains("by-followerCount")) {
        artistStore.createIndex("by-followerCount", "followerCount", {
          unique: false,
        });
      }
    }

    // Categories store (single document containing all categories)
    if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
      db.createObjectStore(STORES.CATEGORIES, { keyPath: "id" });
    }

    // Metadata store for misc key-value pairs
    if (!db.objectStoreNames.contains(STORES.METADATA)) {
      db.createObjectStore(STORES.METADATA, { keyPath: "key" });
    }
  }

  private resetConnection(): void {
    if (!this.db) {
      return;
    }

    try {
      this.db.close();
    } catch {
      // Ignore close errors and reset the cached reference.
    } finally {
      this.db = null;
    }
  }

  private isConnectionHealthy(): boolean {
    if (!this.db) {
      return false;
    }

    try {
      // Opening a lightweight transaction throws if the connection is closing.
      this.db.transaction(STORES.METADATA, "readonly");
      return true;
    } catch (error) {
      console.warn("IndexedDB: Connection is unhealthy, reopening", error);
      this.resetConnection();
      return false;
    }
  }

  private async ensureReady(): Promise<boolean> {
    if (this.isConnectionHealthy()) {
      return true;
    }

    return this.init();
  }

  async isInitialized(): Promise<boolean> {
    if (!(await this.ensureReady())) {
      return false;
    }

    try {
      // Check if we have any data
      const [trackCount, playlistCount, artistCount, taxonomy] = await Promise.all([
        this.getTrackCount(),
        this.getPlaylistCount(),
        this.getArtistCount(),
        this.getTaxonomy(),
      ]);
      return (
        trackCount > 0 ||
        playlistCount > 0 ||
        artistCount > 0 ||
        taxonomy.categoryOrder.length > 0
      );
    } catch {
      return false;
    }
  }

  async loadAll(): Promise<TagDataStructure | null> {
    if (!(await this.ensureReady())) {
      console.error("IndexedDB: Database not initialized");
      return null;
    }

    try {
      const [taxonomyRecord, legacyCategories, tracks, playlists, artists] =
        await Promise.all([
          this.getStoredTaxonomyRecord(),
          this.getStoredLegacyCategories(),
          this.getAllTracks(),
          this.getAllPlaylists(),
          this.getAllArtists(),
        ]);

      return normalizeTagDataStructure(
        taxonomyRecord
          ? {
              schemaVersion: TAG_DATA_SCHEMA_VERSION,
              taxonomy: taxonomyRecord,
              tracks,
              playlists,
              artists,
            }
          : {
              categories: legacyCategories,
              tracks,
              playlists,
              artists,
            },
      );
    } catch (error) {
      console.error("IndexedDB: Failed to load all data", error);
      return null;
    }
  }

  async saveAll(data: TagDataStructure): Promise<boolean> {
    if (!(await this.ensureReady())) {
      console.error("IndexedDB: Database not initialized");
      return false;
    }

    try {
      const transaction = this.db!.transaction(
        [
          STORES.TRACKS,
          STORES.PLAYLISTS,
          STORES.ARTISTS,
          STORES.CATEGORIES,
          STORES.METADATA,
        ],
        "readwrite"
      );

      const trackStore = transaction.objectStore(STORES.TRACKS);
      const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
      const artistStore = transaction.objectStore(STORES.ARTISTS);
      const categoryStore = transaction.objectStore(STORES.CATEGORIES);
      const metadataStore = transaction.objectStore(STORES.METADATA);

      // Clear existing data
      trackStore.clear();
      playlistStore.clear();
      artistStore.clear();
      categoryStore.clear();

      // Save taxonomy
      categoryStore.put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: data.taxonomy });

      // Save all tracks
      for (const [uri, trackData] of Object.entries(data.tracks)) {
        trackStore.put({ uri, ...trackData });
      }

      for (const [uri, playlistData] of Object.entries(data.playlists)) {
        playlistStore.put({ uri, ...playlistData });
      }

      for (const [uri, artistData] of Object.entries(data.artists)) {
        artistStore.put({ uri, ...artistData });
      }

      // Update metadata
      metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
      metadataStore.put({ key: META_KEYS.VERSION, value: TAG_DATA_SCHEMA_VERSION });

      return new Promise((resolve) => {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = (event) => {
          console.error("IndexedDB: saveAll transaction failed", event);
          resolve(false);
        };
      });
    } catch (error) {
      console.error("IndexedDB: Failed to save all data", error);
      return false;
    }
  }

  private async getStoredTaxonomyRecord(): Promise<TagTaxonomy | null> {
    if (!(await this.ensureReady())) {
      return null;
    }

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.CATEGORIES, "readonly");
        const store = transaction.objectStore(STORES.CATEGORIES);
        const request = store.get(CATEGORY_DOCUMENT_KEYS.TAXONOMY);

        request.onsuccess = () => {
          const result = request.result;
          resolve((result?.data as TagTaxonomy | undefined) || null);
        };

        request.onerror = () => resolve(null);
      } catch (error) {
        console.error("IndexedDB: Failed to get taxonomy", error);
        resolve(null);
      }
    });
  }

  private async getStoredLegacyCategories() {
    if (!(await this.ensureReady())) {
      return buildCategoryTree(createEmptyTaxonomy());
    }

    return new Promise<ReturnType<typeof buildCategoryTree>>((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.CATEGORIES, "readonly");
        const store = transaction.objectStore(STORES.CATEGORIES);
        const request = store.get(CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES);

        request.onsuccess = () => {
          const result = request.result;
          resolve(Array.isArray(result?.data) ? result.data : []);
        };

        request.onerror = () => resolve([]);
      } catch (error) {
        console.error("IndexedDB: Failed to get legacy categories", error);
        resolve([]);
      }
    });
  }

  async getTaxonomy(): Promise<TagTaxonomy> {
    if (!(await this.ensureReady())) {
      return createEmptyTaxonomy();
    }

    const taxonomy = await this.getStoredTaxonomyRecord();
    if (taxonomy) {
      return taxonomy;
    }

    const legacyCategories = await this.getStoredLegacyCategories();
    return normalizeTagDataStructure({
      categories: legacyCategories,
      tracks: {},
    }).taxonomy;
  }

  async saveTaxonomy(taxonomy: TagTaxonomy): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.CATEGORIES, STORES.METADATA],
          "readwrite"
        );
        const categoryStore = transaction.objectStore(STORES.CATEGORIES);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        categoryStore.clear();
        categoryStore.put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: taxonomy });
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        metadataStore.put({ key: META_KEYS.VERSION, value: TAG_DATA_SCHEMA_VERSION });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save taxonomy", error);
        resolve(false);
      }
    });
  }

  async getTrack(uri: string): Promise<TrackData | null> {
    if (!(await this.ensureReady())) return null;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.TRACKS, "readonly");
        const store = transaction.objectStore(STORES.TRACKS);
        const request = store.get(uri);

        request.onsuccess = () => {
          if (request.result) {
            // Remove the 'uri' field as it's not part of TrackData
            const { uri: _, ...trackData } = request.result;
            resolve(trackData as TrackData);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      } catch (error) {
        console.error("IndexedDB: Failed to get track", error);
        resolve(null);
      }
    });
  }

  async saveTrack(uri: string, data: TrackData): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.TRACKS, STORES.METADATA],
          "readwrite"
        );
        const trackStore = transaction.objectStore(STORES.TRACKS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        trackStore.put({ uri, ...data });
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save track", error);
        resolve(false);
      }
    });
  }

  async deleteTrack(uri: string): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.TRACKS, STORES.METADATA],
          "readwrite"
        );
        const trackStore = transaction.objectStore(STORES.TRACKS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        trackStore.delete(uri);
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to delete track", error);
        resolve(false);
      }
    });
  }

  async getTracks(uris: string[]): Promise<Map<string, TrackData>> {
    if (!(await this.ensureReady())) return new Map();

    return new Promise((resolve) => {
      const results = new Map<string, TrackData>();

      try {
        const transaction = this.db!.transaction(STORES.TRACKS, "readonly");
        const store = transaction.objectStore(STORES.TRACKS);

        let completed = 0;

        if (uris.length === 0) {
          resolve(results);
          return;
        }

        for (const uri of uris) {
          const request = store.get(uri);

          request.onsuccess = () => {
            if (request.result) {
              const { uri: _, ...trackData } = request.result;
              results.set(uri, trackData as TrackData);
            }
            completed++;
            if (completed === uris.length) {
              resolve(results);
            }
          };

          request.onerror = () => {
            completed++;
            if (completed === uris.length) {
              resolve(results);
            }
          };
        }
      } catch (error) {
        console.error("IndexedDB: Failed to get tracks", error);
        resolve(results);
      }
    });
  }

  async saveTracks(tracks: Map<string, TrackData>): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.TRACKS, STORES.METADATA],
          "readwrite"
        );
        const trackStore = transaction.objectStore(STORES.TRACKS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        for (const [uri, data] of tracks) {
          trackStore.put({ uri, ...data });
        }

        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save tracks", error);
        resolve(false);
      }
    });
  }

  async getPlaylist(uri: string): Promise<PlaylistData | null> {
    if (!(await this.ensureReady())) return null;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.PLAYLISTS, "readonly");
        const store = transaction.objectStore(STORES.PLAYLISTS);
        const request = store.get(uri);

        request.onsuccess = () => {
          if (request.result) {
            const { uri: _, ...playlistData } = request.result;
            resolve(playlistData as PlaylistData);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      } catch (error) {
        console.error("IndexedDB: Failed to get playlist", error);
        resolve(null);
      }
    });
  }

  async savePlaylist(uri: string, data: PlaylistData): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.PLAYLISTS, STORES.METADATA],
          "readwrite"
        );
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        playlistStore.put({ uri, ...data });
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save playlist", error);
        resolve(false);
      }
    });
  }

  async deletePlaylist(uri: string): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.PLAYLISTS, STORES.METADATA],
          "readwrite"
        );
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        playlistStore.delete(uri);
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to delete playlist", error);
        resolve(false);
      }
    });
  }

  async savePlaylists(playlists: Map<string, PlaylistData>): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.PLAYLISTS, STORES.METADATA],
          "readwrite"
        );
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        for (const [uri, data] of playlists) {
          playlistStore.put({ uri, ...data });
        }

        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save playlists", error);
        resolve(false);
      }
    });
  }

  async getArtist(uri: string): Promise<ArtistData | null> {
    if (!(await this.ensureReady())) return null;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.ARTISTS, "readonly");
        const store = transaction.objectStore(STORES.ARTISTS);
        const request = store.get(uri);

        request.onsuccess = () => {
          if (request.result) {
            const { uri: _, ...artistData } = request.result;
            resolve(artistData as ArtistData);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      } catch (error) {
        console.error("IndexedDB: Failed to get artist", error);
        resolve(null);
      }
    });
  }

  async saveArtist(uri: string, data: ArtistData): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.ARTISTS, STORES.METADATA],
          "readwrite"
        );
        const artistStore = transaction.objectStore(STORES.ARTISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        artistStore.put({ uri, ...data });
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save artist", error);
        resolve(false);
      }
    });
  }

  async deleteArtist(uri: string): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.ARTISTS, STORES.METADATA],
          "readwrite"
        );
        const artistStore = transaction.objectStore(STORES.ARTISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        artistStore.delete(uri);
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to delete artist", error);
        resolve(false);
      }
    });
  }

  async saveArtists(artists: Map<string, ArtistData>): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.ARTISTS, STORES.METADATA],
          "readwrite"
        );
        const artistStore = transaction.objectStore(STORES.ARTISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        for (const [uri, data] of artists) {
          artistStore.put({ uri, ...data });
        }

        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save artists", error);
        resolve(false);
      }
    });
  }

  async getAllTrackUris(): Promise<string[]> {
    if (!(await this.ensureReady())) return [];

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.TRACKS, "readonly");
        const store = transaction.objectStore(STORES.TRACKS);
        const request = store.getAllKeys();

        request.onsuccess = () => {
          resolve(request.result as string[]);
        };

        request.onerror = () => resolve([]);
      } catch (error) {
        console.error("IndexedDB: Failed to get all track URIs", error);
        resolve([]);
      }
    });
  }

  async getTrackCount(): Promise<number> {
    if (!(await this.ensureReady())) return 0;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.TRACKS, "readonly");
        const store = transaction.objectStore(STORES.TRACKS);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      } catch (error) {
        console.error("IndexedDB: Failed to get track count", error);
        resolve(0);
      }
    });
  }

  async getPlaylistCount(): Promise<number> {
    if (!(await this.ensureReady())) return 0;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.PLAYLISTS, "readonly");
        const store = transaction.objectStore(STORES.PLAYLISTS);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      } catch (error) {
        console.error("IndexedDB: Failed to get playlist count", error);
        resolve(0);
      }
    });
  }

  async getArtistCount(): Promise<number> {
    if (!(await this.ensureReady())) return 0;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.ARTISTS, "readonly");
        const store = transaction.objectStore(STORES.ARTISTS);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      } catch (error) {
        console.error("IndexedDB: Failed to get artist count", error);
        resolve(0);
      }
    });
  }

  private async getAllTracks(): Promise<{ [uri: string]: TrackData }> {
    if (!(await this.ensureReady())) return {};

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.TRACKS, "readonly");
        const store = transaction.objectStore(STORES.TRACKS);
        const request = store.getAll();

        request.onsuccess = () => {
          const tracks: { [uri: string]: TrackData } = {};
          for (const record of request.result) {
            const { uri, ...trackData } = record;
            tracks[uri] = trackData as TrackData;
          }
          resolve(tracks);
        };

        request.onerror = () => resolve({});
      } catch (error) {
        console.error("IndexedDB: Failed to get all tracks", error);
        resolve({});
      }
    });
  }

  private async getAllPlaylists(): Promise<{ [uri: string]: PlaylistData }> {
    if (!(await this.ensureReady())) return {};

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.PLAYLISTS, "readonly");
        const store = transaction.objectStore(STORES.PLAYLISTS);
        const request = store.getAll();

        request.onsuccess = () => {
          const playlists: { [uri: string]: PlaylistData } = {};
          for (const record of request.result) {
            const { uri, ...playlistData } = record;
            playlists[uri] = playlistData as PlaylistData;
          }
          resolve(playlists);
        };

        request.onerror = () => resolve({});
      } catch (error) {
        console.error("IndexedDB: Failed to get all playlists", error);
        resolve({});
      }
    });
  }

  private async getAllArtists(): Promise<{ [uri: string]: ArtistData }> {
    if (!(await this.ensureReady())) return {};

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.ARTISTS, "readonly");
        const store = transaction.objectStore(STORES.ARTISTS);
        const request = store.getAll();

        request.onsuccess = () => {
          const artists: { [uri: string]: ArtistData } = {};
          for (const record of request.result) {
            const { uri, ...artistData } = record;
            artists[uri] = artistData as ArtistData;
          }
          resolve(artists);
        };

        request.onerror = () => resolve({});
      } catch (error) {
        console.error("IndexedDB: Failed to get all artists", error);
        resolve({});
      }
    });
  }

  async clearAll(): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [
            STORES.TRACKS,
            STORES.PLAYLISTS,
            STORES.ARTISTS,
            STORES.CATEGORIES,
            STORES.METADATA,
          ],
          "readwrite"
        );

        transaction.objectStore(STORES.TRACKS).clear();
        transaction.objectStore(STORES.PLAYLISTS).clear();
        transaction.objectStore(STORES.ARTISTS).clear();
        transaction.objectStore(STORES.CATEGORIES).clear();
        transaction.objectStore(STORES.METADATA).clear();

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to clear all", error);
        resolve(false);
      }
    });
  }

  async getMetadata(): Promise<StorageMetadata> {
    const [trackCount, playlistCount, artistCount] = await Promise.all([
      this.getTrackCount(),
      this.getPlaylistCount(),
      this.getArtistCount(),
    ]);
    const taxonomy = await this.getTaxonomy();
    const lastModified = await this.getLastModified();

    return {
      backend: "indexeddb",
      trackCount,
      playlistCount,
      artistCount,
      categoryCount: buildCategoryTree(taxonomy).length,
      lastModified,
      estimatedSizeBytes: null, // IndexedDB doesn't easily expose this
    };
  }

  private async getLastModified(): Promise<number | null> {
    if (!(await this.ensureReady())) return null;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(STORES.METADATA, "readonly");
        const store = transaction.objectStore(STORES.METADATA);
        const request = store.get(META_KEYS.LAST_MODIFIED);

        request.onsuccess = () => {
          resolve(request.result?.value || null);
        };

        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Close the database connection (for cleanup)
   */
  close(): void {
    this.resetConnection();
  }
}

// Export singleton instance
export const indexedDBStorage = new IndexedDBStorageService();
