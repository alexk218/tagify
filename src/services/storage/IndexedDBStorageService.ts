import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";
import type {
  InstalledTaxonomyRecordV1,
  OwnerTaxonomyIdentityMappingV1,
  PublicationPolicyV1,
} from "@tagify/community-contracts";
import type { CommunityBackupStateV2 } from "@/features/tag-data/utils/tagData.backup";
import type { DurableAppStateDocumentV2 } from "@tagify/sync-contracts";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { installSmartPlaylistRecipeBundle, type InstalledSmartPlaylistRecipes, type SmartPlaylistRecipeSelection } from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import type { SmartPlaylistRecipeBundle } from "@/features/smart-playlists/model/smartPlaylist.types";
import { preserveSmartPlaylistMembership } from "@/features/smart-playlists/utils/smartPlaylist.membership";
import { preserveLocalFileTags } from "@/services/sync/PreserveLocalFileTags";
import { rebuildDeviceTaxonomy } from "@/services/sync/PreserveLocalTaxonomyMetadata";
import { taxonomyFromShadowRecord, type TaxonomyShadowRecord } from "@/services/sync/SyncTaxonomy";
import type { ReplicaManifest } from "@/services/sync/SyncLocalState";
import { IStorageService, StorageMetadata } from "./IStorageService";
import {
  normalizeSmartPlaylistCriteriaList,
  normalizeTagDataStructure,
} from "@/features/tag-data/utils/tagData.schema";
import {
  buildCategoryTree,
  createEmptyTaxonomy,
  TAG_DATA_SCHEMA_VERSION,
} from "@/utils/tagTaxonomy";
import {
  appendIntent,
  ensureSyncStores,
  entityFromUri,
  getTagifyDatabaseName,
  isActiveSyncDatabase,
  makeEntityDeleteIntent,
  makeEntityReplaceIntent,
  makeSnapshotIntent,
  makeTaxonomyIntent,
  noteLocalFileChange,
  SYNC_STORES,
  TAGIFY_DATABASE_VERSION,
  type LocalSyncIntent,
  type SnapshotReplaceIntent,
  type TaxonomyReplaceIntent,
} from "@/services/sync/SyncLocalState";

const DB_VERSION = TAGIFY_DATABASE_VERSION;

// Object store names
const STORES = {
  TRACKS: "tracks",
  PLAYLISTS: "playlists",
  ARTISTS: "artists",
  SMART_PLAYLISTS: "smartPlaylists",
  CATEGORIES: "categories",
  METADATA: "metadata",
  COMMUNITY_POLICY: "community-policy",
  COMMUNITY_INSTALLATIONS: "community-installations",
  COMMUNITY_ROLLBACKS: "community-rollbacks",
  OUTBOX: SYNC_STORES.OUTBOX,
} as const;

interface CommunityRollbackRecord {
  id: string;
  createdAt: string;
  taxonomy: TagTaxonomy;
  installationId: string;
  previousInstallation: InstalledTaxonomyRecordV1 | null;
}

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
        const request = indexedDB.open(getTagifyDatabaseName(), DB_VERSION);

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
          IndexedDBStorageService.createSchema(db, transaction ?? undefined);
        };
      } catch (error) {
        console.error("IndexedDB: Exception during init", error);
        resolve(false);
      }
    });
  }

  private static ensureTrackIndexes(trackStore: IDBObjectStore): void {
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

  static createSchema(db: IDBDatabase, transaction?: IDBTransaction): void {
    ensureSyncStores(db);
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
      IndexedDBStorageService.ensureTrackIndexes(trackStore);
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

    if (!db.objectStoreNames.contains(STORES.SMART_PLAYLISTS)) {
      db.createObjectStore(STORES.SMART_PLAYLISTS, { keyPath: "id" });
    }

    // Categories store (single document containing all categories)
    if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
      db.createObjectStore(STORES.CATEGORIES, { keyPath: "id" });
    }

    // Metadata store for misc key-value pairs
    if (!db.objectStoreNames.contains(STORES.METADATA)) {
      db.createObjectStore(STORES.METADATA, { keyPath: "key" });
    }

    if (!db.objectStoreNames.contains(STORES.COMMUNITY_POLICY)) {
      db.createObjectStore(STORES.COMMUNITY_POLICY, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(STORES.COMMUNITY_INSTALLATIONS)) {
      db.createObjectStore(STORES.COMMUNITY_INSTALLATIONS, {
        keyPath: "installationId",
      });
    }
    if (!db.objectStoreNames.contains(STORES.COMMUNITY_ROLLBACKS)) {
      const rollbackStore = db.createObjectStore(STORES.COMMUNITY_ROLLBACKS, {
        keyPath: "id",
      });
      rollbackStore.createIndex("by-created-at", "createdAt", { unique: false });
    }
  }

  resetConnection(): void {
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

  async switchAccountDatabase(): Promise<boolean> {
    this.resetConnection();
    this.initPromise = null;
    return this.init();
  }

  private isConnectionHealthy(): boolean {
    if (!this.db) {
      return false;
    }

    if (!isActiveSyncDatabase(this.db)) {
      this.resetConnection();
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
      const [trackCount, playlistCount, artistCount, smartPlaylists, taxonomy] = await Promise.all([
        this.getTrackCount(),
        this.getPlaylistCount(),
        this.getArtistCount(),
        this.getAllSmartPlaylists(),
        this.getTaxonomy(),
      ]);
      return (
        trackCount > 0 ||
        playlistCount > 0 ||
        artistCount > 0 ||
        smartPlaylists.length > 0 ||
        taxonomy.categoryOrder.length > 0
      );
    } catch {
      return false;
    }
  }

  async loadAll(): Promise<TagDataStructure | null> {
    try {
      return await this.loadAllStrict();
    } catch (error) {
      console.error("IndexedDB: Failed to load all data", error);
      return null;
    }
  }

  /** A single consistent read; failed reads must never resemble an empty library. */
  async loadAllStrict(): Promise<TagDataStructure> {
    if (!(await this.ensureReady())) {
      throw new Error("Your saved Tagify details could not be read. Please try again.");
    }
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([
        STORES.CATEGORIES, STORES.TRACKS, STORES.PLAYLISTS, STORES.ARTISTS, STORES.SMART_PLAYLISTS,
      ], "readonly");
      const categories = transaction.objectStore(STORES.CATEGORIES).getAll();
      const tracks = transaction.objectStore(STORES.TRACKS).getAll();
      const playlists = transaction.objectStore(STORES.PLAYLISTS).getAll();
      const artists = transaction.objectStore(STORES.ARTISTS).getAll();
      const smartPlaylists = transaction.objectStore(STORES.SMART_PLAYLISTS).getAll();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Your saved Tagify details could not be read. Please try again."));
      transaction.oncomplete = () => {
        try {
          const byUri = (records: Array<{ uri: string }>) => Object.fromEntries(records.map(({ uri, ...value }) => [uri, value]));
          const taxonomy = categories.result.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.TAXONOMY)?.data;
          const normalized = normalizeTagDataStructure({
            ...(taxonomy ? { schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy } : {
              categories: categories.result.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES)?.data ?? [],
            }),
            tracks: byUri(tracks.result), playlists: byUri(playlists.result), artists: byUri(artists.result),
            smartPlaylists: smartPlaylists.result,
          });
          normalized.smartPlaylists = normalizeSmartPlaylistCriteriaList(smartPlaylists.result);
          if (normalized.smartPlaylists.length !== smartPlaylists.result.length) throw new Error("Your saved Smart Playlists need recovery before syncing.");
          for (const record of tracks.result) {
            if (record.dateModified !== undefined && normalized.tracks[record.uri]) normalized.tracks[record.uri].dateModified = record.dateModified;
          }
          resolve(normalized);
        } catch (error) { reject(error); }
      };
    });
  }

  async saveAll(data: TagDataStructure, snapshotReason: SnapshotReplaceIntent["reason"] = "import"): Promise<boolean> {
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
          STORES.SMART_PLAYLISTS,
          STORES.CATEGORIES,
          STORES.METADATA,
          STORES.OUTBOX,
        ],
        "readwrite"
      );

      const trackStore = transaction.objectStore(STORES.TRACKS);
      const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
      const artistStore = transaction.objectStore(STORES.ARTISTS);
      const smartPlaylistStore = transaction.objectStore(STORES.SMART_PLAYLISTS);
      const categoryStore = transaction.objectStore(STORES.CATEGORIES);
      const metadataStore = transaction.objectStore(STORES.METADATA);

      // Clear existing data
      trackStore.clear();
      playlistStore.clear();
      artistStore.clear();
      smartPlaylistStore.clear();
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

      for (const playlist of data.smartPlaylists || []) {
        smartPlaylistStore.put(playlist);
      }

      // Update metadata
      metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
      metadataStore.put({ key: META_KEYS.VERSION, value: TAG_DATA_SCHEMA_VERSION });
      appendIntent(transaction, makeSnapshotIntent(snapshotReason));

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

  async replaceCloudReplica(
    data: TagDataStructure,
    manifest: ReplicaManifest,
    syncStateRecords: unknown[],
    appState: DurableAppStateDocumentV2[],
    localAppState: DurableAppStateDocumentV2[] = [],
    options: { keepQueuedEdits?: boolean } = {},
  ): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    try {
      const previous = await this.loadAllStrict();
      const previousSmartPlaylists = previous.smartPlaylists ?? [];
      const smartPlaylistDocument = [...localAppState, ...appState].find((document) => document.domain === "smart-playlists");
      const durableSmartPlaylists = smartPlaylistDocument
        ? preserveSmartPlaylistMembership(normalizeSmartPlaylistCriteriaList(portableSmartPlaylistDefinitions(smartPlaylistDocument.value)), previousSmartPlaylists)
        : previousSmartPlaylists;
      if (smartPlaylistDocument && (
        !Array.isArray(smartPlaylistDocument.value) ||
        durableSmartPlaylists.length !== smartPlaylistDocument.value.length
      )) {
        throw new Error("The Community smart playlist backup is incomplete");
      }
      // Cloud annotations cannot represent local files or other non-Spotify
      // identities. A cloud refresh must not delete those device-only records.
      const localOnly = <T>(records: Record<string, T>, kind: "track" | "playlist" | "artist") =>
        Object.fromEntries(Object.entries(records).filter(([uri]) => !entityFromUri(uri, kind))) as Record<string, T>;
      const localOnlyTracks = localOnly(previous.tracks, "track");
      const localOnlyPlaylists = localOnly(previous.playlists, "playlist");
      const localOnlyArtists = localOnly(previous.artists, "artist");
      const taxonomy = rebuildDeviceTaxonomy(
        preserveLocalFileTags(data.taxonomy, previous.taxonomy, localOnlyTracks),
        previous.taxonomy,
      );
      const stores = [
        STORES.TRACKS, STORES.PLAYLISTS, STORES.ARTISTS, STORES.SMART_PLAYLISTS, STORES.CATEGORIES, STORES.METADATA,
        SYNC_STORES.OUTBOX, SYNC_STORES.STATE, SYNC_STORES.CONFLICTS, SYNC_STORES.TOMBSTONES,
        SYNC_STORES.APP_STATE, SYNC_STORES.RECOVERY_CHECKPOINT,
      ];
      const transaction = this.db!.transaction(stores, "readwrite");
      const writeReplica = (pendingIntents: LocalSyncIntent[]) => {
        stores.forEach((store) => transaction.objectStore(store).clear());
        transaction.objectStore(SYNC_STORES.RECOVERY_CHECKPOINT).put({
          key: "pre-restore", createdAt: new Date().toISOString(), data: previous,
        });
        transaction.objectStore(STORES.CATEGORIES).put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: taxonomy });
        // Cloud annotations carry tags, ratings, energy, BPM, and key only. Keep
        // each existing record's timestamps and cached details.
        const putPreserved = <T extends { dateModified?: number; dateCreated?: number }>(store: string, incoming: Record<string, T>, existing: Record<string, T>) => {
          Object.entries(incoming).forEach(([uri, value]) => {
            const previousDateModified = existing[uri]?.dateModified;
            const previousDateCreated = existing[uri]?.dateCreated;
            transaction.objectStore(store).put({
              uri,
              ...existing[uri],
              ...value,
              ...(previousDateCreated === undefined ? {} : { dateCreated: previousDateCreated }),
              ...(previousDateModified === undefined ? {} : { dateModified: previousDateModified }),
            });
          });
        };
        putPreserved(STORES.TRACKS, { ...localOnlyTracks, ...data.tracks }, previous.tracks);
        putPreserved(STORES.PLAYLISTS, { ...localOnlyPlaylists, ...data.playlists }, previous.playlists);
        putPreserved(STORES.ARTISTS, { ...localOnlyArtists, ...data.artists }, previous.artists);
        durableSmartPlaylists.forEach((value) => transaction.objectStore(STORES.SMART_PLAYLISTS).put(value));
        transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.VERSION, value: TAG_DATA_SCHEMA_VERSION });
        // Unsent edits from this device stay on the device and remain queued, so
        // they back up on top of the refreshed cloud copy instead of being lost.
        for (const intent of pendingIntents) {
          if (intent.type === "taxonomy.replace") {
            transaction.objectStore(STORES.CATEGORIES).put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: previous.taxonomy });
          } else if (intent.type === "entity.replace" || intent.type === "entity.delete") {
            const uri = `spotify:${intent.entity.kind}:${intent.entity.providerId}`;
            const [store, records] = intent.entity.kind === "track" ? [STORES.TRACKS, previous.tracks] as const
              : intent.entity.kind === "artist" ? [STORES.ARTISTS, previous.artists] as const
                : [STORES.PLAYLISTS, previous.playlists] as const;
            const record = (records as Record<string, unknown>)[uri];
            if (intent.type === "entity.delete" || !record) transaction.objectStore(store).delete(uri);
            else transaction.objectStore(store).put({ uri, ...(record as object) });
          }
          transaction.objectStore(SYNC_STORES.OUTBOX).put(intent);
        }
        syncStateRecords.forEach((record) => transaction.objectStore(SYNC_STORES.STATE).put(record));
        transaction.objectStore(SYNC_STORES.STATE).put(manifest);
        appState.forEach((document) => transaction.objectStore(SYNC_STORES.APP_STATE).put(document));
      };
      if (options.keepQueuedEdits) {
        // Read the queue inside this transaction so an edit saved moments ago
        // cannot be cleared without being kept.
        const queued = transaction.objectStore(SYNC_STORES.OUTBOX).index("by-created-at").getAll();
        queued.onsuccess = () => writeReplica(queued.result as LocalSyncIntent[]);
        queued.onerror = () => transaction.abort();
      } else {
        writeReplica([]);
      }
      return new Promise((resolve) => {
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      });
    } catch (error) {
      console.error("IndexedDB: Atomic cloud restore failed", error);
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

  async saveTaxonomy(taxonomy: TagTaxonomy, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const capture = options?.captureSync !== false && Boolean(makeTaxonomyIntent(taxonomy));
        const transaction = this.db!.transaction(
          capture ? [STORES.CATEGORIES, STORES.METADATA, STORES.OUTBOX, SYNC_STORES.STATE] : [STORES.CATEGORIES, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const categoryStore = transaction.objectStore(STORES.CATEGORIES);
        const metadataStore = transaction.objectStore(STORES.METADATA);
        const write = (intent: TaxonomyReplaceIntent | null) => {
          categoryStore.clear();
          categoryStore.put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: taxonomy });
          metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          metadataStore.put({ key: META_KEYS.VERSION, value: TAG_DATA_SCHEMA_VERSION });
          appendIntent(transaction, intent);
        };

        if (!capture) {
          write(null);
        } else {
          // Record the cloud copy this device last knew, so sync sends only
          // this device's differences and never reverts changes another device
          // makes meanwhile. A still-unsent edit keeps its earlier starting point.
          const shadowRequest = transaction.objectStore(SYNC_STORES.STATE).get("taxonomy-shadow");
          const outboxRequest = transaction.objectStore(STORES.OUTBOX).getAll();
          outboxRequest.onsuccess = () => {
            const pending = (outboxRequest.result as LocalSyncIntent[])
              .filter((intent): intent is TaxonomyReplaceIntent => intent.type === "taxonomy.replace")
              .sort((left, right) => left.createdAt - right.createdAt)[0];
            const shadow = shadowRequest.result as TaxonomyShadowRecord | undefined;
            const base = pending ? pending.base : shadow ? taxonomyFromShadowRecord(shadow) : undefined;
            write(makeTaxonomyIntent(taxonomy, undefined, base));
          };
          outboxRequest.onerror = () => transaction.abort();
        }

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save taxonomy", error);
        resolve(false);
      }
    });
  }

  async getCommunityPublicationPolicy(): Promise<PublicationPolicyV1 | null> {
    return this.getCommunityRecord<PublicationPolicyV1>(STORES.COMMUNITY_POLICY, "publication-policy");
  }

  async saveCommunityPublicationPolicy(policy: PublicationPolicyV1): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    return this.putCommunityRecord(STORES.COMMUNITY_POLICY, { id: "publication-policy", ...policy });
  }

  async getCommunityOwnerIdentityMapping(): Promise<OwnerTaxonomyIdentityMappingV1 | null> {
    return this.getCommunityRecord<OwnerTaxonomyIdentityMappingV1>(STORES.COMMUNITY_POLICY, "owner-identity-mapping");
  }

  async saveCommunityOwnerIdentityMapping(mapping: OwnerTaxonomyIdentityMappingV1): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    return this.putCommunityRecord(STORES.COMMUNITY_POLICY, { id: "owner-identity-mapping", ...mapping });
  }

  async getCommunityInstallations(): Promise<InstalledTaxonomyRecordV1[]> {
    if (!(await this.ensureReady())) return [];
    return new Promise((resolve) => {
      try {
        const request = this.db!.transaction(STORES.COMMUNITY_INSTALLATIONS, "readonly").objectStore(STORES.COMMUNITY_INSTALLATIONS).getAll();
        request.onsuccess = () => resolve(request.result as InstalledTaxonomyRecordV1[]);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async restoreCommunityBackupState(state: CommunityBackupStateV2): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.COMMUNITY_POLICY, STORES.COMMUNITY_INSTALLATIONS, STORES.COMMUNITY_ROLLBACKS],
          "readwrite",
        );
        const policyStore = transaction.objectStore(STORES.COMMUNITY_POLICY);
        const installations = transaction.objectStore(STORES.COMMUNITY_INSTALLATIONS);
        policyStore.clear();
        installations.clear();
        transaction.objectStore(STORES.COMMUNITY_ROLLBACKS).clear();
        if (state.publicationPolicy) policyStore.put({ id: "publication-policy", ...state.publicationPolicy });
        if (state.ownerIdentityMapping) policyStore.put({ id: "owner-identity-mapping", ...state.ownerIdentityMapping });
        state.installations.forEach((installation) => installations.put(installation));
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to restore Community backup state", error);
        resolve(false);
      }
    });
  }

  async applyCommunityTaxonomy(
    taxonomy: TagTaxonomy,
    installation: InstalledTaxonomyRecordV1,
    rollbackTaxonomy: TagTaxonomy,
  ): Promise<string | null> {
    if (!(await this.ensureReady())) return null;
    const rollbackId = `rollback_${installation.installationId}_${Date.now()}`;
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.CATEGORIES, STORES.COMMUNITY_INSTALLATIONS, STORES.COMMUNITY_ROLLBACKS, STORES.METADATA],
          "readwrite",
        );
        const installations = transaction.objectStore(STORES.COMMUNITY_INSTALLATIONS);
        const previousRequest = installations.get(installation.installationId);
        previousRequest.onsuccess = () => {
          const rollback: CommunityRollbackRecord = {
            id: rollbackId,
            createdAt: new Date().toISOString(),
            taxonomy: rollbackTaxonomy,
            installationId: installation.installationId,
            previousInstallation: (previousRequest.result as InstalledTaxonomyRecordV1 | undefined) ?? null,
          };
          transaction.objectStore(STORES.COMMUNITY_ROLLBACKS).put(rollback);
          transaction.objectStore(STORES.CATEGORIES).put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: taxonomy });
          installations.put(installation);
          transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        };
        previousRequest.onerror = () => transaction.abort();
        transaction.oncomplete = () => resolve(rollbackId);
        transaction.onabort = () => resolve(null);
        transaction.onerror = () => resolve(null);
      } catch (error) {
        console.error("IndexedDB: Failed to apply Community taxonomy", error);
        resolve(null);
      }
    });
  }

  async rollbackCommunityTaxonomy(rollbackId: string): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.CATEGORIES, STORES.COMMUNITY_INSTALLATIONS, STORES.COMMUNITY_ROLLBACKS, STORES.METADATA],
          "readwrite",
        );
        const request = transaction.objectStore(STORES.COMMUNITY_ROLLBACKS).get(rollbackId);
        request.onsuccess = () => {
          const rollback = request.result as CommunityRollbackRecord | undefined;
          if (!rollback) {
            transaction.abort();
            return;
          }
          transaction.objectStore(STORES.CATEGORIES).put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: rollback.taxonomy });
          const installations = transaction.objectStore(STORES.COMMUNITY_INSTALLATIONS);
          if (rollback.previousInstallation) installations.put(rollback.previousInstallation);
          else installations.delete(rollback.installationId);
          transaction.objectStore(STORES.COMMUNITY_ROLLBACKS).delete(rollbackId);
          transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        };
        request.onerror = () => transaction.abort();
        transaction.oncomplete = () => resolve(true);
        transaction.onabort = () => resolve(false);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to roll back Community taxonomy", error);
        resolve(false);
      }
    });
  }

  private async getCommunityRecord<T>(storeName: string, id: string): Promise<T | null> {
    if (!(await this.ensureReady())) return null;
    return new Promise((resolve) => {
      try {
        const request = this.db!.transaction(storeName, "readonly").objectStore(storeName).get(id);
        request.onsuccess = () => {
          if (!request.result) return resolve(null);
          const { id: _id, ...record } = request.result;
          resolve(record as T);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async putCommunityRecord(storeName: string, value: unknown): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(value);
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch {
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

  async saveTrack(uri: string, data: TrackData, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.TRACKS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const trackStore = transaction.objectStore(STORES.TRACKS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        trackStore.put({ uri, ...data });
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        appendIntent(transaction, options?.captureSync === false ? null : makeEntityReplaceIntent(uri, "track", data));
        noteLocalFileChange(transaction, uri, options?.captureSync !== false);

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save track", error);
        resolve(false);
      }
    });
  }

  async deleteTrack(uri: string, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.TRACKS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const trackStore = transaction.objectStore(STORES.TRACKS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        trackStore.delete(uri);
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        appendIntent(transaction, options?.captureSync === false ? null : makeEntityDeleteIntent(uri, "track"));
        noteLocalFileChange(transaction, uri, options?.captureSync !== false);

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
    return this.saveTrackChanges(
      new Map<string, TrackData | null>(tracks)
    );
  }

  async saveTrackChanges(
    changes: Map<string, TrackData | null>
  ): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.TRACKS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const trackStore = transaction.objectStore(STORES.TRACKS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        const batchId = crypto.randomUUID();
        for (const [uri, data] of changes) {
          noteLocalFileChange(transaction, uri);
          if (data === null) {
            trackStore.delete(uri);
            appendIntent(
              transaction,
              makeEntityDeleteIntent(uri, "track", batchId)
            );
          } else {
            trackStore.put({ uri, ...data });
            appendIntent(
              transaction,
              makeEntityReplaceIntent(uri, "track", data, batchId)
            );
          }
        }

        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save track changes", error);
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

  async savePlaylist(uri: string, data: PlaylistData, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.PLAYLISTS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        playlistStore.put({ uri, ...data });
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        appendIntent(transaction, options?.captureSync === false ? null : makeEntityReplaceIntent(uri, "playlist", data));

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save playlist", error);
        resolve(false);
      }
    });
  }

  async deletePlaylist(uri: string, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.PLAYLISTS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        playlistStore.delete(uri);
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        appendIntent(transaction, options?.captureSync === false ? null : makeEntityDeleteIntent(uri, "playlist"));

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
          [STORES.PLAYLISTS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        const batchId = crypto.randomUUID();
        for (const [uri, data] of playlists) {
          playlistStore.put({ uri, ...data });
          appendIntent(transaction, makeEntityReplaceIntent(uri, "playlist", data, batchId));
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

  async saveArtist(uri: string, data: ArtistData, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.ARTISTS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const artistStore = transaction.objectStore(STORES.ARTISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        artistStore.put({ uri, ...data });
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        appendIntent(transaction, options?.captureSync === false ? null : makeEntityReplaceIntent(uri, "artist", data));

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save artist", error);
        resolve(false);
      }
    });
  }

  async deleteArtist(uri: string, options?: { captureSync?: boolean }): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.ARTISTS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const artistStore = transaction.objectStore(STORES.ARTISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        artistStore.delete(uri);
        metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        appendIntent(transaction, options?.captureSync === false ? null : makeEntityDeleteIntent(uri, "artist"));

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
          [STORES.ARTISTS, STORES.METADATA, STORES.OUTBOX],
          "readwrite"
        );
        const artistStore = transaction.objectStore(STORES.ARTISTS);
        const metadataStore = transaction.objectStore(STORES.METADATA);

        const batchId = crypto.randomUUID();
        for (const [uri, data] of artists) {
          artistStore.put({ uri, ...data });
          appendIntent(transaction, makeEntityReplaceIntent(uri, "artist", data, batchId));
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

  async getAllSmartPlaylists(): Promise<SmartPlaylistCriteria[]> {
    if (!(await this.ensureReady())) {
      throw new Error("IndexedDB: Smart Playlists could not be opened");
    }

    return new Promise((resolve, reject) => {
      try {
        const request = this.db!
          .transaction(STORES.SMART_PLAYLISTS, "readonly")
          .objectStore(STORES.SMART_PLAYLISTS)
          .getAll();
        request.onsuccess = () => {
          const normalized = normalizeSmartPlaylistCriteriaList(request.result);
          if (normalized.length !== request.result.length) {
            reject(new Error("IndexedDB: Saved Smart Playlist rules need recovery"));
            return;
          }
          resolve(normalized);
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB: Failed to get Smart Playlists"));
      } catch (error) {
        console.error("IndexedDB: Failed to get smart playlists", error);
        reject(error);
      }
    });
  }

  /** Append shared setups and their new tags together; never rewrite song data or existing rules. */
  async installSharedSmartPlaylistSetups(bundle: SmartPlaylistRecipeBundle, selections: SmartPlaylistRecipeSelection[], accountDatabase = getTagifyDatabaseName()): Promise<InstalledSmartPlaylistRecipes> {
    if (!(await this.ensureReady())) throw new Error("Your library is still loading. Please try again.");
    const checkAccount = () => { if (getTagifyDatabaseName() !== accountDatabase || this.db?.name !== accountDatabase) throw new Error("Your account changed. Open the share again for your current account."); };
    checkAccount();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        [STORES.CATEGORIES, STORES.SMART_PLAYLISTS, STORES.METADATA, STORES.OUTBOX, SYNC_STORES.STATE], "readwrite",
      );
      const categories = transaction.objectStore(STORES.CATEGORIES).getAll();
      const playlists = transaction.objectStore(STORES.SMART_PLAYLISTS).getAll();
      const shadow = transaction.objectStore(SYNC_STORES.STATE).get("taxonomy-shadow");
      const outbox = transaction.objectStore(STORES.OUTBOX).getAll();
      let installed: InstalledSmartPlaylistRecipes;
      let failure: unknown;
      outbox.onsuccess = () => {
        try {
          checkAccount();
          const currentTaxonomy = categories.result.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.TAXONOMY)?.data;
          const taxonomy = currentTaxonomy ?? normalizeTagDataStructure({ categories: categories.result.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES)?.data ?? [], tracks: {} }).taxonomy;
          const current = normalizeSmartPlaylistCriteriaList(playlists.result);
          if (current.length !== playlists.result.length) throw new Error("Your saved smart playlists could not be read. Nothing was added. Please try again.");
          installed = installSmartPlaylistRecipeBundle(bundle, taxonomy, current, Date.now(), selections);
          if (!installed.importedCount) return;
          const existingIds = new Set(current.map((playlist) => playlist.id));
          installed.playlists.filter((playlist) => !existingIds.has(playlist.id)).forEach((playlist) => transaction.objectStore(STORES.SMART_PLAYLISTS).add(playlist));
          if (installed.createdTagCount > 0) {
            transaction.objectStore(STORES.CATEGORIES).put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: installed.taxonomy });
            const pending = (outbox.result as LocalSyncIntent[]).filter((intent): intent is TaxonomyReplaceIntent => intent.type === "taxonomy.replace").sort((a, b) => a.createdAt - b.createdAt)[0];
            const base = pending ? pending.base : shadow.result ? taxonomyFromShadowRecord(shadow.result as TaxonomyShadowRecord) : undefined;
            appendIntent(transaction, makeTaxonomyIntent(installed.taxonomy, undefined, base));
          }
          transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(installed!);
      transaction.onerror = transaction.onabort = () => reject(failure ?? new Error("Tagify couldn’t save these setups. Nothing was added. Please try again."));
    });
  }

  async saveSmartPlaylists(
    playlists: SmartPlaylistCriteria[],
  ): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    const normalized = normalizeSmartPlaylistCriteriaList(playlists);
    if (normalized.length !== playlists.length ||
        new Set(normalized.map((playlist) => playlist.id)).size !== normalized.length) {
      console.error("IndexedDB: Refusing to replace Smart Playlists with invalid or duplicate rules");
      return false;
    }

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [STORES.SMART_PLAYLISTS, STORES.METADATA],
          "readwrite",
        );
        const store = transaction.objectStore(STORES.SMART_PLAYLISTS);
        store.clear();
        normalized.forEach((playlist) => store.put(playlist));
        transaction
          .objectStore(STORES.METADATA)
          .put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save smart playlists", error);
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

  async clearAll(): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    if (makeSnapshotIntent("reset")) {
      console.error("Tagify: A linked cloud library must be reset through the staged online reset flow");
      return false;
    }

    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(
          [
            STORES.TRACKS,
            STORES.PLAYLISTS,
            STORES.ARTISTS,
            STORES.SMART_PLAYLISTS,
            STORES.CATEGORIES,
            STORES.METADATA,
          ],
          "readwrite"
        );

        transaction.objectStore(STORES.TRACKS).clear();
        transaction.objectStore(STORES.PLAYLISTS).clear();
        transaction.objectStore(STORES.ARTISTS).clear();
        transaction.objectStore(STORES.SMART_PLAYLISTS).clear();
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
    const [trackCount, playlistCount, artistCount, smartPlaylists] = await Promise.all([
      this.getTrackCount(),
      this.getPlaylistCount(),
      this.getArtistCount(),
      this.getAllSmartPlaylists(),
    ]);
    const taxonomy = await this.getTaxonomy();
    const lastModified = await this.getLastModified();

    return {
      backend: "indexeddb",
      trackCount,
      playlistCount,
      artistCount,
      smartPlaylistCount: smartPlaylists.length,
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

function portableSmartPlaylistDefinitions(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
    const {
      lastSyncAt: _lastSyncAt,
      smartPlaylistTrackUris: _smartPlaylistTrackUris,
      ...definition
    } = candidate as Record<string, unknown>;
    return [definition];
  });
}

// Export singleton instance
export const indexedDBStorage = new IndexedDBStorageService();
