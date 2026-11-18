import type { TagMembershipMethod } from "@tagify/sync-contracts";
import type { TagTaxonomy } from "@/types/tagData";
import { isSyncCaptureEnabled, peekTagMethods } from "@/services/sync/SyncLocalState";

/**
 * Library history (tagify-community `docs/LIBRARY_HISTORY_2026-11.md`, slice 2): this device's own
 * append-only log of the changes the member made to their tags, ratings, energy and tag list, for
 * Rewind. It mirrors Community's `tagify_sync.library_history` rows so a later catch-up can upload
 * them. Rows are written in the same transaction as the save they describe, only for edits made on
 * this device (never for changes that arrive from Community), and never touch the saved records:
 * `dateModified` is left exactly as the save set it. Private to the member; never sent to analytics.
 */
export const LIBRARY_HISTORY_STORE = "history";

export const LIBRARY_HISTORY_KINDS = [
  "tag_added",
  "tag_removed",
  "rating",
  "energy",
  "tag_created",
  "tag_renamed",
  "tag_deleted",
  "snapshot",
] as const;

export type LibraryHistoryKind = (typeof LIBRARY_HISTORY_KINDS)[number];

export interface LibraryHistoryRow {
  /** Assigned by the store. */
  id?: number;
  kind: LibraryHistoryKind;
  /** The song, playlist or artist; absent on tag list and snapshot rows. */
  uri?: string;
  tagId?: string;
  /** The tag's name, on tag_created and tag_renamed only. */
  tagName?: string;
  /** Rating or energy before and after; null when there was none. */
  from?: number | null;
  to?: number | null;
  method: TagMembershipMethod;
  /** Device clock, in milliseconds. */
  occurredAt: number;
  /** Snapshot rows only: what replaced the library (an import, a reset...). */
  reason?: string;
  /**
   * True when the change was saved while this device was connected to Community, so it also went
   * out as its own sync change and Community logged it then (slice 1). The catch-up (slice 3) sends
   * only rows Community never logged. Absent on rows saved before this flag existed.
   */
  live?: boolean;
}

interface HistoryRecord {
  tagIds?: readonly string[];
  rating?: number | null;
  energy?: number | null;
}

/** Creates the store; called from the database upgrade. */
export function ensureLibraryHistoryStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains(LIBRARY_HISTORY_STORE)) return;
  const store = db.createObjectStore(LIBRARY_HISTORY_STORE, { keyPath: "id", autoIncrement: true });
  store.createIndex("by-occurred-at", "occurredAt", { unique: false });
}

/** The store names for a write transaction, with the history store when this database has it. */
export function withHistoryStore(db: IDBDatabase, stores: string[]): string[] {
  return db.objectStoreNames.contains(LIBRARY_HISTORY_STORE) ? [...stores, LIBRARY_HISTORY_STORE] : stores;
}

function historyStore(transaction: IDBTransaction): IDBObjectStore | null {
  return transaction.objectStoreNames.contains(LIBRARY_HISTORY_STORE) ? transaction.objectStore(LIBRARY_HISTORY_STORE) : null;
}

/** Adds rows, each marked with whether Community logs it as it syncs (see `live`). */
function addRows(store: IDBObjectStore, rows: LibraryHistoryRow[]): void {
  if (!rows.length) return;
  const live = isSyncCaptureEnabled();
  rows.forEach((row) => store.add({ ...row, live }));
}

function level(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** The rows for one record's change; a removed record (the item leaving the library) has none. */
export function entityHistoryRows(
  uri: string,
  before: HistoryRecord | null | undefined,
  after: HistoryRecord | null | undefined,
  methods: Partial<Record<string, TagMembershipMethod>> = {},
  fallbackMethod: TagMembershipMethod = "unknown",
  occurredAt = Date.now(),
): LibraryHistoryRow[] {
  if (!after) return [];
  const rows: LibraryHistoryRow[] = [];
  const was = new Set(before?.tagIds ?? []);
  const now = new Set(after.tagIds ?? []);
  for (const tagId of now) {
    if (!was.has(tagId)) rows.push({ kind: "tag_added", uri, tagId, method: methods[tagId] ?? fallbackMethod, occurredAt });
  }
  for (const tagId of was) {
    if (!now.has(tagId)) rows.push({ kind: "tag_removed", uri, tagId, method: methods[tagId] ?? fallbackMethod, occurredAt });
  }
  for (const kind of ["rating", "energy"] as const) {
    const from = level(before?.[kind]);
    const to = level(after[kind]);
    if (from !== to) rows.push({ kind, uri, from, to, method: fallbackMethod, occurredAt });
  }
  return rows;
}

/**
 * Logs one record's change inside its save transaction. Call it before the save's sync intent is
 * made: the tag methods noted for the change are read here without using them up.
 */
export function appendEntityHistory(
  transaction: IDBTransaction,
  uri: string,
  before: HistoryRecord | null | undefined,
  after: HistoryRecord | null | undefined,
  fallbackMethod?: TagMembershipMethod,
): void {
  const store = historyStore(transaction);
  if (!store || !after) return;
  const methods = peekTagMethods(uri, before?.tagIds, after.tagIds, transaction.db.name) ?? {};
  addRows(store, entityHistoryRows(uri, before, after, methods, fallbackMethod));
}

/** Tags only (not folders): created, renamed and deleted between two versions of the tag list. */
export function taxonomyHistoryRows(
  before: TagTaxonomy | null | undefined,
  after: TagTaxonomy,
  method: TagMembershipMethod = "unknown",
  occurredAt = Date.now(),
): LibraryHistoryRow[] {
  const was = before?.tagsById ?? {};
  const now = after.tagsById ?? {};
  const rows: LibraryHistoryRow[] = [];
  for (const [tagId, tag] of Object.entries(now)) {
    const previous = was[tagId];
    if (!previous) rows.push({ kind: "tag_created", tagId, tagName: tag.name, method, occurredAt });
    else if (previous.name !== tag.name) rows.push({ kind: "tag_renamed", tagId, tagName: tag.name, method, occurredAt });
  }
  for (const tagId of Object.keys(was)) {
    if (!now[tagId]) rows.push({ kind: "tag_deleted", tagId, method, occurredAt });
  }
  return rows;
}

export function appendTaxonomyHistory(
  transaction: IDBTransaction,
  before: TagTaxonomy | null | undefined,
  after: TagTaxonomy,
  method?: TagMembershipMethod,
): void {
  const store = historyStore(transaction);
  // The first tag list a library saves (starter tags on a fresh install) isn't a change.
  if (!store || !before) return;
  addRows(store, taxonomyHistoryRows(before, after, method));
}

/** One marker for a whole-library replacement (backup import, reset), never a row per tag. */
export function appendSnapshotHistory(transaction: IDBTransaction, reason: string): void {
  const store = historyStore(transaction);
  if (store) addRows(store, [{ kind: "snapshot", method: "unknown", occurredAt: Date.now(), reason }]);
}

/**
 * Gives tags that are new since `before` the time they were created. A tag list with no saved
 * version before it (a fresh install) is left as it is.
 */
export function stampNewTags(before: TagTaxonomy | null | undefined, after: TagTaxonomy, now = Date.now()): TagTaxonomy {
  if (!before) return after;
  const was = before.tagsById ?? {};
  let tagsById: TagTaxonomy["tagsById"] | null = null;
  for (const [tagId, tag] of Object.entries(after.tagsById ?? {})) {
    if (was[tagId]) {
      const createdAt = was[tagId].createdAt;
      if (tag.createdAt === undefined && typeof createdAt === "number") (tagsById ??= { ...after.tagsById })[tagId] = { ...tag, createdAt };
    } else if (typeof tag.createdAt !== "number") {
      (tagsById ??= { ...after.tagsById })[tagId] = { ...tag, createdAt: now };
    }
  }
  return tagsById ? { ...after, tagsById } : after;
}

/** The first moment kept: January 1 of the previous calendar year, on this device's clock. */
export function libraryHistoryCutoff(now = Date.now()): number {
  return new Date(new Date(now).getFullYear() - 1, 0, 1).getTime();
}

/** Deletes rows from before the previous calendar year. Resolves with how many were deleted. */
export function trimLibraryHistory(db: IDBDatabase, now = Date.now()): Promise<number> {
  if (!db.objectStoreNames.contains(LIBRARY_HISTORY_STORE)) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_HISTORY_STORE, "readwrite");
    const index = transaction.objectStore(LIBRARY_HISTORY_STORE).index("by-occurred-at");
    const cutoff = libraryHistoryCutoff(now);
    let deleted = 0;
    // Oldest first: stop at the first row that is kept.
    const cursor = index.openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result || !((cursor.result.value as LibraryHistoryRow).occurredAt < cutoff)) return;
      cursor.result.delete();
      deleted++;
      cursor.result.continue();
    };
    transaction.oncomplete = () => resolve(deleted);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

/** Every row, oldest first. */
export function readLibraryHistory(db: IDBDatabase): Promise<LibraryHistoryRow[]> {
  if (!db.objectStoreNames.contains(LIBRARY_HISTORY_STORE)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const request = db.transaction(LIBRARY_HISTORY_STORE, "readonly").objectStore(LIBRARY_HISTORY_STORE).getAll();
    request.onsuccess = () => resolve(request.result as LibraryHistoryRow[]);
    request.onerror = () => reject(request.error);
  });
}

/** Up to `limit` rows after the row `afterId` (0: from the start), in the order they were saved. */
export function readLibraryHistoryAfter(db: IDBDatabase, afterId: number, limit: number): Promise<LibraryHistoryRow[]> {
  if (!db.objectStoreNames.contains(LIBRARY_HISTORY_STORE)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const request = db.transaction(LIBRARY_HISTORY_STORE, "readonly").objectStore(LIBRARY_HISTORY_STORE)
      .getAll(IDBKeyRange.lowerBound(afterId, true), Math.max(1, limit));
    request.onsuccess = () => resolve(request.result as LibraryHistoryRow[]);
    request.onerror = () => reject(request.error);
  });
}

function historyRowSignature(row: LibraryHistoryRow): string {
  return JSON.stringify([row.kind, row.uri ?? null, row.tagId ?? null, row.tagName ?? null, row.from ?? null, row.to ?? null, row.method, row.occurredAt, row.reason ?? null]);
}

/**
 * Carries the history kept while this computer wasn't connected (the local-only database) into the
 * account's database when it connects, so the catch-up can send it. Rows the account's database
 * already holds (carried on an earlier connect) are not added twice. Resolves with how many were added.
 */
export async function carryLibraryHistory(source: IDBDatabase, target: IDBDatabase): Promise<number> {
  if (!source.objectStoreNames.contains(LIBRARY_HISTORY_STORE) || !target.objectStoreNames.contains(LIBRARY_HISTORY_STORE)) return 0;
  const incoming = await readLibraryHistory(source);
  if (!incoming.length) return 0;
  const existing = new Set((await readLibraryHistory(target)).map(historyRowSignature));
  return new Promise((resolve, reject) => {
    const transaction = target.transaction(LIBRARY_HISTORY_STORE, "readwrite");
    const store = transaction.objectStore(LIBRARY_HISTORY_STORE);
    let added = 0;
    for (const row of incoming) {
      const signature = historyRowSignature(row);
      if (existing.has(signature)) continue;
      existing.add(signature);
      // A new id in this database; `live` stays as it was where the row was saved.
      const { id: _id, ...carried } = row;
      store.add(carried);
      added++;
    }
    transaction.oncomplete = () => resolve(added);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}
