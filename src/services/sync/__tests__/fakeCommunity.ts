import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import type { AnnotationSnapshotV1, DurableAppStateDocumentV2, LibrarySnapshotV2, SyncMutationV2, TaxonomyNodeSnapshotV1 } from "@tagify/sync-contracts";
import { entityKeyV1 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import { syncRuntime } from "../SyncRuntime";

/**
 * An in-memory Community private library that follows the server's push and
 * pull rules (push_sync_batch, push_sync_batch_v2, pull_sync_changes):
 * a repeated batch ID returns the earlier result and applies nothing, a
 * repeated operation ID is skipped, a stale revision becomes a conflict,
 * and accepted changes are replayed in cursor order.
 */
export class FakeCommunity {
  readonly libraryId = "123e4567-e89b-42d3-a456-426614174004";
  headCursor = 0;
  readonly batches: Array<{ cursor: number; batchId: string; operations: SyncMutationV2[]; committedAt: string }> = [];
  readonly annotations = new Map<string, AnnotationSnapshotV1>();
  readonly nodes = new Map<string, TaxonomyNodeSnapshotV1>();
  readonly parentRevisions = new Map<string, number>();
  readonly appState = new Map<string, DurableAppStateDocumentV2>();
  readonly operationIds = new Set<string>();
  readonly pushes: Array<{ batchId: string; operations: SyncMutationV2[]; duplicate: boolean; conflicts: number }> = [];
  conflictCount = 0;
  /** Runs once before the next push is applied, like another device committing first. */
  beforeNextPush: (() => void) | null = null;

  annotation(entity: AnnotationSnapshotV1["entity"]): AnnotationSnapshotV1 {
    const key = entityKeyV1(entity);
    let annotation = this.annotations.get(key);
    if (!annotation) {
      annotation = {
        entity,
        fields: { rating: { value: null, revision: 0 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } },
        tagMemberships: {}, entityRevision: 0, deleted: false,
      };
      this.annotations.set(key, annotation);
    }
    return annotation;
  }

  /** Commits a batch as another device would, through the same rules. */
  commitFrom(operations: SyncMutationV2[], batchId: string = crypto.randomUUID()) {
    return this.push({ protocolVersion: operations.some((operation) => operation.type === "app-state.replace") ? 2 : 1, batchId, operations });
  }

  push(batch: { protocolVersion: number; batchId: string; operations: SyncMutationV2[] }) {
    const before = this.beforeNextPush;
    this.beforeNextPush = null;
    before?.();
    const earlier = this.batches.find((item) => item.batchId === batch.batchId);
    if (earlier) {
      this.pushes.push({ batchId: batch.batchId, operations: batch.operations, duplicate: true, conflicts: 0 });
      return { cursor: earlier.cursor, headCursor: this.headCursor, changes: earlier.operations, conflictIds: [], duplicate: true };
    }
    const accepted: SyncMutationV2[] = [];
    const conflictIds: string[] = [];
    const conflict = () => { this.conflictCount++; conflictIds.push(crypto.randomUUID()); };
    for (const operation of batch.operations) {
      if (this.operationIds.has(operation.operationId)) continue;
      this.operationIds.add(operation.operationId);
      if (operation.type === "app-state.replace") {
        const document = this.appState.get(operation.domain);
        if ((document?.revision ?? 0) !== operation.expectedRevision) { conflict(); continue; }
        this.appState.set(operation.domain, { domain: operation.domain, value: operation.value, revision: (document?.revision ?? 0) + 1, updatedAt: new Date().toISOString() });
        accepted.push(operation);
      } else if (operation.type === "annotation.patch") {
        const annotation = this.annotation(operation.entity);
        const fields: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(operation.fields) as Array<[keyof AnnotationSnapshotV1["fields"], never]>) {
          if (annotation.fields[field].revision !== operation.expectedRevisions[field]) { conflict(); continue; }
          annotation.fields[field] = { value, revision: annotation.fields[field].revision + 1 };
          annotation.entityRevision++;
          annotation.deleted = false;
          fields[field] = value;
        }
        if (Object.keys(fields).length) accepted.push({ ...operation, fields });
      } else if (operation.type === "annotation.tag-membership") {
        const annotation = this.annotation(operation.entity);
        const membership = annotation.tagMemberships[operation.tagId];
        if (membership && membership.value === operation.present) continue;
        if ((membership?.revision ?? 0) !== operation.expectedRevision) { conflict(); continue; }
        annotation.tagMemberships[operation.tagId] = { value: operation.present, revision: (membership?.revision ?? 0) + 1 };
        annotation.entityRevision++;
        annotation.deleted = false;
        accepted.push(operation);
      } else if (operation.type === "annotation.delete") {
        const annotation = this.annotation(operation.entity);
        if (annotation.entityRevision !== operation.expectedEntityRevision) { conflict(); continue; }
        annotation.entityRevision++;
        annotation.deleted = true;
        accepted.push(operation);
      } else if (operation.type === "taxonomy.upsert" || operation.type === "taxonomy.delete") {
        const node = this.nodes.get(operation.node.id);
        const parentKey = operation.node.parentId || "__root__";
        const parentRevision = this.parentRevisions.get(parentKey) ?? 0;
        if ((node?.nodeRevision ?? 0) !== operation.expectedNodeRevision || parentRevision !== operation.expectedParentListRevision) { conflict(); continue; }
        this.parentRevisions.set(parentKey, parentRevision + 1);
        this.nodes.set(operation.node.id, { ...operation.node, nodeRevision: (node?.nodeRevision ?? 0) + 1, parentListRevision: parentRevision + 1, deleted: operation.type === "taxonomy.delete" });
        accepted.push(operation);
      } else {
        throw new Error(`The test server does not handle ${operation.type}`);
      }
    }
    if (accepted.length) {
      this.headCursor++;
      this.batches.push({ cursor: this.headCursor, batchId: batch.batchId, operations: accepted, committedAt: new Date().toISOString() });
    }
    this.pushes.push({ batchId: batch.batchId, operations: batch.operations, duplicate: false, conflicts: conflictIds.length });
    return { cursor: this.headCursor, headCursor: this.headCursor, changes: accepted, conflictIds, duplicate: false, projection: { complete: true } };
  }

  snapshot(): LibrarySnapshotV2 {
    const parentListRevision = (node: TaxonomyNodeSnapshotV1) => this.parentRevisions.get(node.parentId || "__root__") ?? 0;
    return {
      protocolVersion: 2, sourceStorageSchemaVersion: 9, libraryId: this.libraryId, headCursor: this.headCursor,
      generatedAt: new Date().toISOString(),
      taxonomy: [...this.nodes.values()].filter((node) => !node.deleted).map((node) => ({ ...node, parentListRevision: parentListRevision(node) })),
      colors: [], collections: [],
      annotations: [...this.annotations.values()].filter((annotation) => !annotation.deleted).map((annotation) => structuredClone(annotation)),
      appState: [...this.appState.values()],
    };
  }

  tags(providerId: string): string[] {
    const annotation = this.annotations.get(entityKeyV1({ provider: "spotify", kind: "track", providerId }));
    return Object.entries(annotation?.tagMemberships ?? {}).filter(([, membership]) => membership.value).map(([tagId]) => tagId).sort();
  }

  /** Answers the client's requests; install it with `vi.spyOn(globalThis, "fetch")`. */
  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/v2/sync/pull") {
      const after = Number(url.searchParams.get("after") || 0);
      const limit = Number(url.searchParams.get("limit") || 100);
      const tag = (init?.headers as Record<string, string> | undefined)?.["if-none-match"];
      if (tag === `"sync-cursor-${this.headCursor}"` && after === this.headCursor) return new Response(null, { status: 304 });
      return json({ protocolVersion: 1, libraryId: this.libraryId, headCursor: this.headCursor, batches: this.batches.filter((batch) => batch.cursor > after).slice(0, limit), conflicts: [], snapshotRequired: false });
    }
    if (url.pathname === "/api/v2/sync/push") return json(this.push(body));
    if (url.pathname === "/api/v2/sync/ack") return json({ acknowledged: true });
    if (url.pathname === "/api/v2/sync/snapshot") return json({ snapshot: this.snapshot() });
    throw new Error(`The test server does not handle ${url.pathname}`);
  };
}

export const syncConfiguration = (deviceId: string): DesktopSyncConfiguration => ({
  accountId: "durability-account", libraryId: "123e4567-e89b-42d3-a456-426614174004", deviceId,
  apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60 * 60_000,
});

export type RuntimeInternals = {
  push(configuration: DesktopSyncConfiguration): Promise<unknown>;
  pull(configuration: DesktopSyncConfiguration): Promise<boolean>;
  settleLocalAndPublicSync(configuration: DesktopSyncConfiguration): Promise<void>;
  pushDurableAppState(configuration: DesktopSyncConfiguration): Promise<void>;
  supportsV2: boolean;
  capabilities: unknown;
  backupHealth: unknown;
  taxonomyRefreshRequested: boolean;
  ownBatchIds?: Set<string>;
};
export const runtime = syncRuntime as unknown as RuntimeInternals;

/**
 * One Spotify installation: its own IndexedDB and its own record of the
 * batches it sent. Switching devices swaps both, like two computers sharing
 * one Community library.
 */
export class FakeDevice {
  readonly factory = new IDBFactory();
  readonly ownBatchIds = new Set<string>();
  readonly configuration: DesktopSyncConfiguration;
  readonly localStorage = new Map<string, string>();

  constructor(readonly name: string) {
    this.configuration = syncConfiguration(`${name}-device`);
  }
}

let activeDevice: FakeDevice | null = null;

export async function useDevice(device: FakeDevice): Promise<void> {
  if (activeDevice === device) return;
  if (activeDevice) {
    activeDevice.localStorage.clear();
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)!;
      activeDevice.localStorage.set(key, localStorage.getItem(key)!);
    }
    const ids = runtime.ownBatchIds;
    if (ids) { activeDevice.ownBatchIds.clear(); ids.forEach((id) => activeDevice!.ownBatchIds.add(id)); }
  }
  indexedDBStorage.resetConnection();
  vi.stubGlobal("indexedDB", device.factory);
  localStorage.clear();
  device.localStorage.forEach((value, key) => localStorage.setItem(key, value));
  setDesktopSyncConfiguration(device.configuration);
  const ids = runtime.ownBatchIds;
  if (ids) { ids.clear(); device.ownBatchIds.forEach((id) => ids.add(id)); }
  runtime.taxonomyRefreshRequested = false;
  activeDevice = device;
  if (!(await storageService.switchAccountDatabase())) throw new Error("The test device database could not be opened");
}

export function resetDevices(): void {
  activeDevice = null;
  runtime.ownBatchIds?.clear();
  runtime.taxonomyRefreshRequested = false;
}

export async function readStore<T>(storeName: string): Promise<T[]> {
  const { getTagifyDatabaseName } = await import("../SyncLocalState");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(getTagifyDatabaseName());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName).objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function putStateRecord(record: unknown): Promise<void> {
  const { getTagifyDatabaseName } = await import("../SyncLocalState");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(getTagifyDatabaseName());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("sync-state", "readwrite");
      transaction.objectStore("sync-state").put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
