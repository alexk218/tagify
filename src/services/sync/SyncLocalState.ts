import type { SyncEntityRefV1 } from "@tagify/sync-contracts";
import type { ArtistData, PlaylistData, TagTaxonomy, TrackData } from "@/types/tagData";
import { normalizeCamelotKey } from "@/utils/camelotKey";

export const TAGIFY_DATABASE_VERSION = 12;
export const SYNC_STORES = {
  OUTBOX: "sync-outbox",
  STATE: "sync-state",
  CONFLICTS: "sync-conflicts",
  TOMBSTONES: "sync-tombstones",
  APP_STATE: "sync-app-state",
  RECOVERY_CHECKPOINT: "sync-recovery-checkpoint",
  PRIVATE_NOTES: "private-notes",
} as const;
export const STATS_BASELINE_CHANGED_EVENT = "tagify:statsBaselineChanged";
export const SYNC_OUTBOX_CHANGED_EVENT = "tagify:syncOutboxChanged";
/** Local-file tracks have no outbox intent; this asks sync to back them up. */
export const LOCAL_FILES_CHANGED_EVENT = "tagify:localFilesChanged";

const ACCOUNT_KEY = "tagify:sync:account-id";
const CONFIG_KEY = "tagify:sync:configuration";
const DISCONNECTED_PROVENANCE_KEY = "tagify:sync:disconnected-provenance";
const notifyingTransactions = new WeakSet<IDBTransaction>();

// The Tagify page and the background extension are separate bundles, each
// with its own copy of this module. Sync runs in the extension, so the
// registry of unsaved-edit flushers must be shared through the window.
function localPersistenceFlushers(): Set<() => Promise<void>> {
  return (window.__tagifyLocalPersistenceFlushers ??= new Set());
}

export function setLocalPersistencePaused(paused: boolean): void {
  window.__tagifyLocalPersistencePaused = paused;
  window.dispatchEvent(new CustomEvent("tagify:localPersistence", { detail: { paused } }));
}

export function isLocalPersistencePaused(): boolean {
  return window.__tagifyLocalPersistencePaused === true;
}

export function registerLocalPersistenceFlusher(flusher: () => Promise<void>): () => void {
  localPersistenceFlushers().add(flusher);
  return () => { localPersistenceFlushers().delete(flusher); };
}

export async function flushLocalPersistence(): Promise<void> {
  await Promise.all([...localPersistenceFlushers()].map((flusher) => flusher()));
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

export type SyncAnnotationField = "rating" | "energy" | "bpm" | "key";
export const SYNC_ANNOTATION_FIELDS: readonly SyncAnnotationField[] = ["rating", "energy", "bpm", "key"];

/** An item's annotation in the form Community stores. */
export interface SyncAnnotationValues {
  rating: number | null; energy: number | null; bpm: number | null; key: string | null; tagIds: string[];
}

export interface EntityReplaceIntent {
  id: string;
  batchId: string;
  createdAt: number;
  type: "entity.replace";
  entity: SyncEntityRefV1;
  desired: SyncAnnotationValues & {
    /** Tagify's own first-saved and last-changed times (ISO), so a restore keeps Last Updated order. */
    createdAt?: string; modifiedAt?: string;
  };
  /**
   * The annotation just before this edit. Only fields and tags that differ
   * from it count as this device's change, so a queued edit never reverts
   * what another device changed meanwhile. Intents queued by older versions
   * have no base and send the whole annotation.
   */
  base?: SyncAnnotationValues;
}

export interface EntityDeleteIntent {
  id: string;
  batchId: string;
  createdAt: number;
  type: "entity.delete";
  entity: SyncEntityRefV1;
  /** The annotation before it was removed; see EntityReplaceIntent.base. */
  base?: SyncAnnotationValues;
}

/** The fields and tags this device changed, or "all" when an older intent has no base. */
export type EntityEdits = { fields: SyncAnnotationField[]; tagIds: string[] } | "all";

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

/**
 * A Community session is refreshed this long before it expires (by this
 * device's clock), so neither a request nor the live connection ever
 * carries an expired one, even when the clock is a few minutes off.
 */
export const SESSION_REFRESH_AHEAD_MS = 5 * 60_000;

/** Whether a session is close enough to expiring that it should be refreshed before use. */
export function sessionNeedsRefresh(configuration: Pick<DesktopSyncConfiguration, "expiresAt">, now = Date.now()): boolean {
  return !(configuration.expiresAt * 1_000 - now > SESSION_REFRESH_AHEAD_MS);
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

/** Whether this device syncs now, chose to disconnect earlier, or has never connected. */
export function getDesktopSyncConnectionState(): "connected" | "disconnected" | "not_connected" {
  if (getDesktopSyncConfiguration()) return "connected";
  return getDisconnectedSyncProvenance() ? "disconnected" : "not_connected";
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

export const EMPTY_SYNC_ANNOTATION: Readonly<SyncAnnotationValues> = Object.freeze({ rating: null, energy: null, bpm: null, key: null, tagIds: [] });

/** The Community form of a saved record; a missing record has no annotation. */
export function syncAnnotationValues(data: SyncableEntityData | null | undefined, storageKind: "track" | "playlist" | "artist"): SyncAnnotationValues {
  if (!data) return { ...EMPTY_SYNC_ANNOTATION, tagIds: [] };
  const track = storageKind === "track" ? data as TrackData : null;
  return {
    rating: normalizeSyncRating(data.rating),
    energy: normalizeSyncEnergy(data.energy),
    bpm: normalizeSyncBpm(track?.bpm),
    key: normalizeSyncKey(track?.camelotKey),
    tagIds: [...new Set(data.tagIds ?? [])].filter(isSyncSafeId).sort(),
  };
}

/**
 * Shows a record from the cloud copy without losing what only the device
 * holds. Community stores normalized values, so wherever the device's own
 * value normalizes to the cloud value the device keeps its original (exact
 * rating, BPM, key spelling, tags Community cannot store). The device's dates
 * stay by default. Reviewed reconciliation can adopt the saved canonical
 * dates so stats and Last Updated agree across replicas.
 */
export function preserveDeviceAnnotation<T extends SyncableEntityData>(incoming: T, device: T, storageKind: "track" | "playlist" | "artist", dates: "device" | "canonical" = "device"): T {
  const next = { ...incoming };
  if (device.dateCreated !== undefined && (dates === "device" || incoming.dateCreated === undefined)) next.dateCreated = device.dateCreated;
  if (device.dateModified !== undefined && (dates === "device" || incoming.dateModified === undefined)) next.dateModified = device.dateModified;
  if (normalizeSyncRating(device.rating) === normalizeSyncRating(next.rating)) next.rating = device.rating;
  if (normalizeSyncEnergy(device.energy) === normalizeSyncEnergy(next.energy)) next.energy = device.energy;
  if (storageKind === "track") {
    const deviceTrack = device as TrackData;
    const nextTrack = next as TrackData;
    if (normalizeSyncBpm(deviceTrack.bpm) === normalizeSyncBpm(nextTrack.bpm)) nextTrack.bpm = deviceTrack.bpm;
    if (normalizeSyncKey(deviceTrack.camelotKey) === normalizeSyncKey(nextTrack.camelotKey)) nextTrack.camelotKey = deviceTrack.camelotKey;
  }
  const deviceTags = device.tagIds ?? [];
  const cloudTags = new Set(next.tagIds ?? []);
  const deviceSynced = new Set(deviceTags.filter(isSyncSafeId));
  if (deviceSynced.size === cloudTags.size && [...deviceSynced].every((tagId) => cloudTags.has(tagId))) {
    next.tagIds = [...deviceTags];
  } else {
    next.tagIds = [...cloudTags, ...new Set(deviceTags.filter((tagId) => !isSyncSafeId(tagId)))];
  }
  return next;
}

/**
 * Pass `previous` (the saved record before this write, or null when there was
 * none) so only this edit's changes are sent. Leaving it out sends the whole
 * annotation, as older versions did.
 */
export function createEntityReplaceIntent(uri: string, storageKind: "track" | "playlist" | "artist", data: SyncableEntityData, batchId: string = crypto.randomUUID(), previous?: SyncableEntityData | null): EntityReplaceIntent | null {
  const entity = entityFromUri(uri, storageKind);
  if (!entity) return null;
  return {
    id: crypto.randomUUID(), batchId, createdAt: Date.now(), type: "entity.replace", entity,
    desired: { ...syncAnnotationValues(data, storageKind), ...syncTimestamps(data) },
    ...(previous === undefined ? {} : { base: syncAnnotationValues(previous, storageKind) }),
  };
}

export function makeEntityReplaceIntent(uri: string, storageKind: "track" | "playlist" | "artist", data: SyncableEntityData, batchId: string = crypto.randomUUID(), previous?: SyncableEntityData | null): EntityReplaceIntent | null {
  return isSyncCaptureEnabled()
    ? createEntityReplaceIntent(uri, storageKind, data, batchId, previous)
    : null;
}

export function createEntityDeleteIntent(uri: string, storageKind: "track" | "playlist" | "artist", batchId: string = crypto.randomUUID(), previous?: SyncableEntityData | null): EntityDeleteIntent | null {
  const entity = entityFromUri(uri, storageKind);
  return entity ? {
    id: crypto.randomUUID(), batchId, createdAt: Date.now(), type: "entity.delete", entity,
    ...(previous === undefined ? {} : { base: syncAnnotationValues(previous, storageKind) }),
  } : null;
}

export function makeEntityDeleteIntent(uri: string, storageKind: "track" | "playlist" | "artist", batchId: string = crypto.randomUUID(), previous?: SyncableEntityData | null): EntityDeleteIntent | null {
  return isSyncCaptureEnabled()
    ? createEntityDeleteIntent(uri, storageKind, batchId, previous)
    : null;
}

/**
 * What this device changed on one item across its queued intents (oldest
 * first). Each intent contributes the difference between its base and its
 * result; one intent without a base makes the whole annotation this device's.
 */
export function entityEdits(intents: ReadonlyArray<EntityReplaceIntent | EntityDeleteIntent>): EntityEdits {
  const fields = new Set<SyncAnnotationField>();
  const tagIds = new Set<string>();
  for (const intent of intents) {
    if (!intent.base) return "all";
    const after: SyncAnnotationValues = intent.type === "entity.replace" ? intent.desired : EMPTY_SYNC_ANNOTATION;
    for (const field of SYNC_ANNOTATION_FIELDS) if (intent.base[field] !== after[field]) fields.add(field);
    const before = new Set(intent.base.tagIds);
    const next = new Set(after.tagIds);
    for (const tagId of [...before, ...next]) if (before.has(tagId) !== next.has(tagId)) tagIds.add(tagId);
  }
  return { fields: [...fields], tagIds: [...tagIds].sort() };
}

export function editsInclude(edits: EntityEdits, change: { field?: SyncAnnotationField; tagId?: string }): boolean {
  if (edits === "all") return true;
  if (change.field) return edits.fields.includes(change.field);
  return change.tagId !== undefined && edits.tagIds.includes(change.tagId);
}

export function hasEntityEdits(edits: EntityEdits): boolean {
  return edits === "all" || edits.fields.length > 0 || edits.tagIds.length > 0;
}

declare global {
  interface Window {
    __tagifyLocalPersistencePaused?: boolean;
    __tagifyLocalPersistenceFlushers?: Set<() => Promise<void>>;
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

/** Per outbox transaction: intents waiting for the latest queued time, or the last time given. */
const queueTimes = new WeakMap<IDBTransaction, LocalSyncIntent[] | number>();

/**
 * Queues an intent. The outbox is read in `createdAt` order and the latest
 * intent for an item decides what is sent, so two intents must never share a
 * time: one made in the same millisecond as an earlier one (deleting a folder
 * clears a song, then the song is tagged again) would otherwise be read back in
 * either order. Each intent is therefore queued after everything already in
 * the outbox, whichever bundle wrote it. A read-write transaction holds the
 * outbox to itself, so it reads the latest time once.
 */
export function appendIntent(transaction: IDBTransaction, intent: LocalSyncIntent | null): void {
  if (!intent || !transaction.objectStoreNames.contains(SYNC_STORES.OUTBOX)) return;
  const outbox = transaction.objectStore(SYNC_STORES.OUTBOX);
  const queueAfter = (items: LocalSyncIntent[], after: number) => {
    let last = after;
    for (const item of items) {
      if (!(item.createdAt > last)) item.createdAt = last + 1;
      last = item.createdAt;
      outbox.put(item);
    }
    queueTimes.set(transaction, last);
  };
  const state = queueTimes.get(transaction);
  if (Array.isArray(state)) state.push(intent);
  else if (typeof state === "number") queueAfter([intent], state);
  else {
    const waiting = [intent];
    queueTimes.set(transaction, waiting);
    const latest = outbox.index("by-created-at").openCursor(null, "prev");
    latest.onsuccess = () => queueAfter(waiting, (latest.result?.value as LocalSyncIntent | undefined)?.createdAt ?? 0);
  }
  if (notifyingTransactions.has(transaction)) return;
  notifyingTransactions.add(transaction);
  transaction.addEventListener("complete", () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_OUTBOX_CHANGED_EVENT));
  }, { once: true });
}

export function ensureSyncStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(SYNC_STORES.PRIVATE_NOTES)) db.createObjectStore(SYNC_STORES.PRIVATE_NOTES, { keyPath: "uri" });
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
