import type { LocalPrivateNote } from "@/services/sync/PrivateNotes.types";
import { isPrivateNoteUri } from "@tagify/sync-contracts";
import { detachInconsistentRecordingGroups, expandRecordingEdits, normalizeRecordingIdentity, recordingAnnotations, recordingConflict, sameRecording, similarRecording } from "@/features/recording-reuse/utils/recordingReuse";
import type { RecordingChoices } from "@/features/recording-reuse/utils/recordingLibrary";
import type { RecordingIdentity } from "@/types/tagData";
import { restoreBulkTrack, type BulkUndoEntry } from "@/features/multi-track-tagging/utils/bulkUndo";
import type { StatsBaseline } from "@/features/library-stats/model/libraryStats";
import { applyBatchTagUpdatesToData } from "@/features/tag-data/utils/tagData.batchUpdates";
import { defaultTagData } from "@/constants/defaultTagData";
import type { BatchTagUpdate } from "@/types/tagData";
import { addQuickTag } from "@/features/tag-data/utils/quickTag";
import { rebaseRecord, type RebaseRecordOptions } from "@/features/tag-data/utils/tagData.rebase";
import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TagTaxonomy,
  TaxonomyTag,
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
import { knownCloudTaxonomy, rebuildDeviceTaxonomy } from "@/services/sync/PreserveLocalTaxonomyMetadata";
import { flattenTaxonomy, keepTaxonomyTombstones, taxonomyFromShadowRecord, type TaxonomyShadowRecord } from "@/services/sync/SyncTaxonomy";
import type { ReplicaManifest } from "@/services/sync/SyncLocalState";
import { IStorageService, StorageMetadata } from "./IStorageService";
import {
  hasCustomTaxonomy,
  normalizeSmartPlaylistCriteriaList,
  normalizeTagDataStructure,
} from "@/features/tag-data/utils/tagData.schema";
import {
  buildCategoryTree,
  buildValidTagIdSet,
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
  preserveDeviceAnnotation,
  STATS_BASELINE_CHANGED_EVENT,
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

interface SmartPlaylistTrackTransaction {
  prepare: (playlists: SmartPlaylistCriteria[]) => void;
  update: (playlists: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[];
}

interface RecordingLookupCache {
  identity?: RecordingIdentity;
  retryAt?: number;
  failures?: number;
  foreground?: number[];
  background?: number[];
}

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

const DATABASE_OPEN_TIMEOUT_MS = 10_000;
const UNREADABLE_LIBRARY_MESSAGE = "Your saved library could not be read. Please try again.";

/**
 * The saved taxonomy from the categories store: the current document, or one
 * built from the older categories document. Null only when neither exists.
 */
function taxonomyFromCategoryDocuments(taxonomyRecord: unknown, legacyRecord: unknown): TagTaxonomy | null {
  const taxonomy = (taxonomyRecord as { data?: TagTaxonomy } | undefined)?.data;
  if (taxonomy) return taxonomy;
  const legacy = (legacyRecord as { data?: unknown } | undefined)?.data;
  return Array.isArray(legacy) ? normalizeTagDataStructure({ categories: legacy, tracks: {} }).taxonomy : null;
}

/**
 * Aborts `transaction` before it commits when the library already holds
 * anything the user made. The checks are queued ahead of the transaction's
 * writes, so a refused replacement never changes the saved library.
 */
function abortUnlessLibraryEmpty(transaction: IDBTransaction, onRefused: () => void): void {
  const counts = [STORES.TRACKS, STORES.PLAYLISTS, STORES.ARTISTS, STORES.SMART_PLAYLISTS]
    .map((store) => transaction.objectStore(store).count());
  const categories = transaction.objectStore(STORES.CATEGORIES).getAll();
  categories.onsuccess = () => {
    const records = categories.result as Array<{ id: string }>;
    const taxonomy = taxonomyFromCategoryDocuments(
      records.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.TAXONOMY),
      records.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES),
    );
    if (counts.some((count) => count.result > 0) || hasCustomTaxonomy(taxonomy)) {
      onRefused();
      try { transaction.abort(); } catch { /* already finishing */ }
    }
  };
}

/**
 * Settles with whether `transaction` committed. A failure while committing
 * (for example when the device runs out of space) fires only `abort`, so
 * listening for errors alone would leave the save waiting forever.
 */
function transactionCommitted(transaction: IDBTransaction, action: string): Promise<boolean> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => {
      console.error(`IndexedDB: ${action} did not finish`, transaction.error);
      resolve(false);
    };
  });
}

function abortQuietly(transaction: IDBTransaction | null): void {
  try {
    transaction?.abort();
  } catch {
    // The transaction already finished or was aborted.
  }
}

export interface SyncTransactionReads {
  tracks?: string[];
  playlists?: string[];
  artists?: string[];
  taxonomy?: boolean;
  stateKeys?: string[];
  appStateDomains?: string[];
}

export interface SyncTransactionContext {
  /** Requested tracks plus every linked release of them. */
  tracks: Record<string, TrackData>;
  playlists: Record<string, PlaylistData>;
  artists: Record<string, ArtistData>;
  taxonomy: TagTaxonomy | null;
  state: Record<string, unknown>;
  appState: Record<string, DurableAppStateDocumentV2>;
  /** Every queued edit, oldest first. */
  outbox: LocalSyncIntent[];
}

export interface SyncTransactionWrites<T> {
  /** A null record removes it. */
  tracks?: Record<string, TrackData | null>;
  playlists?: Record<string, PlaylistData | null>;
  artists?: Record<string, ArtistData | null>;
  taxonomy?: TagTaxonomy;
  state?: unknown[];
  deleteState?: string[];
  appState?: DurableAppStateDocumentV2[];
  conflicts?: unknown[];
  intents?: LocalSyncIntent[];
  deleteIntents?: string[];
  result: T;
}

/** The library as saved in IndexedDB. Throws rather than dropping unreadable Smart Playlists. */
function tagDataFromStoreRecords(
  categories: Array<{ id: string; data?: unknown }>,
  tracks: Array<{ uri: string } & TrackData>,
  playlists: Array<{ uri: string } & PlaylistData>,
  artists: Array<{ uri: string } & ArtistData>,
  smartPlaylists: unknown[],
): TagDataStructure {
  const byUri = (records: Array<{ uri: string }>) => Object.fromEntries(records.map(({ uri, ...value }) => [uri, value]));
  const taxonomy = categories.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.TAXONOMY)?.data;
  const normalized = normalizeTagDataStructure({
    ...(taxonomy ? { schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy } : {
      categories: categories.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES)?.data ?? [],
    }),
    tracks: byUri(tracks), playlists: byUri(playlists), artists: byUri(artists),
    smartPlaylists,
  });
  normalized.smartPlaylists = normalizeSmartPlaylistCriteriaList(smartPlaylists);
  if (normalized.smartPlaylists.length !== smartPlaylists.length) throw new Error("Your saved Smart Playlists need recovery before syncing.");
  for (const record of tracks) {
    if (record.dateModified !== undefined && normalized.tracks[record.uri]) normalized.tracks[record.uri].dateModified = record.dateModified;
  }
  return normalized;
}

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

  /**
   * Name of the browser error from the last failed open, if any. "VersionError"
   * means a newer Tagify already upgraded this library, which older code can
   * never open.
   */
  lastOpenErrorName: string | null = null;

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
      let settled = false;
      const settle = (opened: boolean): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timeout);
        resolve(opened);
        return true;
      };
      // An open request can wait forever while another Tagify window holds an
      // older connection. Report it as unavailable instead of hanging startup.
      const timeout = setTimeout(() => {
        console.error("IndexedDB: Opening the database timed out");
        settle(false);
      }, DATABASE_OPEN_TIMEOUT_MS);

      try {
        const request = indexedDB.open(getTagifyDatabaseName(), DB_VERSION);

        request.onerror = (event) => {
          console.error("IndexedDB: Failed to open database", request.error ?? event);
          this.lastOpenErrorName = request.error?.name ?? null;
          settle(false);
        };

        request.onblocked = () => {
          console.warn("IndexedDB: Waiting for another Tagify window to release the database");
        };

        request.onsuccess = () => {
          const db = request.result;
          // A connection that arrives after the timeout was already reported
          // as unavailable; close it so the next init opens a fresh one.
          if (settled) {
            db.close();
            return;
          }
          this.db = db;
          this.lastOpenErrorName = null;

          // Handle connection errors
          db.onerror = (event) => {
            console.error("IndexedDB: Database error", event);
          };

          // Another Tagify bundle needs to upgrade the database. Close this
          // connection so it isn't blocked; the next operation reopens lazily.
          db.onversionchange = () => {
            db.close();
            if (this.db === db) this.db = null;
            console.warn(
              "IndexedDB: Database version changed, connection closed"
            );
          };
          // The browser can close a connection itself (for example when site
          // data is cleared). Reopen on the next operation.
          db.onclose = () => {
            if (this.db === db) this.db = null;
          };

          settle(true);
        };

        request.onupgradeneeded = (event) => {
          // An upgrade is progressing, not blocked; let it finish.
          clearTimeout(timeout);
          const db = (event.target as IDBOpenDBRequest).result;
          const transaction = (event.target as IDBOpenDBRequest).transaction;
          IndexedDBStorageService.createSchema(db, transaction ?? undefined);
        };
      } catch (error) {
        console.error("IndexedDB: Exception during init", error);
        settle(false);
      }
    });
  }

  private static ensureTrackIndexes(trackStore: IDBObjectStore): void {
    if (!trackStore.indexNames.contains("by-recording-group")) trackStore.createIndex("by-recording-group", "recordingGroupId", { unique: false });
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

  /**
   * Whether the saved library holds any data. Throws when it can't be opened
   * or read, so a failure is never mistaken for an empty library.
   */
  async isInitialized(): Promise<boolean> {
    if (!(await this.ensureReady())) {
      throw new Error(UNREADABLE_LIBRARY_MESSAGE);
    }

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
          resolve(tagDataFromStoreRecords(categories.result, tracks.result, playlists.result, artists.result, smartPlaylists.result));
        } catch (error) { reject(error); }
      };
    });
  }

  /**
   * Replaces the whole saved library in one transaction. With `onlyIfEmpty`,
   * nothing is written (and false is returned) when the library already holds
   * anything the user made, checked inside the same transaction.
   */
  async saveAll(
    data: TagDataStructure,
    snapshotReason: SnapshotReplaceIntent["reason"] = "import",
    options: { onlyIfEmpty?: boolean } = {},
  ): Promise<boolean> {
    if (!(await this.ensureReady())) {
      console.error("IndexedDB: Database not initialized");
      return false;
    }

    let transaction: IDBTransaction | null = null;
    try {
      transaction = this.db!.transaction(
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
      const committed = transactionCommitted(transaction, "Replacing the library");
      if (options.onlyIfEmpty) {
        abortUnlessLibraryEmpty(transaction, () => console.warn("IndexedDB: Kept the saved library because it is not empty"));
      }

      const trackStore = transaction.objectStore(STORES.TRACKS);
      const playlistStore = transaction.objectStore(STORES.PLAYLISTS);
      const artistStore = transaction.objectStore(STORES.ARTISTS);
      const smartPlaylistStore = transaction.objectStore(STORES.SMART_PLAYLISTS);
      const categoryStore = transaction.objectStore(STORES.CATEGORIES);
      const metadataStore = transaction.objectStore(STORES.METADATA);

      // Replacing the library starts a new editing history.
      metadataStore.delete("bulkUndo");
      metadataStore.delete("bulkRedo");
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

      return committed;
    } catch (error) {
      // A write that throws after the clears must not commit a partly
      // replaced library.
      console.error("IndexedDB: Failed to save all data", error);
      abortQuietly(transaction);
      return false;
    }
  }

  async replaceCloudReplica(
    data: TagDataStructure,
    manifest: ReplicaManifest,
    syncStateRecords: unknown[],
    appState: DurableAppStateDocumentV2[],
    localAppState: DurableAppStateDocumentV2[] = [],
    options: { keepQueuedEdits?: boolean; annotationDates?: "device" | "canonical" } = {},
  ): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    const stores = [
      STORES.TRACKS, STORES.PLAYLISTS, STORES.ARTISTS, STORES.SMART_PLAYLISTS, STORES.CATEGORIES, STORES.METADATA,
      SYNC_STORES.OUTBOX, SYNC_STORES.STATE, SYNC_STORES.CONFLICTS, SYNC_STORES.TOMBSTONES,
      SYNC_STORES.APP_STATE, SYNC_STORES.RECOVERY_CHECKPOINT,
    ];
    return new Promise((resolve) => {
      let transaction: IDBTransaction;
      try {
        transaction = this.db!.transaction(stores, "readwrite");
      } catch (error) {
        console.error("IndexedDB: Atomic cloud restore failed", error);
        resolve(false);
        return;
      }
      // Read the device library and queued edits inside the replacement itself,
      // so an edit saved moments ago is kept instead of an older copy.
      const categories = transaction.objectStore(STORES.CATEGORIES).getAll();
      const tracks = transaction.objectStore(STORES.TRACKS).getAll();
      const playlists = transaction.objectStore(STORES.PLAYLISTS).getAll();
      const artists = transaction.objectStore(STORES.ARTISTS).getAll();
      const smartPlaylists = transaction.objectStore(STORES.SMART_PLAYLISTS).getAll();
      const statsBaseline = transaction.objectStore(STORES.METADATA).get("statsBaseline");
      const cloudTaxonomy = transaction.objectStore(SYNC_STORES.STATE).get("taxonomy-shadow");
      const queued = options.keepQueuedEdits
        ? transaction.objectStore(SYNC_STORES.OUTBOX).index("by-created-at").getAll()
        : null;
      const writeReplica = () => {
        try {
          const previous = tagDataFromStoreRecords(categories.result, tracks.result, playlists.result, artists.result, smartPlaylists.result);
          const pendingIntents = (queued?.result ?? []) as LocalSyncIntent[];
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
          // Taxonomy items the cloud has never received (still waiting to back
          // up) stay; items it removed do not come back.
          const knownShadow = cloudTaxonomy.result as TaxonomyShadowRecord | undefined;
          let taxonomy = rebuildDeviceTaxonomy(
            preserveLocalFileTags(data.taxonomy, previous.taxonomy, localOnlyTracks),
            previous.taxonomy,
            knownShadow ? knownCloudTaxonomy(knownShadow, flattenTaxonomy(data.taxonomy)) : undefined,
          );
          // Cloud annotations carry tags, ratings, energy, BPM, and key only. Keep
          // each existing record's timestamps, cached details, and the original
          // values Community stores in a normalized form.
          const preserve = <T extends TrackData | PlaylistData | ArtistData>(incoming: Record<string, T>, existing: Record<string, T>, kind: "track" | "playlist" | "artist") =>
            Object.fromEntries(Object.entries({ ...localOnly(existing, kind), ...incoming }).map(([uri, value]) => {
              const before = existing[uri];
              return [uri, before ? preserveDeviceAnnotation({ ...before, ...value }, before, kind, options.annotationDates) as T : value];
            })) as Record<string, T>;
          const next = {
            tracks: preserve(data.tracks, previous.tracks, "track"),
            playlists: preserve(data.playlists, previous.playlists, "playlist"),
            artists: preserve(data.artists, previous.artists, "artist"),
          };
          // Unsent edits from this device stay on the device and remain queued, so
          // they back up on top of the refreshed cloud copy instead of being lost.
          for (const intent of pendingIntents) {
            if (intent.type === "taxonomy.replace") {
              taxonomy = previous.taxonomy;
            } else if (intent.type === "entity.replace" || intent.type === "entity.delete") {
              const uri = `spotify:${intent.entity.kind}:${intent.entity.providerId}`;
              const key = intent.entity.kind === "track" ? "tracks" : intent.entity.kind === "artist" ? "artists" : "playlists";
              const record = (previous[key] as Record<string, TrackData | PlaylistData | ArtistData>)[uri];
              const records = next[key] as Record<string, TrackData | PlaylistData | ArtistData>;
              if (intent.type === "entity.delete" || !record) delete records[uri];
              else records[uri] = record;
            }
          }
          next.tracks = detachInconsistentRecordingGroups(next.tracks);

          stores.forEach((store) => transaction.objectStore(store).clear());
          transaction.objectStore(SYNC_STORES.RECOVERY_CHECKPOINT).put({
            key: "pre-restore", createdAt: new Date().toISOString(), data: previous,
          });
          transaction.objectStore(STORES.CATEGORIES).put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: taxonomy });
          Object.entries(next.tracks).forEach(([uri, value]) => transaction.objectStore(STORES.TRACKS).put({ uri, ...value }));
          Object.entries(next.playlists).forEach(([uri, value]) => transaction.objectStore(STORES.PLAYLISTS).put({ uri, ...value }));
          Object.entries(next.artists).forEach(([uri, value]) => transaction.objectStore(STORES.ARTISTS).put({ uri, ...value }));
          durableSmartPlaylists.forEach((value) => transaction.objectStore(STORES.SMART_PLAYLISTS).put(value));
          transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.VERSION, value: TAG_DATA_SCHEMA_VERSION });
          // A device's first-open Stats baseline must not override reviewed
          // song dates. The empty baseline keeps synced tracks on their saved
          // first-tagged dates, including when Stats first opens on a new device.
          const previousBaseline = statsBaseline.result?.value as StatsBaseline | undefined;
          if (options.annotationDates === "canonical" || !previousBaseline) {
            const canonicalBaseline: StatsBaseline = {
              takenAt: previousBaseline?.takenAt ?? 0,
              dates: Object.fromEntries(Object.entries(previousBaseline?.dates ?? {}).filter(([uri]) => uri in localOnlyTracks)),
            };
            transaction.objectStore(STORES.METADATA).put({ key: "statsBaseline", value: canonicalBaseline });
          } else transaction.objectStore(STORES.METADATA).put(statsBaseline.result);
          pendingIntents.forEach((intent) => transaction.objectStore(SYNC_STORES.OUTBOX).put(intent));
          // Items the previous cloud copy had but this one doesn't were removed
          // elsewhere; keep them marked deleted so they are never sent again.
          syncStateRecords.forEach((record) => transaction.objectStore(SYNC_STORES.STATE).put(
            (record as { key?: string }).key === "taxonomy-shadow"
              ? keepTaxonomyTombstones(record as TaxonomyShadowRecord, knownShadow)
              : record,
          ));
          transaction.objectStore(SYNC_STORES.STATE).put(manifest);
          appState.forEach((document) => transaction.objectStore(SYNC_STORES.APP_STATE).put(document));
        } catch (error) {
          console.error("IndexedDB: Atomic cloud restore failed", error);
          transaction.abort();
        }
      };
      // Requests in one transaction finish in order; the last one sees every read.
      (queued ?? cloudTaxonomy).onsuccess = writeReplica;
      transaction.oncomplete = () => {
        window.dispatchEvent(new Event(STATS_BASELINE_CHANGED_EVENT));
        resolve(true);
      };
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    });
  }

  /**
   * Runs one sync step as a single transaction across the library, the
   * outbox, and sync state. `plan` sees the saved records, the queued edits,
   * and the requested sync state, and returns what to write; edits saved
   * meanwhile wait for it, so they are never read stale or overwritten.
   * Nothing is written when `plan` throws.
   */
  async runSyncTransaction<T>(reads: SyncTransactionReads, plan: (context: SyncTransactionContext) => SyncTransactionWrites<T>): Promise<T> {
    if (!(await this.ensureReady())) throw new Error("Your saved Tagify details could not be read. Please try again.");
    if (this.db!.name !== getTagifyDatabaseName()) throw new Error("Your Community account changed. Tagify will sync again shortly.");
    return new Promise<T>((resolve, reject) => {
      const tx = this.db!.transaction([
        STORES.TRACKS, STORES.PLAYLISTS, STORES.ARTISTS, STORES.CATEGORIES, STORES.METADATA, STORES.OUTBOX,
        SYNC_STORES.STATE, SYNC_STORES.APP_STATE, SYNC_STORES.CONFLICTS,
      ], "readwrite");
      const context: SyncTransactionContext = { tracks: {}, playlists: {}, artists: {}, taxonomy: null, state: {}, appState: {}, outbox: [] };
      let pending = 0;
      let planned = false;
      let failed = false;
      let result: T;
      const finish = () => {
        if (pending || planned) return;
        planned = true;
        try {
          const writes = plan(context);
          result = writes.result;
          const put = (storeName: string, records: Record<string, unknown> | undefined) => Object.entries(records ?? {}).forEach(([uri, value]) => {
            if (value) tx.objectStore(storeName).put({ uri, ...(value as object) });
            else tx.objectStore(storeName).delete(uri);
          });
          put(STORES.TRACKS, writes.tracks);
          put(STORES.PLAYLISTS, writes.playlists);
          put(STORES.ARTISTS, writes.artists);
          if (writes.taxonomy) {
            const categories = tx.objectStore(STORES.CATEGORIES);
            categories.clear();
            categories.put({ id: CATEGORY_DOCUMENT_KEYS.TAXONOMY, data: writes.taxonomy });
          }
          if (writes.taxonomy || [writes.tracks, writes.playlists, writes.artists].some((records) => records && Object.keys(records).length)) {
            tx.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          }
          writes.state?.forEach((record) => tx.objectStore(SYNC_STORES.STATE).put(record));
          writes.deleteState?.forEach((key) => tx.objectStore(SYNC_STORES.STATE).delete(key));
          writes.appState?.forEach((document) => tx.objectStore(SYNC_STORES.APP_STATE).put(document));
          writes.conflicts?.forEach((conflict) => tx.objectStore(SYNC_STORES.CONFLICTS).put(conflict));
          writes.deleteIntents?.forEach((id) => tx.objectStore(STORES.OUTBOX).delete(id));
          writes.intents?.forEach((intent) => appendIntent(tx, intent));
        } catch (error) {
          failed = true;
          reject(error);
          tx.abort();
        }
      };
      const read = <R>(request: IDBRequest<R>, apply: (value: R) => void) => {
        pending++;
        request.onsuccess = () => { apply(request.result); pending--; finish(); };
      };
      const records = <R>(storeName: string, uris: string[] | undefined, target: Record<string, R>, onRecord?: (record: R) => void) => {
        for (const uri of new Set(uris ?? [])) read(tx.objectStore(storeName).get(uri), (record: ({ uri?: string } & R) | undefined) => {
          if (!record) return;
          const value = { ...record };
          delete value.uri;
          target[uri] = value as R;
          onRecord?.(value as R);
        });
      };
      const loadedGroups = new Set<string>();
      records<TrackData>(STORES.TRACKS, reads.tracks, context.tracks, (track) => {
        // Linked releases share their tagging, so read every member.
        if (!track.recordingGroupId || loadedGroups.has(track.recordingGroupId)) return;
        loadedGroups.add(track.recordingGroupId);
        read(tx.objectStore(STORES.TRACKS).index("by-recording-group").getAll(track.recordingGroupId), (members: Array<{ uri: string } & TrackData>) => {
          members.forEach(({ uri, ...member }) => { context.tracks[uri] ??= member; });
        });
      });
      records<PlaylistData>(STORES.PLAYLISTS, reads.playlists, context.playlists);
      records<ArtistData>(STORES.ARTISTS, reads.artists, context.artists);
      if (reads.taxonomy) {
        // Libraries saved by older versions can hold only the older categories document.
        read(tx.objectStore(STORES.CATEGORIES).getAll(), (records: Array<{ id: string }>) => {
          context.taxonomy = taxonomyFromCategoryDocuments(
            records.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.TAXONOMY),
            records.find((record) => record.id === CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES),
          );
        });
      }
      for (const key of new Set(reads.stateKeys ?? [])) read(tx.objectStore(SYNC_STORES.STATE).get(key), (value: unknown) => {
        if (value !== undefined) context.state[key] = value;
      });
      for (const domain of new Set(reads.appStateDomains ?? [])) read(tx.objectStore(SYNC_STORES.APP_STATE).get(domain), (value: DurableAppStateDocumentV2 | undefined) => {
        if (value) context.appState[domain] = value;
      });
      read(tx.objectStore(STORES.OUTBOX).index("by-created-at").getAll(), (intents: LocalSyncIntent[]) => { context.outbox = intents; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => { if (!failed) reject(tx.error ?? new Error("Tagify couldn't save changes from your other devices. It will try again.")); };
    });
  }

  /** A failed read throws; it must never look like an empty set of tags. */
  async getTaxonomy(): Promise<TagTaxonomy> {
    if (!(await this.ensureReady())) {
      throw new Error("Your saved tags could not be read. Please try again.");
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORES.CATEGORIES, "readonly");
      const store = transaction.objectStore(STORES.CATEGORIES);
      const taxonomy = store.get(CATEGORY_DOCUMENT_KEYS.TAXONOMY);
      const legacy = store.get(CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Your saved tags could not be read. Please try again."));
      transaction.oncomplete = () => resolve(taxonomyFromCategoryDocuments(taxonomy.result, legacy.result) ?? createEmptyTaxonomy());
    });
  }

  async saveTaxonomy(taxonomyOrMutation: TagTaxonomy | ((current: TagTaxonomy) => TagTaxonomy), options?: { captureSync?: boolean }): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        let taxonomy = typeof taxonomyOrMutation === "function" ? createEmptyTaxonomy() : taxonomyOrMutation;
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

        // A library saved by an older Tagify can hold only the older categories
        // document; a change must start from it, never from an empty taxonomy.
        // Sync also needs the stored tags as the starting point of an edit.
        const readStored = typeof taxonomyOrMutation === "function" || capture;
        const legacyRequest = readStored
          ? categoryStore.get(CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES) : null;
        const currentRequest = readStored
          ? categoryStore.get(CATEGORY_DOCUMENT_KEYS.TAXONOMY) : null;
        const prepare = () => {
          if (typeof taxonomyOrMutation === "function") {
            taxonomy = taxonomyOrMutation(
              taxonomyFromCategoryDocuments(currentRequest?.result, legacyRequest?.result) ?? createEmptyTaxonomy(),
            );
          }
        };
        if (!capture) {
          if (currentRequest) currentRequest.onsuccess = () => {
            try { prepare(); write(null); } catch { transaction.abort(); }
          };
          else write(null);
        } else {
          // Record the tags this device had before its first unsent edit, so
          // sync sends only what the user changed here. Comparing against the
          // cloud copy instead would delete or revert changes another device
          // made that this device has not shown yet. A still-unsent edit keeps
          // its earlier starting point.
          const shadowRequest = transaction.objectStore(SYNC_STORES.STATE).get("taxonomy-shadow");
          const outboxRequest = transaction.objectStore(STORES.OUTBOX).getAll();
          outboxRequest.onsuccess = () => {
            const pending = (outboxRequest.result as LocalSyncIntent[])
              .filter((intent): intent is TaxonomyReplaceIntent => intent.type === "taxonomy.replace")
              .sort((left, right) => left.createdAt - right.createdAt)[0];
            const shadow = shadowRequest.result as TaxonomyShadowRecord | undefined;
            const stored = taxonomyFromCategoryDocuments(currentRequest?.result, legacyRequest?.result) ?? undefined;
            const base = pending ? pending.base : stored ?? (shadow ? taxonomyFromShadowRecord(shadow) : undefined);
            try { prepare(); write(makeTaxonomyIntent(taxonomy, undefined, base)); } catch { transaction.abort(); }
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

  async createQuickTag(name: string, parentId: string, expectedDatabaseName = getTagifyDatabaseName()): Promise<TaxonomyTag> {
    let tag: TaxonomyTag | undefined;
    const saved = await this.saveTaxonomy((current) => {
      if (this.db?.name !== expectedDatabaseName) throw new Error("Your account changed. Reopen the music before adding tags.");
      const result = addQuickTag(current, name, parentId);
      tag = result.tag;
      return result.taxonomy;
    });
    if (!saved || !tag) throw new Error("Tagify couldn't create your tag. Please try again.");
    return tag;
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
    let transaction: IDBTransaction | null = null;
    try {
      transaction = this.db!.transaction(
        [STORES.COMMUNITY_POLICY, STORES.COMMUNITY_INSTALLATIONS, STORES.COMMUNITY_ROLLBACKS],
        "readwrite",
      );
      const committed = transactionCommitted(transaction, "Restoring Community details");
      const policyStore = transaction.objectStore(STORES.COMMUNITY_POLICY);
      const installations = transaction.objectStore(STORES.COMMUNITY_INSTALLATIONS);
      policyStore.clear();
      installations.clear();
      transaction.objectStore(STORES.COMMUNITY_ROLLBACKS).clear();
      if (state.publicationPolicy) policyStore.put({ id: "publication-policy", ...state.publicationPolicy });
      if (state.ownerIdentityMapping) policyStore.put({ id: "owner-identity-mapping", ...state.ownerIdentityMapping });
      state.installations.forEach((installation) => installations.put(installation));
      return await committed;
    } catch (error) {
      // An invalid record must not leave the cleared stores committed.
      console.error("IndexedDB: Failed to restore Community backup state", error);
      abortQuietly(transaction);
      return false;
    }
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
    try {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const committed = transactionCommitted(transaction, "Saving Community details");
      transaction.objectStore(storeName).put(value);
      return await committed;
    } catch (error) {
      console.error("IndexedDB: Failed to save Community details", error);
      return false;
    }
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

    if (options?.captureSync !== false) return this.saveTrackChanges(new Map([[uri, data]]));
    try {
      await this.mutateBulkTracks([uri], (tracks, history) => ({ changes: expandRecordingEdits(tracks, { [uri]: data }), history, result: true }), uri);
      return true;
    } catch { return false; }
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

        const previous = trackStore.get(uri);
        previous.onsuccess = () => {
          trackStore.delete(uri);
          metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          appendIntent(transaction, options?.captureSync === false ? null : makeEntityDeleteIntent(uri, "track", undefined, previous.result ?? null));
          noteLocalFileChange(transaction, uri, options?.captureSync !== false);
        };

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
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

  /** Matching reads only its candidates; failures must never resemble missing songs. */
  async getRecordingTracks(uris: string[], account = getTagifyDatabaseName()): Promise<Record<string, TrackData>> {
    if (!(await this.ensureReady()) || this.db?.name !== account || account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music.");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.TRACKS, "readonly");
      const result: Record<string, TrackData> = {};
      [...new Set(uris)].forEach(uri => {
        const request = tx.objectStore(STORES.TRACKS).get(uri);
        request.onsuccess = () => {
          if (request.result) { const { uri: _, ...data } = request.result; result[uri] = data; }
        };
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(new Error("Your saved songs could not be read. Please try again."));
    });
  }

  /** Use the existing group index so a single edit never loads the whole library. */
  async getRecordingGroupTracksStrict(groups: string[], account = getTagifyDatabaseName()): Promise<Record<string, TrackData>> {
    const check = () => {
      if (this.db?.name !== account || account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music.");
    };
    if (!(await this.ensureReady())) throw new Error("Your saved songs are still loading. Please try again.");
    check();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.TRACKS, "readonly");
      const index = tx.objectStore(STORES.TRACKS).index("by-recording-group");
      const result: Record<string, TrackData> = {};
      [...new Set(groups)].forEach(group => {
        const request = index.getAll(group);
        request.onsuccess = () => {
          for (const { uri, ...data } of request.result) result[uri] = data;
        };
      });
      tx.oncomplete = () => { try { check(); resolve(result); } catch (error) { reject(error); } };
      tx.onerror = tx.onabort = () => reject(new Error("Your saved songs could not be read. Please try again."));
    });
  }

  async getRecordingLookup(uri: string, account = getTagifyDatabaseName()): Promise<RecordingLookupCache | undefined> {
    if (!(await this.ensureReady()) || this.db?.name !== account || account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music.");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.METADATA, "readonly");
      const request = tx.objectStore(STORES.METADATA).get(`recordingLookup:${uri}`);
      tx.oncomplete = () => resolve(request.result?.value);
      tx.onerror = tx.onabort = () => reject(new Error("Saved song checks could not be read. Please try again."));
    });
  }

  /** Device-local lookup results also cover releases not yet added to Tagify. */
  async cacheRecordingLookup(uri: string, value: RecordingLookupCache, account = getTagifyDatabaseName()) {
    if (!(await this.ensureReady()) || this.db?.name !== account || account !== getTagifyDatabaseName()) return;
    const tx = this.db!.transaction(STORES.METADATA, "readwrite");
    const committed = transactionCommitted(tx, "Remembering a song check");
    tx.objectStore(STORES.METADATA).put({ key: `recordingLookup:${uri}`, value });
    if (!(await committed)) throw new Error("This song check could not be saved. Please try again.");
  }

  /** Stats' first-open dates for this device and account; see `StatsBaseline`. */
  async getStatsBaseline(account = getTagifyDatabaseName()): Promise<StatsBaseline | null> {
    if (!(await this.ensureReady()) || this.db?.name !== account || account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen Stats.");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.METADATA, "readonly");
      const request = tx.objectStore(STORES.METADATA).get("statsBaseline");
      tx.oncomplete = () => resolve(request.result?.value ?? null);
      tx.onerror = tx.onabort = () => reject(new Error("Your stats could not be read. Please try again."));
    });
  }

  /** Saves the baseline once; an existing one is kept and returned, so the first one always wins. */
  async saveStatsBaseline(baseline: StatsBaseline, account = getTagifyDatabaseName()): Promise<StatsBaseline> {
    if (!(await this.ensureReady()) || this.db?.name !== account || account !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen Stats.");
    const tx = this.db!.transaction(STORES.METADATA, "readwrite");
    const committed = transactionCommitted(tx, "Saving your stats");
    const store = tx.objectStore(STORES.METADATA);
    let saved = baseline;
    const existing = store.get("statsBaseline");
    existing.onsuccess = () => {
      if (existing.result?.value) saved = existing.result.value;
      else store.put({ key: "statsBaseline", value: baseline });
    };
    if (!(await committed)) throw new Error("Your stats could not be saved. Please try again.");
    return saved;
  }

  async getBulkEditHistory(): Promise<{ undo: BulkUndoEntry | null; redo: BulkUndoEntry | null }> {
    const account = getTagifyDatabaseName();
    if (!(await this.ensureReady()) || this.db?.name !== account) return { undo: null, redo: null };
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.METADATA);
      const store = tx.objectStore(STORES.METADATA);
      const undo = store.get("bulkUndo");
      const redo = store.get("bulkRedo");
      tx.oncomplete = () => resolve({ undo: undo.result?.value?.at(-1) || null, redo: redo.result?.value?.at(-1) || null });
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLatestBulkUndo(): Promise<BulkUndoEntry | null> {
    return (await this.getBulkEditHistory()).undo;
  }

  private async mutateBulkTracks<T>(uris: string[], mutate: (
    current: Record<string, TrackData>, history: BulkUndoEntry[], taxonomy: TagTaxonomy, redo: BulkUndoEntry[],
  ) => { changes: Record<string, TrackData | null>; history: BulkUndoEntry[]; redo?: BulkUndoEntry[]; result: T }, skipSyncUri?: string, expectedDatabaseName?: string, smartPlaylists?: SmartPlaylistTrackTransaction): Promise<T> {
    if (!(await this.ensureReady())) throw new Error("Your tracks are still loading. Please try again.");
    if (expectedDatabaseName && this.db?.name !== expectedDatabaseName) throw new Error("Your account changed. Reopen the music before adding tags.");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORES.TRACKS, STORES.METADATA, STORES.OUTBOX, STORES.CATEGORIES,
        ...(smartPlaylists ? [STORES.SMART_PLAYLISTS] : [])], "readwrite");
      const playlistRequest = smartPlaylists ? tx.objectStore(STORES.SMART_PLAYLISTS).getAll() : undefined;
      const tracks = tx.objectStore(STORES.TRACKS);
      const metadata = tx.objectStore(STORES.METADATA);
      const taxonomyRequest = tx.objectStore(STORES.CATEGORIES).get(CATEGORY_DOCUMENT_KEYS.TAXONOMY);
      const legacyTaxonomyRequest = tx.objectStore(STORES.CATEGORIES).get(CATEGORY_DOCUMENT_KEYS.LEGACY_CATEGORIES);
      const redoRequest = metadata.get("bulkRedo");
      const historyRequest = metadata.get("bulkUndo");
      const current: Record<string, TrackData> = {};
      let result: T;
      const write = () => {
        try {
          if (expectedDatabaseName && expectedDatabaseName !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music before saving changes.");
          // Tag checks must see the saved tags, including a library that only has
          // the older categories document; an empty taxonomy would drop tags.
          const taxonomy = taxonomyFromCategoryDocuments(taxonomyRequest.result, legacyTaxonomyRequest.result) ?? createEmptyTaxonomy();
          const playlists = playlistRequest ? normalizeSmartPlaylistCriteriaList(playlistRequest.result) : [];
          if (playlistRequest && playlists.length !== playlistRequest.result.length) throw new Error("Your Smart Playlists couldn't be read. Please try again.");
          smartPlaylists?.prepare(playlists);
          const mutation = mutate(current, historyRequest.result?.value || [], taxonomy, redoRequest.result?.value || []);
          smartPlaylists?.update(playlists).forEach((playlist, index) => {
            if (playlist !== playlists[index]) tx.objectStore(STORES.SMART_PLAYLISTS).put(playlist);
          });
          result = mutation.result;
          const batchId = crypto.randomUUID();
          Object.entries(mutation.changes).forEach(([uri, data]) => {
            noteLocalFileChange(tx, uri, uri !== skipSyncUri);
            if (data) { tracks.put({ uri, ...data }); appendIntent(tx, uri === skipSyncUri ? null : makeEntityReplaceIntent(uri, "track", data, batchId, current[uri] ?? null)); }
            else { tracks.delete(uri); appendIntent(tx, makeEntityDeleteIntent(uri, "track", batchId, current[uri] ?? null)); }
          });
          metadata.put({ key: "bulkUndo", value: mutation.history.slice(-10) });
          const annotationValue = (data: TrackData | null | undefined, field: keyof TrackData) => data?.[field] ?? (field === "tagIds" ? [] : field === "rating" || field === "energy" ? 0 : null);
          const edited = Object.entries(mutation.changes).some(([uri, next]) =>
            (["rating", "energy", "bpm", "camelotKey", "tagIds"] as const).some(field => JSON.stringify(annotationValue(current[uri], field)) !== JSON.stringify(annotationValue(next, field))));
          metadata.put({ key: "bulkRedo", value: (mutation.redo ?? (edited ? [] : redoRequest.result?.value || [])).slice(-10) });
          metadata.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        } catch (error) { reject(error); tx.abort(); }
      };
      // Queue reads after the history request so the final callback sees all results.
      historyRequest.onsuccess = () => {
        // Index lookups bound linked-member reads; the requested tracks are
        // queued first so every group lookup starts from the current records.
        const loaded = new Set<string>();
        let pending = uris.length;
        const finish = () => { if (!pending) write(); };
        if (!pending) { write(); return; }
        uris.forEach((uri) => {
          const request = tracks.get(uri);
          request.onsuccess = () => {
            if (request.result) {
              const { uri: _, ...data } = request.result; current[uri] = data;
              if (data.recordingGroupId && !loaded.has(data.recordingGroupId)) {
                loaded.add(data.recordingGroupId); pending++;
                const members = tracks.index("by-recording-group").getAll(data.recordingGroupId);
                members.onsuccess = () => {
                  members.result.forEach(({ uri: memberUri, ...member }) => { current[memberUri] = member; });
                  pending--; finish();
                };
              }
            }
            pending--; finish();
          };
        });
      };
      tx.oncomplete = () => resolve(result!);
      tx.onerror = tx.onabort = () => reject(new Error("Tagify couldn't save those changes. Please try again."));
    });
  }

  /** Fill details already shown by Spotify; never create a song or change its annotations/dates. */
  async rememberRecordingDetails(uri: string, details: { name?: string; artists?: string }, account = getTagifyDatabaseName(), isCurrent = () => true) {
    return this.mutateBulkTracks([uri], (tracks, history) => {
      const changes: Record<string, TrackData> = {};
      const current = tracks[uri];
      if (current && isCurrent()) {
        const next = { ...current };
        for (const key of ["name", "artists"] as const) {
          if (!current[key]?.trim() && details[key]?.trim()) next[key] = details[key]!.trim();
        }
        if (next.name !== current.name || next.artists !== current.artists) changes[uri] = next;
      }
      return { changes, history, result: changes };
    }, undefined, account);
  }

  async rememberRecordingIdentities(identities: Record<string, RecordingIdentity>, account = getTagifyDatabaseName()) {
    return this.mutateBulkTracks(Object.keys(identities), (tracks, history) => {
      const changes: Record<string, TrackData> = {};
      Object.entries(identities).forEach(([uri, value]) => {
        const identity = normalizeRecordingIdentity(value);
        if (identity && tracks[uri] && !tracks[uri].recordingReuseDisabled && !tracks[uri].recordingIdentity) changes[uri] = { ...tracks[uri], recordingIdentity: identity };
      });
      return { changes, history, result: changes };
    }, undefined, account);
  }

  async linkRecordings(proposals: Record<string, { identity: RecordingIdentity; annotations: string; details?: Partial<TrackData> }>, sourceUri: string, replace: boolean, options?: { automatic?: boolean; confirmSimilar?: boolean; expectedDatabaseName?: string; isCurrent?: () => boolean; choices?: RecordingChoices }) {
    return this.mutateBulkTracks(Object.keys(proposals), (tracks, history, taxonomy) => {
      if (options?.isCurrent && !options.isCurrent()) throw new Error("Your library changed. Review these songs again.");
      const source = tracks[sourceUri];
      if (!source || !proposals[sourceUri]) throw new Error("Choose a saved release to reuse its tagging.");
      const identities = Object.values(proposals).map(proposal => proposal.identity);
      const confirmed = options?.confirmSimilar === true && !options.automatic;
      if (identities.length < 2 || !identities.every(identity => normalizeRecordingIdentity(identity) && identities.every(other => confirmed ? similarRecording(identity, other) : sameRecording(identity, other)))) throw new Error("These releases couldn't be confirmed as the same recording.");
      if (Object.keys(tracks).some(uri => !proposals[uri])) throw Object.assign(new Error("Linked releases have changed. Check the recording again before linking."), { code: "tagify-recording-changed" });
      Object.entries(proposals).forEach(([uri, proposal]) => {
        if (recordingAnnotations(tracks[uri]) !== proposal.annotations || tracks[uri]?.recordingReuseDisabled) throw Object.assign(new Error("Tagging changed since you checked. Check the recording again before linking."), { code: "tagify-recording-changed" });
      });
      const members = Object.values(tracks);
      if (!replace && !options?.choices && members.some(a => members.some(b => recordingConflict(a, b)))) throw new Error("These releases have different tagging. Choose which tagging to keep before linking.");
      const annotation = options?.choices || (replace ? source : {
        rating: members.find(track => track.rating > 0)?.rating || 0,
        energy: members.find(track => track.energy > 0)?.energy || 0,
        tagIds: [...new Set(members.flatMap(track => track.tagIds))],
      });
      if (!Number.isFinite(annotation.rating) || annotation.rating < 0 || annotation.rating > 5 || !Number.isFinite(annotation.energy) || annotation.energy < 0 || annotation.energy > 10) throw new Error("Choose a valid rating and energy before saving.");
      const validTags = buildValidTagIdSet(taxonomy);
      if (annotation.tagIds.some(id => !validTags.has(id))) throw new Error("Some tags have changed. Check the recording again before linking.");
      const groupId = crypto.randomUUID();
      const now = Date.now();
      const changes: Record<string, TrackData> = {};
      Object.entries(proposals).forEach(([uri, proposal]) => {
        const before = tracks[uri];
        const after: TrackData = { ...{ rating: 0, energy: 0, bpm: null, tagIds: [] }, ...proposal.details, ...before,
          rating: annotation.rating, energy: annotation.energy, tagIds: [...new Set(annotation.tagIds)], recordingIdentity: proposal.identity, recordingGroupId: groupId, recordingGroupConfirmed: confirmed || undefined };
        if (!before) { after.dateCreated = now; after.dateModified = now; }
        changes[uri] = after;
      });
      return { changes, history, result: changes };
    }, undefined, options?.expectedDatabaseName);
  }

  async unlinkRecording(uri: string, disabled = true, account = getTagifyDatabaseName()) {
    return this.mutateBulkTracks([uri], (tracks, history) => {
      const before = tracks[uri] || { rating: 0, energy: 0, bpm: null, tagIds: [] };
      const { recordingGroupId: _, recordingGroupConfirmed: _confirmed, ...data } = before;
      const changes = { [uri]: { ...data, recordingReuseDisabled: disabled } };
      return { changes, history, result: changes };
    }, undefined, account);
  }

  async applyBulkTagUpdates(updates: BatchTagUpdate[], expectedDatabaseName = getTagifyDatabaseName()) {
    return this.mutateBulkTracks([...new Set(updates.map((update) => update.trackUri))], (tracks, history) => {
      const automaticRuleIds = [...new Set(updates.flatMap(update => update.automaticRuleIds || []))];
      const directChanges = applyBatchTagUpdatesToData({ ...defaultTagData, tracks }, updates, Date.now()).finalTrackDataMap;
      // A rule's preview and music selection must also hold for linked releases.
      const changes = automaticRuleIds.length ? directChanges : expandRecordingEdits(tracks, directChanges);
      if (automaticRuleIds.length) Object.entries(changes).forEach(([uri, after]) => {
        if (after && tracks[uri]) changes[uri] = { ...after, dateModified: tracks[uri].dateModified };
      });
      const entry: BulkUndoEntry = { id: crypto.randomUUID(), createdAt: Date.now(), ...(automaticRuleIds.length ? { automaticRuleIds } : {}), changes: Object.fromEntries(
        Object.entries(changes).map(([uri, after]) => [uri, { before: tracks[uri] || null, after }]),
      ) };
      return { changes, history: Object.keys(changes).length ? [...history, entry] : history, result: changes };
    }, undefined, expectedDatabaseName);
  }

  async undoBulkTagUpdate(id: string) {
    const expectedDatabaseName = getTagifyDatabaseName();
    const checkAccount = () => { if (expectedDatabaseName !== getTagifyDatabaseName()) throw new Error("Your account changed. Reopen your music before undoing changes."); };
    const entry = await this.getLatestBulkUndo();
    if (!entry || entry.id !== id) throw new Error("The last bulk change has changed. Please review it and try again.");
    checkAccount();
    if (entry.automaticRuleIds?.length) {
      const { pauseRules } = await import("@/features/automatic-tags/store");
      checkAccount(); pauseRules(entry.automaticRuleIds);
    }
    return this.mutateBulkTracks(Object.keys(entry.changes), (tracks, history, taxonomy, redo) => {
      checkAccount();
      if (history.at(-1)?.id !== id) throw new Error("The last bulk change has changed. Please try again.");
      const changes: Record<string, TrackData | null> = {};
      let skippedFields = 0;
      const validTagIds = buildValidTagIdSet(taxonomy);
      Object.entries(entry.changes).forEach(([uri, { before, after }]) => {
        if (tracks[uri]?.recordingGroupId !== after?.recordingGroupId) { skippedFields++; return; }
        const restored = restoreBulkTrack(tracks[uri] || null, before, after, validTagIds);
        skippedFields += restored.skipped;
        if (restored.restored) changes[uri] = restored.track;
      });
      const expanded = entry.automaticRuleIds?.length ? changes : expandRecordingEdits(tracks, changes);
      const redoEntry: BulkUndoEntry = { id: crypto.randomUUID(), createdAt: Date.now(), automaticRuleIds: entry.automaticRuleIds, changes: Object.fromEntries(
        Object.entries(expanded).map(([uri, after]) => [uri, { before: after, after: tracks[uri] || null }]),
      ) };
      return { changes: expanded, history: history.slice(0, -1), redo: Object.keys(expanded).length ? [...redo, redoEntry] : redo, result: { changes: expanded, skippedFields } };
    }, undefined, expectedDatabaseName);
  }

  async redoBulkTagUpdate(id: string) {
    const account = getTagifyDatabaseName();
    const entry = (await this.getBulkEditHistory()).redo;
    if (!entry || entry.id !== id) throw new Error("The change available to redo has changed. Please try again.");
    return this.mutateBulkTracks(Object.keys(entry.changes), (tracks, history, taxonomy, redo) => {
      if (account !== getTagifyDatabaseName() || redo.at(-1)?.id !== id) throw new Error("The change available to redo has changed. Please try again.");
      const changes: Record<string, TrackData | null> = {};
      let skippedFields = 0;
      const validTags = buildValidTagIdSet(taxonomy);
      Object.entries(entry.changes).forEach(([uri, { before, after }]) => {
        if (tracks[uri]?.recordingGroupId !== before?.recordingGroupId) { skippedFields++; return; }
        const restored = restoreBulkTrack(tracks[uri] || null, after, before, validTags);
        skippedFields += restored.skipped;
        if (restored.restored) changes[uri] = restored.track;
      });
      const expanded = entry.automaticRuleIds?.length ? changes : expandRecordingEdits(tracks, changes);
      const undoEntry: BulkUndoEntry = { id: crypto.randomUUID(), createdAt: Date.now(), automaticRuleIds: entry.automaticRuleIds, changes: Object.fromEntries(
        Object.entries(expanded).map(([uri, after]) => [uri, { before: tracks[uri] || null, after }]),
      ) };
      return { changes: expanded, history: Object.keys(expanded).length ? [...history, undoEntry] : history, redo: redo.slice(0, -1), result: { changes: expanded, skippedFields } };
    }, undefined, account);
  }

  /**
   * With `previous`, only the fields that changed since `previous` are applied
   * to the saved record, so edits made elsewhere in the meantime are kept.
   */
  async saveTracks(tracks: Map<string, TrackData>, previous?: Record<string, TrackData>, options?: RebaseRecordOptions): Promise<boolean> {
    return this.saveTrackChanges(
      new Map<string, TrackData | null>(tracks), { previous, ...options }
    );
  }

  async saveTrackChanges(
    changes: Map<string, TrackData | null>,
    options?: { undoable?: boolean; previous?: Record<string, TrackData> } & RebaseRecordOptions,
  ): Promise<boolean> {
    if (!(await this.ensureReady())) return false;
    try {
      await this.mutateBulkTracks([...changes.keys()], (tracks, history) => {
        const requested = Object.fromEntries(changes);
        // Apply only this edit's delta so background matching and edits saved
        // in the meantime (including other tags) are preserved.
        if (options?.previous) Object.entries(requested).forEach(([uri, next]) => {
          // A backfill started before an import/deletion must not restore a
          // removed song after its metadata response arrives.
          if (options.keepConcurrentChanges && options.previous![uri] && !tracks[uri]) delete requested[uri];
          else if (next) requested[uri] = rebaseRecord(options.previous![uri], next, tracks[uri], options);
        });
        const entries = expandRecordingEdits(tracks, requested);
        const entry: BulkUndoEntry = { id: crypto.randomUUID(), createdAt: Date.now(), changes: Object.fromEntries(
          Object.entries(entries).map(([uri, after]) => [uri, { before: tracks[uri] || null, after }]),
        ) };
        return { changes: entries, history: options?.undoable && Object.keys(entries).length ? [...history, entry] : history, result: true };
      });
      return true;
    } catch (error) {
      console.error("Tagify: Track changes could not be saved", error);
      return false;
    }
  }

  /**
   * Changes saved tracks from their current saved records inside one
   * transaction. Writers that work from a cached or older copy must use this
   * so they never replace edits saved in the meantime. Each change receives
   * the saved record (or null) and returns the new record, null to remove
   * it, or undefined to leave it unchanged. Resolves with the saved results.
   * `undoable` adds the change to the bulk Undo history.
   */
  async patchTracks(
    changes: Record<string, (current: TrackData | null) => TrackData | null | undefined>,
    options?: { expectedDatabaseName?: string; undoable?: boolean; smartPlaylists?: SmartPlaylistTrackTransaction },
  ): Promise<Record<string, TrackData | null>> {
    const uris = Object.keys(changes);
    if (!uris.length) return {};
    return this.mutateBulkTracks(uris, (tracks, history) => {
      const requested: Record<string, TrackData | null> = {};
      for (const uri of uris) {
        const next = changes[uri](tracks[uri] ? { ...tracks[uri] } : null);
        if (next !== undefined) requested[uri] = next;
      }
      const expanded = expandRecordingEdits(tracks, requested);
      if (!options?.undoable || !Object.keys(expanded).length) return { changes: expanded, history, result: expanded };
      const entry: BulkUndoEntry = { id: crypto.randomUUID(), createdAt: Date.now(), changes: Object.fromEntries(
        Object.entries(expanded).map(([uri, after]) => [uri, { before: tracks[uri] || null, after }]),
      ) };
      return { changes: expanded, history: [...history, entry], result: expanded };
    }, undefined, options?.expectedDatabaseName, options?.smartPlaylists);
  }

  async restoreTrackEdit(entry: BulkUndoEntry, direction: "undo" | "redo", account: string, isCurrent: () => boolean) {
    return this.mutateBulkTracks(Object.keys(entry.changes), (tracks, history, taxonomy) => {
      if (!isCurrent()) throw new Error("Your song selection changed. Start a new edit to use Undo or Redo.");
      const changes: Record<string, TrackData | null> = {};
      const previous: Record<string, TrackData | null> = {};
      let skippedFields = 0;
      const validTags = buildValidTagIdSet(taxonomy);
      Object.entries(entry.changes).forEach(([uri, change]) => {
        const target = direction === "undo" ? change.before : change.after;
        const expected = direction === "undo" ? change.after : change.before;
        previous[uri] = tracks[uri] || null;
        if (tracks[uri]?.recordingGroupId !== expected?.recordingGroupId) { skippedFields++; return; }
        const restored = restoreBulkTrack(tracks[uri] || null, target, expected, validTags);
        skippedFields += restored.skipped;
        if (restored.restored) changes[uri] = restored.track;
      });
      // Entries include linked releases at edit time; newly linked music must not join an old undo.
      return { changes, history, result: { changes, previous, skippedFields } };
    }, undefined, account);
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

        const previous = playlistStore.get(uri);
        previous.onsuccess = () => {
          playlistStore.put({ uri, ...data });
          metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          appendIntent(transaction, options?.captureSync === false ? null : makeEntityReplaceIntent(uri, "playlist", data, undefined, previous.result ?? null));
        };

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to save playlist", error);
        resolve(false);
      }
    });
  }

  /** Add one reviewed set against current annotations, in the same transaction as sync. */
  async addEntityTags(uri: string, kind: "artist" | "playlist", tagIds: string[], details: Partial<ArtistData & PlaylistData> = {}, databaseName = getTagifyDatabaseName()): Promise<void> {
    if (!(await this.ensureReady())) throw new Error("Your library is still loading. Please try again.");
    if (this.db!.name !== databaseName) throw new Error("Your account changed. Reopen the music before adding tags.");
    const storeName = kind === "artist" ? STORES.ARTISTS : STORES.PLAYLISTS;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([storeName, STORES.CATEGORIES, STORES.METADATA, STORES.OUTBOX], "readwrite");
      const store = tx.objectStore(storeName);
      const taxonomy = tx.objectStore(STORES.CATEGORIES).get(CATEGORY_DOCUMENT_KEYS.TAXONOMY);
      const request = store.get(uri);
      request.onsuccess = () => {
        const valid = taxonomy.result?.data?.tagsById || {};
        if (tagIds.some(id => !valid[id])) { tx.abort(); return; }
        const now = Date.now();
        const previous = request.result || { ...details, rating: 0, energy: 0, tagIds: [], dateCreated: now };
        const nextIds = [...new Set([...previous.tagIds, ...tagIds])];
        if (nextIds.length === previous.tagIds.length) return;
        const next = { ...previous, tagIds: nextIds, dateModified: now };
        store.put({ ...next, uri });
        tx.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: now });
        appendIntent(tx, makeEntityReplaceIntent(uri, kind, next, undefined, request.result ?? null));
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error("Your tags couldn't be added. Review the selection and try again."));
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

        const previous = playlistStore.get(uri);
        previous.onsuccess = () => {
          playlistStore.delete(uri);
          metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          appendIntent(transaction, options?.captureSync === false ? null : makeEntityDeleteIntent(uri, "playlist", undefined, previous.result ?? null));
        };

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to delete playlist", error);
        resolve(false);
      }
    });
  }

  async savePlaylists(playlists: Map<string, PlaylistData>, previous?: Record<string, PlaylistData>, options?: RebaseRecordOptions): Promise<boolean> {
    return this.saveEntityRecords("playlist", playlists, previous, options);
  }

  /**
   * Saves playlist or artist records in one transaction. With `previous`,
   * each record is read and only the fields changed since `previous` are
   * applied, so edits saved in the meantime are kept.
   */
  private async saveEntityRecords<T extends PlaylistData | ArtistData>(
    kind: "playlist" | "artist",
    records: Map<string, T>,
    previous?: Record<string, T>,
    options?: RebaseRecordOptions,
  ): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    return new Promise((resolve) => {
      try {
        const storeName = kind === "artist" ? STORES.ARTISTS : STORES.PLAYLISTS;
        const transaction = this.db!.transaction([storeName, STORES.METADATA, STORES.OUTBOX], "readwrite");
        const store = transaction.objectStore(storeName);
        const batchId = crypto.randomUUID();
        const write = (uri: string, data: T, saved: T | undefined) => {
          store.put({ uri, ...data });
          appendIntent(transaction, makeEntityReplaceIntent(uri, kind, data, batchId, saved ?? null));
        };
        for (const [uri, data] of records) {
          const request = store.get(uri);
          request.onsuccess = () => {
            const { uri: _uri, ...current } = request.result ?? {};
            const saved = request.result ? current as T : undefined;
            write(uri, previous ? rebaseRecord(previous[uri], data, saved, options) ?? data : data, saved);
          };
        }
        transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = transaction.onabort = () => resolve(false);
      } catch (error) {
        console.error(`IndexedDB: Failed to save ${kind}s`, error);
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

        const previous = artistStore.get(uri);
        previous.onsuccess = () => {
          artistStore.put({ uri, ...data });
          metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          appendIntent(transaction, options?.captureSync === false ? null : makeEntityReplaceIntent(uri, "artist", data, undefined, previous.result ?? null));
        };

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
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

        const previous = artistStore.get(uri);
        previous.onsuccess = () => {
          artistStore.delete(uri);
          metadataStore.put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          appendIntent(transaction, options?.captureSync === false ? null : makeEntityDeleteIntent(uri, "artist", undefined, previous.result ?? null));
        };

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.onabort = () => resolve(false);
      } catch (error) {
        console.error("IndexedDB: Failed to delete artist", error);
        resolve(false);
      }
    });
  }

  async saveArtists(artists: Map<string, ArtistData>, previous?: Record<string, ArtistData>, options?: RebaseRecordOptions): Promise<boolean> {
    return this.saveEntityRecords("artist", artists, previous, options);
  }

  /**
   * Changes saved playlists, albums, or artists from their current saved
   * records inside one transaction, like patchTracks. Each change returns the
   * new record, null to remove it, or undefined to leave it unchanged.
   */
  async patchEntities<T extends PlaylistData | ArtistData>(
    kind: "playlist" | "artist",
    changes: Record<string, (current: T | null) => T | null | undefined>,
    options?: { expectedDatabaseName?: string },
  ): Promise<Record<string, T | null>> {
    if (!(await this.ensureReady())) throw new Error("Your library is still loading. Please try again.");
    if (options?.expectedDatabaseName && this.db!.name !== options.expectedDatabaseName) {
      throw new Error("Your account changed. Reopen Tagify before saving changes.");
    }
    const storeName = kind === "artist" ? STORES.ARTISTS : STORES.PLAYLISTS;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([storeName, STORES.METADATA, STORES.OUTBOX], "readwrite");
      const store = tx.objectStore(storeName);
      const batchId = crypto.randomUUID();
      const results: Record<string, T | null> = {};
      for (const [uri, change] of Object.entries(changes)) {
        const request = store.get(uri);
        request.onsuccess = () => {
          let next: T | null | undefined;
          try {
            const current = request.result ? { ...request.result } : null;
            if (current) delete current.uri;
            next = change(current as T | null);
          } catch (error) {
            console.error(`IndexedDB: Failed to change ${kind}`, error);
            tx.abort();
            return;
          }
          if (next === undefined || (next === null && !request.result)) return;
          // The saved record before this change lets sync send only what changed.
          const { uri: _savedUri, ...saved } = request.result ?? {};
          const before = request.result ? saved as T : null;
          if (next) {
            store.put({ ...next, uri });
            appendIntent(tx, makeEntityReplaceIntent(uri, kind, next, batchId, before));
          } else {
            store.delete(uri);
            appendIntent(tx, makeEntityDeleteIntent(uri, kind, batchId, before));
          }
          tx.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
          results[uri] = next;
        };
      }
      tx.oncomplete = () => resolve(results);
      tx.onerror = tx.onabort = () => reject(new Error("Tagify couldn't save those changes. Please try again."));
    });
  }

  /** Read the current rules and only the candidate songs; undefined requests a full reconciliation snapshot. */
  async getSmartPlaylistSyncState(uris?: string[], account = getTagifyDatabaseName()): Promise<{
    tracks: Record<string, TrackData>; playlists: SmartPlaylistCriteria[];
  }> {
    const check = () => {
      if (this.db?.name !== account || getTagifyDatabaseName() !== account) throw new Error("Your account changed. Reopen your Smart Playlists.");
    };
    if (!(await this.ensureReady())) throw new Error("Your saved songs couldn't be read. Please try again.");
    check();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORES.TRACKS, STORES.SMART_PLAYLISTS], "readonly");
      const playlists = tx.objectStore(STORES.SMART_PLAYLISTS).getAll();
      const store = tx.objectStore(STORES.TRACKS);
      const tracks: Record<string, TrackData> = {};
      const accept = (record: (TrackData & { uri: string }) | undefined) => {
        if (record) { const { uri, ...data } = record; tracks[uri] = data; }
      };
      if (uris) {
        for (const uri of new Set(uris)) {
          const request = store.get(uri);
          request.onsuccess = () => accept(request.result);
        }
      } else {
        const request = store.getAll();
        request.onsuccess = () => request.result.forEach(accept);
      }
      tx.oncomplete = () => {
        try {
          check();
          const normalized = normalizeSmartPlaylistCriteriaList(playlists.result);
          if (normalized.length !== playlists.result.length) throw new Error("Your Smart Playlists couldn't be read. Please try again.");
          resolve({ tracks, playlists: normalized });
        } catch (error) { reject(error); }
      };
      tx.onerror = tx.onabort = () => reject(new Error("Your saved songs couldn't be read. Please try again."));
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
    playlists: SmartPlaylistCriteria[] | ((current: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[]),
    assertCurrent?: () => void,
    preserveMembership = false,
  ): Promise<boolean> {
    const account = getTagifyDatabaseName();
    assertCurrent?.();
    if (!(await this.ensureReady())) return false;
    const check = () => {
      assertCurrent?.();
      if (this.db?.name !== account || getTagifyDatabaseName() !== account) throw new Error("Your account changed. Reopen your Smart Playlists.");
    };
    check();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.SMART_PLAYLISTS, STORES.METADATA], "readwrite");
      const store = transaction.objectStore(STORES.SMART_PLAYLISTS);
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          check();
          const current = normalizeSmartPlaylistCriteriaList(request.result);
          if (current.length !== request.result.length) throw new Error("Your Smart Playlists couldn't be read. Please try again.");
          const next = typeof playlists === "function" ? playlists(current) : playlists;
          if (next === current) return;
          const normalized = normalizeSmartPlaylistCriteriaList(next);
          if (normalized.length !== next.length || new Set(normalized.map(playlist => playlist.id)).size !== normalized.length) {
            transaction.abort(); return;
          }
          const saved = preserveMembership ? preserveSmartPlaylistMembership(normalized, current, { pendingChoices: "current" }) : normalized;
          store.clear();
          saved.forEach(playlist => store.put(playlist));
          transaction.objectStore(STORES.METADATA).put({ key: META_KEYS.LAST_MODIFIED, value: Date.now() });
        } catch (error) { reject(error); transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = transaction.onabort = () => resolve(false);
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

  /** Throws when the count can't be read; a failure is never reported as zero. */
  async getTrackCount(): Promise<number> {
    return this.countRecords(STORES.TRACKS);
  }

  /** Throws when the count can't be read; a failure is never reported as zero. */
  async getPlaylistCount(): Promise<number> {
    return this.countRecords(STORES.PLAYLISTS);
  }

  /** Throws when the count can't be read; a failure is never reported as zero. */
  async getArtistCount(): Promise<number> {
    return this.countRecords(STORES.ARTISTS);
  }

  private async countRecords(storeName: string): Promise<number> {
    if (!(await this.ensureReady())) throw new Error(UNREADABLE_LIBRARY_MESSAGE);
    return new Promise((resolve, reject) => {
      const request = this.db!.transaction(storeName, "readonly").objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(UNREADABLE_LIBRARY_MESSAGE));
    });
  }

  async clearAll(): Promise<boolean> {
    if (!(await this.ensureReady())) return false;

    if (makeSnapshotIntent("reset")) {
      console.error("Tagify: A linked cloud library must be reset through the staged online reset flow");
      return false;
    }

    let transaction: IDBTransaction | null = null;
    try {
      transaction = this.db!.transaction(
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
      const committed = transactionCommitted(transaction, "Clearing the library");

      transaction.objectStore(STORES.TRACKS).clear();
      transaction.objectStore(STORES.PLAYLISTS).clear();
      transaction.objectStore(STORES.ARTISTS).clear();
      transaction.objectStore(STORES.SMART_PLAYLISTS).clear();
      transaction.objectStore(STORES.CATEGORIES).clear();
      transaction.objectStore(STORES.METADATA).clear();

      return await committed;
    } catch (error) {
      console.error("IndexedDB: Failed to clear all", error);
      abortQuietly(transaction);
      return false;
    }
  }

  async getPrivateNote(uri: string, databaseName = getTagifyDatabaseName()): Promise<LocalPrivateNote | undefined> {
    if (!(await this.ensureReady())) throw new Error("Your notes are still loading. Please try again.");
    if (this.db!.name !== databaseName) throw new Error("Your connected account changed. Reopen this note before saving.");
    return new Promise((resolve, reject) => {
      const request = this.db!.transaction(SYNC_STORES.PRIVATE_NOTES).objectStore(SYNC_STORES.PRIVATE_NOTES).get(uri);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getPrivateNotesForUris(uris: string[], databaseName = getTagifyDatabaseName()): Promise<LocalPrivateNote[]> {
    const keys = [...new Set(uris)].filter(isPrivateNoteUri);
    if (!keys.length) return [];
    if (!(await this.ensureReady())) throw new Error("Your notes are still loading. Please try again.");
    if (this.db!.name !== databaseName) throw new Error("Your connected account changed. Reopen your music to see its notes.");
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(SYNC_STORES.PRIVATE_NOTES);
      const store = transaction.objectStore(SYNC_STORES.PRIVATE_NOTES);
      const notes: LocalPrivateNote[] = [];
      keys.forEach(uri => {
        const request = store.get(uri);
        request.onsuccess = () => { if (request.result) notes.push(request.result); };
      });
      transaction.oncomplete = () => resolve(notes);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("Your notes couldn't be loaded. Please try again."));
    });
  }

  async getPrivateNotes(databaseName = getTagifyDatabaseName()): Promise<LocalPrivateNote[]> {
    if (!(await this.ensureReady())) throw new Error("Your notes are still loading. Please try again.");
    if (this.db!.name !== databaseName) throw new Error("Your connected account changed. Reopen this note before saving.");
    return new Promise((resolve, reject) => {
      const request = this.db!.transaction(SYNC_STORES.PRIVATE_NOTES).objectStore(SYNC_STORES.PRIVATE_NOTES).getAll();
      request.onsuccess = () => resolve(request.result.filter(note => isPrivateNoteUri(note.uri)));
      request.onerror = () => reject(request.error);
    });
  }

  async mutatePrivateNotes(uris: string[], mutate: (notes: Record<string, LocalPrivateNote>) => Record<string, LocalPrivateNote>, databaseName = getTagifyDatabaseName()) {
    if (!(await this.ensureReady())) throw new Error("Your notes are still loading. Please try again.");
    if (this.db!.name !== databaseName) throw new Error("Your connected account changed. Reopen this note before saving.");
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(SYNC_STORES.PRIVATE_NOTES, "readwrite");
      const store = tx.objectStore(SYNC_STORES.PRIVATE_NOTES);
      const notes: Record<string, LocalPrivateNote> = {};
      let remaining = uris.length;
      const write = () => { try { Object.values(mutate(notes)).forEach(note => store.put(note)); } catch (error) { reject(error); tx.abort(); } };
      if (!remaining) write();
      uris.forEach(uri => {
        const request = store.get(uri);
        request.onsuccess = () => { if (request.result) notes[uri] = request.result; if (!--remaining) write(); };
      });
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error("Your note couldn't be saved. Please try again."));
    });
  }

  async privateNoteCursor(next?: number, databaseName = getTagifyDatabaseName()): Promise<number> {
    if (!(await this.ensureReady())) throw new Error("Your notes are still loading. Please try again.");
    if (this.db!.name !== databaseName) throw new Error("Your connected account changed. Reopen this note before saving.");
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(SYNC_STORES.PRIVATE_NOTES, next === undefined ? "readonly" : "readwrite");
      const store = tx.objectStore(SYNC_STORES.PRIVATE_NOTES);
      let value = next || 0;
      if (next === undefined) { const request = store.get("@cursor"); request.onsuccess = () => { value = request.result?.cursor || 0; }; }
      else store.put({ uri: "@cursor", cursor: next });
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(new Error("Note backup progress couldn't be saved."));
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
