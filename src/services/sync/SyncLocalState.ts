import type { SyncEntityRefV1 } from "@tagify/sync-contracts";
import type { ArtistData, PlaylistData, TagTaxonomy, TrackData } from "@/types/tagData";
import { normalizeCamelotKey } from "@/utils/camelotKey";

export const TAGIFY_DATABASE_VERSION = 10;
export const SYNC_STORES = {
  OUTBOX: "sync-outbox",
  STATE: "sync-state",
  CONFLICTS: "sync-conflicts",
  TOMBSTONES: "sync-tombstones",
  APP_STATE: "sync-app-state",
  RECOVERY_CHECKPOINT: "sync-recovery-checkpoint",
} as const;
export const SYNC_OUTBOX_CHANGED_EVENT = "tagify:syncOutboxChanged";
/** Local-file tracks have no outbox intent; this asks sync to back them up. */
export const LOCAL_FILES_CHANGED_EVENT = "tagify:localFilesChanged";

const ACCOUNT_KEY = "tagify:sync:account-id";
const CONFIG_KEY = "tagify:sync:configuration";
const DISCONNECTED_PROVENANCE_KEY = "tagify:sync:disconnected-provenance";
const notifyingTransactions = new WeakSet<IDBTransaction>();
const localPersistenceFlushers = new Set<() => Promise<void>>();

export function setLocalPersistencePaused(paused: boolean): void {
  window.__tagifyLocalPersistencePaused = paused;
  window.dispatchEvent(new CustomEvent("tagify:localPersistence", { detail: { paused } }));
}

export function isLocalPersistencePaused(): boolean {
  return window.__tagifyLocalPersistencePaused === true;
}

export function registerLocalPersistenceFlusher(flusher: () => Promise<void>): () => void {
  localPersistenceFlushers.add(flusher);
  return () => localPersistenceFlushers.delete(flusher);
}

export async function flushLocalPersistence(): Promise<void> {
  await Promise.all([...localPersistenceFlushers].map((flusher) => flusher()));
}

export type SyncableEntityData = TrackData | PlaylistData | ArtistData;

// Community accepts a narrower set of values than a device library can hold
// (old imports, manual entries, Community installs). Values are converted at
// the sync boundary so a single unsupported value can never stop every later
// backup. The device copy keeps the original value.
export const SYNC_NAME_MAX_LENGTH = 80;
const SYNC_SAFE_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function normalizeSyncRating(rating: number | null | undefined): number | null {
  if (typeof rating !== "number" || !Number.isFinite(rating) || rating <= 0) return null;
  const halfStep = Math.min(5, Math.round(rating * 2) / 2);
  return halfStep > 0 ? halfStep : null;
}

export function normalizeSyncEnergy(energy: number | null | undefined): number | null {
  if (typeof energy !== "number" || !Number.isFinite(energy) || energy <= 0) return null;
  const level = Math.min(10, Math.round(energy));
  return level > 0 ? level : null;
}

export function normalizeSyncBpm(bpm: number | null | undefined): number | null {
  if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm < 20 || bpm > 400) return null;
  return Math.round(bpm * 100) / 100;
}

export function normalizeSyncKey(key: string | null | undefined): string | null {
  return normalizeCamelotKey(key);
}

export function syncTimestamp(milliseconds: number | null | undefined): string | undefined {
  return typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toISOString()
    : undefined;
}

export function syncTimestamps(data: { dateCreated?: number; dateModified?: number }): { createdAt?: string; modifiedAt?: string } {
  const createdAt = syncTimestamp(data.dateCreated);
  const modifiedAt = syncTimestamp(data.dateModified);
  return { ...(createdAt ? { createdAt } : {}), ...(modifiedAt ? { modifiedAt } : {}) };
}

/** Milliseconds from a Community timestamp, or undefined when absent or invalid. */
export function deviceTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

export function isSyncSafeId(id: unknown): id is string {
  return typeof id === "string" && SYNC_SAFE_ID.test(id);
}

/** A close, Community-safe spelling of a name: no angle brackets, at most 80 characters. */
export function normalizeSyncName(name: unknown, fallback: string): string {
  const cleaned = (typeof name === "string" ? name : "")
    .replace(LONE_SURROGATE, "\uFFFD")
    .replace(/</g, "\u2039")
    .replace(/>/g, "\u203A")
    .trim();
  let result = "";
  for (const character of cleaned) {
    if (result.length + character.length > SYNC_NAME_MAX_LENGTH) break;
    result += character;
  }
  return result.trim() || fallback;
}

export interface ReplicaManifest {
  key: "replica-manifest";
  accountId: string;
  libraryId: string;
  storageSchemaVersion: number;
  protocolVersion: number;
  appliedCursor: number;
  snapshotChecksum: string | null;
  appStateAppliedAt: string | null;
  initializedAt: string;
  updatedAt: string;
}

export type LocalReplicaClassification = "fresh-default" | "meaningful-unlinked" | "initialized-replica";

export interface EntityReplaceIntent {
  id: string;
  batchId: string;
  createdAt: number;
  type: "entity.replace";
  entity: SyncEntityRefV1;
  desired: {
    rating: number | null; energy: number | null; bpm: number | null; key: string | null; tagIds: string[];
    /** Tagify's own first-saved and last-changed times (ISO), so a restore keeps Last Updated order. */
    createdAt?: string; modifiedAt?: string;
  };
}

export interface EntityDeleteIntent {
  id: string;
  batchId: string;
  createdAt: number;
  type: "entity.delete";
  entity: SyncEntityRefV1;
}

export interface TaxonomyReplaceIntent {
  id: string;
  batchId: string;
  createdAt: number;
  type: "taxonomy.replace";
  taxonomy: TagTaxonomy;
  /**
   * The device taxonomy before its first unsent edit. Only differences from
   * this base are sent, so a queued edit never reverts or deletes taxonomy
   * changes made on another device in the meantime. Intents queued by older
   * versions have no base and replace the whole taxonomy.
   */
  base?: TagTaxonomy;
}

export interface SnapshotReplaceIntent {
  id: string;
  batchId: string;
  createdAt: number;
  type: "library.snapshot";
  reason: "import" | "migration" | "reset";
}

export type LocalSyncIntent = EntityReplaceIntent | EntityDeleteIntent | TaxonomyReplaceIntent | SnapshotReplaceIntent;

export interface DesktopSyncConfiguration {
  accountId: string;
  libraryId: string;
  deviceId: string;
  apiBaseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  profile?: {
    id?: string | null;
    handle: string | null;
    displayName: string | null;
  };
}

export interface DisconnectedSyncProvenance {
  accountId: string;
  libraryId: string;
  disconnectedAt: string;
  profile?: DesktopSyncConfiguration["profile"];
}

export function getActiveSyncAccountId(): string | null {
  try { return localStorage.getItem(ACCOUNT_KEY); } catch { return null; }
}

export function getTagifyDatabaseName(): string {
  const accountId = getActiveSyncAccountId();
  return accountId ? `tagify-db:${accountId}` : "tagify-db";
}

export function isActiveSyncDatabase(database: Pick<IDBDatabase, "name"> | null): boolean {
  return database?.name === getTagifyDatabaseName();
}

export function getDesktopSyncConfiguration(): DesktopSyncConfiguration | null {
  try {
    const value = localStorage.getItem(CONFIG_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as DesktopSyncConfiguration;
    return parsed.accountId && parsed.deviceId && parsed.apiBaseUrl ? parsed : null;
  } catch { return null; }
}

export function setDesktopSyncConfiguration(configuration: DesktopSyncConfiguration | null): void {
  if (configuration) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(configuration));
    localStorage.setItem(ACCOUNT_KEY, configuration.accountId);
  } else {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
  }
}

export function getDisconnectedSyncProvenance(): DisconnectedSyncProvenance | null {
  try {
    const value = localStorage.getItem(DISCONNECTED_PROVENANCE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as DisconnectedSyncProvenance;
    return parsed.accountId && parsed.libraryId && parsed.disconnectedAt ? parsed : null;
  } catch {
    return null;
  }
}

export function setDisconnectedSyncProvenance(
  provenance: DisconnectedSyncProvenance | null,
): void {
  if (provenance) {
    localStorage.setItem(DISCONNECTED_PROVENANCE_KEY, JSON.stringify(provenance));
  } else {
    localStorage.removeItem(DISCONNECTED_PROVENANCE_KEY);
  }
}

export function isSyncCaptureEnabled(): boolean {
  return !isLocalPersistencePaused() && Boolean(getDesktopSyncConfiguration());
}

export function entityFromUri(uri: string, storageKind: "track" | "playlist" | "artist"): SyncEntityRefV1 | null {
  const match = uri.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{10,64})$/);
  if (!match) return null;
  const kind = match[1] as SyncEntityRefV1["kind"];
  if (storageKind === "track" && kind !== "track") return null;
  if (storageKind === "playlist" && kind !== "playlist" && kind !== "album") return null;
  if (storageKind === "artist" && kind !== "artist") return null;
  return { provider: "spotify", kind, providerId: match[2] };
}

export function createEntityReplaceIntent(uri: string, storageKind: "track" | "playlist" | "artist", data: SyncableEntityData, batchId = crypto.randomUUID()): EntityReplaceIntent | null {
  const entity = entityFromUri(uri, storageKind);
  if (!entity) return null;
  const track = storageKind === "track" ? data as TrackData : null;
  return {
    id: crypto.randomUUID(), batchId, createdAt: Date.now(), type: "entity.replace", entity,
    desired: {
      rating: normalizeSyncRating(data.rating),
      energy: normalizeSyncEnergy(data.energy),
      bpm: normalizeSyncBpm(track?.bpm),
      key: normalizeSyncKey(track?.camelotKey),
      tagIds: [...new Set(data.tagIds)].filter(isSyncSafeId).sort(),
      ...syncTimestamps(data),
    },
  };
}

export function makeEntityReplaceIntent(uri: string, storageKind: "track" | "playlist" | "artist", data: SyncableEntityData, batchId = crypto.randomUUID()): EntityReplaceIntent | null {
  return isSyncCaptureEnabled()
    ? createEntityReplaceIntent(uri, storageKind, data, batchId)
    : null;
}

export function createEntityDeleteIntent(uri: string, storageKind: "track" | "playlist" | "artist", batchId = crypto.randomUUID()): EntityDeleteIntent | null {
  const entity = entityFromUri(uri, storageKind);
  return entity ? { id: crypto.randomUUID(), batchId, createdAt: Date.now(), type: "entity.delete", entity } : null;
}

export function makeEntityDeleteIntent(uri: string, storageKind: "track" | "playlist" | "artist", batchId = crypto.randomUUID()): EntityDeleteIntent | null {
  return isSyncCaptureEnabled()
    ? createEntityDeleteIntent(uri, storageKind, batchId)
    : null;
}

declare global {
  interface Window {
    __tagifyLocalPersistencePaused?: boolean;
  }
}

export function makeTaxonomyIntent(taxonomy: TagTaxonomy, batchId = crypto.randomUUID(), base?: TagTaxonomy): TaxonomyReplaceIntent | null {
  return isSyncCaptureEnabled() ? { id: crypto.randomUUID(), batchId, createdAt: Date.now(), type: "taxonomy.replace", taxonomy, ...(base ? { base } : {}) } : null;
}

export function makeSnapshotIntent(reason: SnapshotReplaceIntent["reason"]): SnapshotReplaceIntent | null {
  return isSyncCaptureEnabled() ? { id: crypto.randomUUID(), batchId: crypto.randomUUID(), createdAt: Date.now(), type: "library.snapshot", reason } : null;
}

const localFileTransactions = new WeakSet<IDBTransaction>();

/** Announces a saved local-file track once its transaction commits. */
export function noteLocalFileChange(transaction: IDBTransaction, uri: string, captureSync = true): void {
  if (!captureSync || !uri.startsWith("spotify:local:") || !isSyncCaptureEnabled() || localFileTransactions.has(transaction)) return;
  localFileTransactions.add(transaction);
  transaction.addEventListener("complete", () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_FILES_CHANGED_EVENT));
  }, { once: true });
}

export function appendIntent(transaction: IDBTransaction, intent: LocalSyncIntent | null): void {
  if (!intent || !transaction.objectStoreNames.contains(SYNC_STORES.OUTBOX)) return;
  transaction.objectStore(SYNC_STORES.OUTBOX).put(intent);
  if (notifyingTransactions.has(transaction)) return;
  notifyingTransactions.add(transaction);
  transaction.addEventListener("complete", () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_OUTBOX_CHANGED_EVENT));
  }, { once: true });
}

export function ensureSyncStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(SYNC_STORES.OUTBOX)) {
    const outbox = db.createObjectStore(SYNC_STORES.OUTBOX, { keyPath: "id" });
    outbox.createIndex("by-created-at", "createdAt", { unique: false });
    outbox.createIndex("by-entity", ["entity.provider", "entity.kind", "entity.providerId"], { unique: false });
  }
  if (!db.objectStoreNames.contains(SYNC_STORES.STATE)) db.createObjectStore(SYNC_STORES.STATE, { keyPath: "key" });
  if (!db.objectStoreNames.contains(SYNC_STORES.CONFLICTS)) db.createObjectStore(SYNC_STORES.CONFLICTS, { keyPath: "id" });
  if (!db.objectStoreNames.contains(SYNC_STORES.TOMBSTONES)) db.createObjectStore(SYNC_STORES.TOMBSTONES, { keyPath: "key" });
  if (!db.objectStoreNames.contains(SYNC_STORES.APP_STATE)) db.createObjectStore(SYNC_STORES.APP_STATE, { keyPath: "domain" });
  if (!db.objectStoreNames.contains(SYNC_STORES.RECOVERY_CHECKPOINT)) db.createObjectStore(SYNC_STORES.RECOVERY_CHECKPOINT, { keyPath: "key" });
}

export function classifyLocalReplica(
  data: { taxonomy: TagTaxonomy; tracks: Record<string, unknown>; playlists: Record<string, unknown>; artists: Record<string, unknown> },
  defaultTaxonomy: TagTaxonomy,
  manifest: ReplicaManifest | null,
): LocalReplicaClassification {
  if (manifest) return "initialized-replica";
  const hasAnnotations = Object.keys(data.tracks).length > 0 || Object.keys(data.playlists).length > 0 || Object.keys(data.artists).length > 0;
  const taxonomyHasNodes = data.taxonomy.categoryOrder.length > 0 ||
    Object.keys(data.taxonomy.categoriesById).length > 0 ||
    Object.keys(data.taxonomy.subcategoriesById).length > 0 ||
    Object.keys(data.taxonomy.tagsById).length > 0;
  const taxonomyIsFresh = !taxonomyHasNodes || stableJson(data.taxonomy) === stableJson(defaultTaxonomy);
  return !hasAnnotations && taxonomyIsFresh ? "fresh-default" : "meaningful-unlinked";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
