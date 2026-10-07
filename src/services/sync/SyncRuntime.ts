import type {
  AnnotationPatchMutationV1,
  AnnotationSnapshotV1,
  CollectionSnapshotV1,
  CustomColorSnapshotV1,
  LibrarySnapshotV1,
  LibrarySnapshotV2,
  DurableAppStateDocumentV2,
  DurableAppStateDomain,
  AppStateReplaceMutationV2,
  SyncBatchV1,
  SyncChangeV1,
  SyncConflictV1,
  SyncCapabilitiesV1,
  SyncCapabilitiesV2,
  SyncMutationV1,
  SyncMutationV2,
  TagMembershipMutationV1,
  TaxonomyNodeSnapshotV1,
  InitialMergePlanV1,
  InitialMergeResultV1,
  InitialMergeSource,
} from "@tagify/sync-contracts";
import { assertLibrarySnapshotV1, assertLibrarySnapshotV2, assertSyncMutationV1, entityKeyV1, MAX_APP_STATE_DOCUMENT_BYTES, planInitialLibraryMerge, PRIVATE_SYNC_PROTOCOL_VERSION } from "@tagify/sync-contracts";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { storageService } from "@/services/storage/StorageService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import type { ArtistData, PlaylistData, TrackData } from "@/types/tagData";
import type { TagDataStructure, TagTaxonomy } from "@/types/tagData";
import { normalizeTaxonomyTree, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import {
  getDesktopSyncConfiguration,
  getTagifyDatabaseName,
  isSyncSafeId,
  normalizeSyncBpm,
  normalizeSyncEnergy,
  normalizeSyncKey,
  normalizeSyncRating,
  deviceTimestamp,
  syncTimestamps,
  LOCAL_FILES_CHANGED_EVENT,
  flushLocalPersistence,
  setLocalPersistencePaused,
  classifyLocalReplica,
  setDesktopSyncConfiguration,
  SYNC_OUTBOX_CHANGED_EVENT,
  SYNC_STORES,
  type DesktopSyncConfiguration,
  type EntityReplaceIntent,
  type LocalSyncIntent,
  type ReplicaManifest,
  type TaxonomyReplaceIntent,
} from "./SyncLocalState";
import { applyDurableAppStateDocuments, buildDurableAppStateDocuments, durableStateEquals, durableStateStoredByteLength, sanitizeSmartPlaylists } from "./DurableAppState";
import {
  clearExplicitSmartPlaylistClear,
  wereSmartPlaylistsExplicitlyCleared,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { rebuildDeviceTaxonomy } from "./PreserveLocalTaxonomyMetadata";
import {
  chunkLocalFileEntries,
  LOCAL_FILE_BACKUP_SHADOW_KEY,
  localFileEntries,
  localFileTracks,
  planIncomingLocalFiles,
  planOutgoingLocalFiles,
  type LocalFileBackupShadow,
  type LocalFileEntries,
} from "./LocalFileBackup";
import { expandSyncTaxonomy, flattenTaxonomy, taxonomyFromShadowRecord, type TaxonomyShadowRecord } from "./SyncTaxonomy";

export { expandSyncTaxonomy, type TaxonomyShadowRecord } from "./SyncTaxonomy";
import { syncPairingService } from "./SyncPairingService";
import { enrollDesktopRecovery } from "./SyncInstallRecovery";
import packageJson from "@/package";
import { downloadTagDataBackup } from "@/features/tag-data/utils/tagData.backup";
import { readCompleteBackupContents } from "@/features/tag-data/utils/tagData.backupContents";

export type SyncStatus = "unlinked" | "idle" | "syncing" | "publishing" | "offline" | "reauthorize" | "snapshot-required" | "merge-required" | "publication-review-required" | "recovery-available" | "restoring" | "restore-failed" | "error";
export interface InitialMergeReview extends InitialMergePlanV1 { labels: Record<string, string>; supported: boolean }
export interface RecoveryPreview { annotations: number; taxonomyNodes: number; appStateDocuments: number; smartPlaylists: number | null; lastBackupAt: string | null; protectedDomains: string[] }
export interface BackupHealth { lastBackupAt: string | null; annotations: number; taxonomyNodes: number; appStateDocuments: number; protectedDomains: string[] }
export function canCombineInitialLibrariesWithoutReview(review: InitialMergeReview | null): boolean {
  return Boolean(review?.supported && review.conflicts.length === 0);
}
export function sameInitialMergeDeviceContent(left: LibrarySnapshotV2, right: LibrarySnapshotV2): boolean {
  const content = (snapshot: LibrarySnapshotV2) => JSON.stringify({
    libraryId: snapshot.libraryId,
    sourceStorageSchemaVersion: snapshot.sourceStorageSchemaVersion,
    taxonomy: snapshot.taxonomy,
    colors: snapshot.colors,
    collections: snapshot.collections,
    annotations: snapshot.annotations,
    appState: snapshot.appState.map(({ domain, value }) => ({ domain, value })),
  });
  return content(left) === content(right);
}
interface ShadowRecord { key: string; annotation: AnnotationSnapshotV1 }
interface CursorRecord { key: "cursor"; value: number }
interface PullBatch { cursor: number; batchId: string; operations: SyncMutationV2[]; committedAt: string }
type AnnotationMutation = Extract<SyncMutationV1, { type: "annotation.patch" | "annotation.tag-membership" | "annotation.delete" }>;

const RECOVERY_POLL_INTERVALS_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000] as const;
const LIBRARY_SUMMARY_REFRESH_MS = 6 * 60 * 60_000;
const CAPABILITIES_CACHE_MS = 24 * 60 * 60_000;
const SYNC_CLIENT_GENERATION = "event-driven-v1";
const CLIENT_VERSION = packageJson.version;

export function safetySyncDelayMs(stage = 2, random = Math.random): number {
  const interval = RECOVERY_POLL_INTERVALS_MS[Math.min(Math.max(stage, 0), RECOVERY_POLL_INTERVALS_MS.length - 1)];
  return Math.round(interval * (1 + random() * 0.2));
}

export function syncClientHeaders(accessToken?: string): Record<string, string> {
  return {
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    "x-tagify-client-version": CLIENT_VERSION,
    "x-tagify-sync-protocol": String(PRIVATE_SYNC_PROTOCOL_VERSION),
    "x-tagify-sync-generation": SYNC_CLIENT_GENERATION,
  };
}

export function capabilitiesCacheKey(apiBaseUrl: string): string {
  return `tagify:sync-capabilities:${CLIENT_VERSION}:${new URL(apiBaseUrl).origin}`;
}

interface SyncLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export function accountSyncLockName(accountId: string): string {
  return `tagify:community-sync:${accountId}`;
}

export function runWithAccountSyncLock<T>(
  accountId: string,
  callback: () => Promise<T>,
  lockManager: SyncLockManager | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.locks as SyncLockManager | undefined,
): Promise<T> {
  if (!lockManager) return callback();
  return lockManager.request(accountSyncLockName(accountId), { mode: "exclusive" }, callback);
}

export async function gzipJsonBody(value: unknown): Promise<ArrayBuffer> {
  if (typeof CompressionStream === "undefined") throw new Error("This Spotify version cannot prepare a large Community library review");
  const source = new Response(JSON.stringify(value)).body;
  if (!source) throw new Error("This Spotify version cannot prepare a large Community library review");
  return new Response(source.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

export function coalesceOutboxIntents(intents: LocalSyncIntent[]): { intents: LocalSyncIntent[]; supersededIds: string[] } {
  const snapshotIndex = intents.findIndex((intent) => intent.type === "library.snapshot");
  if (snapshotIndex === 0) return { intents: [intents[0]], supersededIds: [] };
  const segment = snapshotIndex < 0 ? intents : intents.slice(0, snapshotIndex);
  const latestByKey = new Map<string, LocalSyncIntent>();
  const supersededIds: string[] = [];
  for (const intent of segment) {
    if (intent.type === "library.snapshot") continue;
    const key = intent.type === "taxonomy.replace"
      ? "taxonomy"
      : `entity:${entityKeyV1(intent.entity)}`;
    const previous = latestByKey.get(key);
    if (previous) supersededIds.push(previous.id);
    latestByKey.set(key, intent);
  }
  return {
    intents: [...latestByKey.values()].sort((left, right) => left.createdAt - right.createdAt),
    supersededIds,
  };
}

export function syncFailureBackoffMs(status: number, retryAfterSeconds: number | null, failureCount: number, random = Math.random): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.min(retryAfterSeconds * 1000, 6 * 60 * 60_000);
  if (status === 402) return 6 * 60 * 60_000;
  const base = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(failureCount, 6));
  return Math.round(base * (1 + random() * 0.25));
}

export function shouldStampAnnotationDateModified(
  operation: AnnotationMutation,
): boolean {
  if (operation.type === "annotation.tag-membership") {
    return true;
  }

  if (operation.type === "annotation.delete") {
    return false;
  }

  return "rating" in operation.fields || "energy" in operation.fields;
}

export async function revokeDesktopSyncDevice(
  configuration: DesktopSyncConfiguration,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request(
    `${configuration.apiBaseUrl}/api/v2/devices/${encodeURIComponent(configuration.deviceId)}`,
    {
      method: "DELETE",
      headers: syncClientHeaders(configuration.accessToken),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (response.ok || response.status === 401) return;
  throw new Error(
    payload.error?.message || "Tagify could not revoke this device from Community.",
  );
}

class SyncRuntime extends EventTarget {
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private status: SyncStatus = "unlinked";
  private realtime: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private realtimeConnecting = false;
  private realtimeSubscribedAt = 0;
  private initialMergePreview: InitialMergeReview | null = null;
  private initialMergeDeviceSnapshot: LibrarySnapshotV2 | null = null;
  private initialMergeOperationId: string | null = null;
  private recoveryPreview: RecoveryPreview | null = null;
  private lastRecovered: RecoveryPreview | null = null;
  private supportsV2 = false;
  private backupHealth: BackupHealth | null = null;
  private cloudReplacementArmed = false;
  private readonly oversizedAppStateDomains = new Set<DurableAppStateDomain>();
  private taxonomyRefreshRequested = false;
  private capabilities: SyncCapabilitiesV1 | SyncCapabilitiesV2 | null = null;
  private lastLibrarySummaryAt = 0;
  private automaticRetryNotBefore = 0;
  private consecutiveFailures = 0;
  private lastUserSyncAt = 0;
  private recoveryPollStage = 0;
  private projectionTargetCursor = 0;
  private projectionPending = false;
  private projectionReviewRequired = false;
  private backupHealthRefreshRequested = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    const configuration = getDesktopSyncConfiguration();
    this.setStatus(configuration ? this.recoveryPreview ? "recovery-available" : "idle" : "unlinked");
    window.addEventListener("online", this.handleOnline);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener(SYNC_OUTBOX_CHANGED_EVENT, this.handleOutboxChanged);
    window.addEventListener(LOCAL_FILES_CHANGED_EVENT, this.handleOutboxChanged);
    // Realtime and local outbox events trigger immediate sync. Recovery pulls
    // back off from 5 to 15 to 30 minutes and pause while Spotify is hidden.
    this.scheduleSafetySync();
    this.installPublicApi();
    if (configuration) {
      void this.connectRealtime(configuration);
      void this.syncNow();
    }
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.timer = null;
    this.reconnectTimer = null;
    window.removeEventListener("online", this.handleOnline);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener(SYNC_OUTBOX_CHANGED_EVENT, this.handleOutboxChanged);
    window.removeEventListener(LOCAL_FILES_CHANGED_EVENT, this.handleOutboxChanged);
    if (this.channel && this.realtime) void this.realtime.removeChannel(this.channel);
    this.channel = null; this.realtime = null;
  }

  getStatus(): SyncStatus { return this.status; }
  getInitialMergePreview(): InitialMergeReview | null { return this.initialMergePreview; }
  getRecoveryPreview(): RecoveryPreview | null { return this.recoveryPreview; }
  getLastRecovered(): RecoveryPreview | null { return this.lastRecovered; }
  getBackupHealth(): BackupHealth | null { return this.backupHealth; }
  async commitInitialMerge(resolutions: Record<string, InitialMergeSource>): Promise<InitialMergeResultV1> {
    const configuration = getDesktopSyncConfiguration();
    let review = this.initialMergePreview;
    let deviceSnapshot = this.initialMergeDeviceSnapshot;
    if (!configuration || !review || !deviceSnapshot) throw new Error("The library review is no longer available");
    if (review.conflicts.some((conflict) => !resolutions[conflict.id])) throw new Error("Choose which copy to keep before combining your libraries");
    this.setStatus("syncing");
    try {
      await flushLocalPersistence();
      const latestDeviceSnapshot = await this.captureInitialMergeDeviceSnapshot(configuration);
      if (!sameInitialMergeDeviceContent(deviceSnapshot, latestDeviceSnapshot)) {
        await this.prepareInitialMerge(configuration);
        review = this.initialMergePreview;
        deviceSnapshot = this.initialMergeDeviceSnapshot;
        if (!review || !deviceSnapshot || review.conflicts.length) {
          throw new Error("merge_review_required: Your device library changed. Check the refreshed choices before combining.");
        }
      }
      const outboxBeforeMerge = (await readOutbox()).map((intent) => intent.id).sort().join(",");
      const response = await this.requestCompressed(configuration, "/api/v2/sync/merge", {
        version: 1,
        deviceId: configuration.deviceId,
        operationId: this.initialMergeOperationId || (this.initialMergeOperationId = crypto.randomUUID()),
        expectedCommunityHeadCursor: review.communityHeadCursor,
        expectedCommunityChecksum: review.communityChecksum,
        deviceSnapshot,
        resolutions,
      });
      const canonical = await this.downloadSnapshot(configuration, PRIVATE_SYNC_PROTOCOL_VERSION) as LibrarySnapshotV2;
      assertLibrarySnapshotV2(canonical);
      await flushLocalPersistence();
      const outboxAfterMerge = (await readOutbox()).map((intent) => intent.id).sort().join(",");
      const currentDeviceSnapshot = await this.captureInitialMergeDeviceSnapshot(configuration);
      if (outboxAfterMerge !== outboxBeforeMerge || !sameInitialMergeDeviceContent(deviceSnapshot, currentDeviceSnapshot)) {
        await this.prepareInitialMerge(configuration);
        throw new Error("merge_review_required: Your device library changed while Tagify was combining it. Check the refreshed choices before continuing.");
      }
      const current = await storageService.loadAll();
      const saved = await indexedDBStorage.replaceCloudReplica(tagDataFromSnapshot(canonical, current), replicaManifest(configuration, canonical), stateRecordsFromSnapshot(canonical), canonical.appState);
      if (!saved) throw new Error("Your combined library was saved to Community, but this device could not finish updating");
      await applyDurableAppStateDocuments(canonical.appState, { smartPlaylistsAlreadyPersisted: true });
      await markManifestAppStateApplied();
      await this.request(configuration, "/api/v2/sync/ack", { deviceId: configuration.deviceId, cursor: canonical.headCursor });
      this.initialMergePreview = null;
      this.initialMergeDeviceSnapshot = null;
      this.initialMergeOperationId = null;
      this.backupHealthRefreshRequested = true;
      dispatchSyncEvent("remote", crypto.randomUUID(), []);
      this.updateProjectionStatus(response.projection);
      this.setSettledStatus();
      return {
        ...(response.merge as InitialMergeResultV1),
        additionsFromDevice: review.additionsFromDevice,
        additionsFromCommunity: review.additionsFromCommunity,
        conflictsResolved: review.conflicts.length,
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("merge_review_required:")) {
        this.setStatus("merge-required");
        throw error;
      }
      if (error instanceof SyncHttpError && error.status === 409) {
        await this.prepareInitialMerge(configuration);
        if (this.initialMergePreview?.conflicts.length) {
          this.setStatus("merge-required");
          throw new Error("merge_review_required: Community changed while you were reviewing. Check the refreshed differences before continuing.");
        }
        this.setStatus("syncing");
        throw new Error("Community changed while Tagify was combining your libraries. Tagify will try again.");
      }
      this.setStatus(review?.conflicts.length ? "merge-required" : "error");
      throw error;
    }
  }

  async downloadInitialMergeBackup(): Promise<void> {
    const data = await indexedDBStorage.loadAll();
    if (!data) throw new Error("Your Tagify backup could not be prepared");
    downloadTagDataBackup(data, await readCompleteBackupContents());
  }
  armCloudReplacement(): void { this.cloudReplacementArmed = true; }

  async unlinkLocal(): Promise<void> {
    this.stop();
    try {
      const configuration = getDesktopSyncConfiguration();
      if (configuration) {
        let activeConfiguration: DesktopSyncConfiguration | null = configuration;
        try {
          activeConfiguration = await this.refreshIfNeeded(configuration);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "session_inactive") throw error;
          activeConfiguration = null;
        }
        if (activeConfiguration) await revokeDesktopSyncDevice(activeConfiguration);
      }
      await syncPairingService.unlinkLocal();
      this.backupHealth = null;
      this.initialMergePreview = null;
      this.initialMergeDeviceSnapshot = null;
      this.initialMergeOperationId = null;
      this.recoveryPreview = null;
      this.setStatus("unlinked");
    } catch (error) {
      this.start();
      throw error;
    }
  }

  async activateCurrentAccount(): Promise<void> {
    this.stop();
    if (!(await storageService.switchAccountDatabase())) {
      throw new Error("The account-scoped Tagify database could not be opened");
    }
    this.start();
    await this.syncNow();
  }

  async replaceCloudWithCurrentLocalState(): Promise<void> {
    const configuration = getDesktopSyncConfiguration();
    if (!configuration) return;
    if (!this.cloudReplacementArmed) throw new Error("Cloud replacement requires the RESET TAGIFY confirmation");
    try {
      await flushLocalPersistence();
      const core = await buildLocalSnapshot(configuration.libraryId);
      const appState = await buildDurableAppStateDocuments();
      const operationId = crypto.randomUUID();
      const snapshot: LibrarySnapshotV2 = { ...core, protocolVersion: PRIVATE_SYNC_PROTOCOL_VERSION, appState };
      assertLibrarySnapshotV2(snapshot);
      const result = await this.request(configuration, "/api/v2/sync/replace", {
        deviceId: configuration.deviceId, operationId, confirmation: "RESET TAGIFY", snapshot,
      });
      this.updateProjectionStatus(result.projection);
      const canonical = await this.downloadSnapshot(configuration, PRIVATE_SYNC_PROTOCOL_VERSION) as LibrarySnapshotV2;
      assertLibrarySnapshotV2(canonical);
      const saved = await indexedDBStorage.replaceCloudReplica(tagDataFromSnapshot(canonical), replicaManifest(configuration, canonical), stateRecordsFromSnapshot(canonical), canonical.appState);
      if (!saved) throw new Error("The reset cloud snapshot was accepted but the local replica could not be finalized");
      await applyDurableAppStateDocuments(canonical.appState, { smartPlaylistsAlreadyPersisted: true });
      await markManifestAppStateApplied();
      await this.request(configuration, "/api/v2/sync/ack", { deviceId: configuration.deviceId, cursor: canonical.headCursor });
      dispatchSyncEvent("local", operationId, []);
      this.setSettledStatus();
    } finally {
      this.cloudReplacementArmed = false;
    }
  }

  async communityRequest(path: string, options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<any> {
    const configuration = getDesktopSyncConfiguration();
    if (!configuration) throw new Error("Community Sync is not connected");
    const active = await this.refreshIfNeeded(configuration);
    const response = await fetch(`${active.apiBaseUrl}${path}`, {
      method: options.method || (options.body === undefined ? "GET" : "POST"),
      headers: { ...syncClientHeaders(active.accessToken), ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || response.statusText);
    return payload;
  }

  async syncNow(automatic = false): Promise<void> {
    if (automatic && Date.now() < this.automaticRetryNotBefore) return;
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    const configuration = getDesktopSyncConfiguration();
    if (!configuration) { this.setStatus("unlinked"); return; }
    if (this.recoveryPreview) {
      if (this.status !== "restoring" && this.status !== "restore-failed") {
        this.setStatus("recovery-available");
      }
      return;
    }
    if (!navigator.onLine) { this.setStatus("offline"); return; }
    if (!this.channel) void this.connectRealtime(configuration);
    this.running = runWithAccountSyncLock(configuration.accountId, async () => {
      const activeConfiguration = getDesktopSyncConfiguration();
      if (!activeConfiguration || activeConfiguration.accountId !== configuration.accountId) return;
      await this.run(activeConfiguration);
    }).finally(() => {
      this.running = null;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.syncNow(true);
      }
    });
    return this.running;
  }

  private userSyncNow(): Promise<void> {
    if (Date.now() - this.lastUserSyncAt < 30_000) return Promise.resolve();
    this.lastUserSyncAt = Date.now();
    return this.syncNow();
  }

  private async run(configuration: DesktopSyncConfiguration): Promise<void> {
    this.setStatus("syncing");
    try {
      const active = await this.refreshIfNeeded(configuration);
      const capabilities = this.capabilities ?? await this.loadCapabilities(active);
      this.capabilities = capabilities;
      if ("minimumEfficientClientVersion" in capabilities && typeof capabilities.minimumEfficientClientVersion === "string" && compareVersions(CLIENT_VERSION, capabilities.minimumEfficientClientVersion) < 0) {
        throw new Error("efficient_client_required: Update Tagify to keep Community Sync running.");
      }
      this.supportsV2 = Array.isArray(capabilities.supportedProtocolVersions) && capabilities.supportedProtocolVersions.includes(PRIVATE_SYNC_PROTOCOL_VERSION);
      const manifest = await readManifest();
      const shouldRefreshSummary = !manifest || !this.backupHealth || Date.now() - this.lastLibrarySummaryAt >= LIBRARY_SUMMARY_REFRESH_MS;
      const summary = shouldRefreshSummary ? (await this.request(active, "/api/v2/library")).library : {};
      if (shouldRefreshSummary) {
        this.backupHealth = backupHealthFromSummary(summary);
        this.lastLibrarySummaryAt = Date.now();
      }
      if (!(await this.ensureReplicaReady(active, summary))) return;
      await syncPairingService.recoverLegacyReplica(active.accountId);
      await this.settleLocalAndPublicSync(active);
      if (this.backupHealthRefreshRequested) {
        const confirmedSummary = (await this.request(active, "/api/v2/library")).library;
        this.backupHealth = backupHealthFromSummary(confirmedSummary);
        this.lastLibrarySummaryAt = Date.now();
        this.backupHealthRefreshRequested = false;
      }
      this.consecutiveFailures = 0;
      this.automaticRetryNotBefore = 0;
      this.setSettledStatus();
    } catch (error) {
      this.consecutiveFailures++;
      const status = error instanceof SyncHttpError ? error.status : 0;
      const retryAfterSeconds = error instanceof SyncHttpError ? error.retryAfterSeconds : null;
      this.automaticRetryNotBefore = Date.now() + syncFailureBackoffMs(status, retryAfterSeconds, this.consecutiveFailures - 1);
      const message = error instanceof Error ? error.message : "Sync failed";
      if (/publication_review_required/i.test(message)) this.setStatus("publication-review-required");
      else if (/projection_pending/i.test(message)) this.setStatus("publishing");
      else if (/merge_review_required/i.test(message)) this.setStatus("merge-required");
      else if (/snapshot_required/i.test(message)) this.setStatus("snapshot-required");
      else if (/device_revoked|authentication|refresh|session_inactive/i.test(message)) this.setStatus("reauthorize");
      else this.setStatus(navigator.onLine ? "error" : "offline");
      if (/projection_pending/i.test(message)) console.info("Tagify sync:", message);
      else console.error("Tagify sync:", message);
    }
  }

  async restoreFromCloud(): Promise<void> {
    const configuration = getDesktopSyncConfiguration();
    if (!configuration || !this.recoveryPreview) throw new Error("No cloud recovery is waiting for confirmation");
    await flushLocalPersistence();
    const queued = (await readOutbox()).filter((intent) => intent.type !== "library.snapshot" || intent.reason !== "migration");
    if (queued.length) throw new Error("Export or reconcile queued offline changes before restoring this replica");
    this.setStatus("restoring");
    window.dispatchEvent(new CustomEvent("tagify:prepareRemoteRestore"));
    try {
      const snapshot = await this.downloadSnapshot(configuration, this.supportsV2 ? PRIVATE_SYNC_PROTOCOL_VERSION : 1);
      if (snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION) assertLibrarySnapshotV2(snapshot); else assertLibrarySnapshotV1(snapshot);
      const appState = snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION ? snapshot.appState : [];
      const data = tagDataFromSnapshot(snapshot);
      const manifest = replicaManifest(configuration, snapshot);
      const saved = await indexedDBStorage.replaceCloudReplica(data, manifest, stateRecordsFromSnapshot(snapshot), appState);
      if (!saved) throw new Error("The cloud snapshot could not be committed atomically");
      await applyDurableAppStateDocuments(appState, { smartPlaylistsAlreadyPersisted: true });
      await markManifestAppStateApplied();
      await this.request(configuration, "/api/v2/sync/ack", { deviceId: configuration.deviceId, cursor: snapshot.headCursor });
      this.lastRecovered = {
        ...this.recoveryPreview,
        smartPlaylists: smartPlaylistsFromAppState(appState).length,
      };
      this.recoveryPreview = null;
      dispatchSyncEvent("remote", crypto.randomUUID(), []);
      this.setSettledStatus();
    } catch (error) {
      this.setStatus("restore-failed");
      throw error;
    }
  }

  private async ensureReplicaReady(configuration: DesktopSyncConfiguration, summary: any): Promise<boolean> {
    const manifest = await readManifest();
    if (manifest?.accountId === configuration.accountId && manifest.libraryId === configuration.libraryId) {
      if (manifest.appStateAppliedAt === null) {
        await applyDurableAppStateDocuments(Object.values(await readAppStateShadow()));
        await markManifestAppStateApplied();
      }
      return true;
    }
    const cloudHasData = Number(summary?.counts?.annotations || 0) > 0 || Number(summary?.counts?.taxonomy || 0) > 0 || Number(summary?.counts?.appState || 0) > 0;
    if (!cloudHasData) return true;
    await flushLocalPersistence();
    const local = await storageService.loadAll();
    const classification = classifyLocalReplica(local, defaultTagData.taxonomy, null);
    const meaningfulOutbox = (await readOutbox()).some((intent) => intent.type !== "library.snapshot" || intent.reason !== "migration");
    if (classification === "fresh-default" && !meaningfulOutbox) {
      this.recoveryPreview = {
        annotations: Number(summary.counts.annotations || 0), taxonomyNodes: Number(summary.counts.taxonomy || 0),
        appStateDocuments: Number(summary.counts.appState || 0), lastBackupAt: summary.lastCommittedAt || null,
        smartPlaylists: null,
        protectedDomains: summary.backupHealth?.protectedDomains || [],
      };
      this.setStatus("recovery-available");
      return false;
    }
    if (classification === "meaningful-unlinked") {
      return this.reconcileInitialLibraries(configuration);
    }
    return true;
  }

  private async reconcileInitialLibraries(configuration: DesktopSyncConfiguration): Promise<boolean> {
    await flushLocalPersistence();
    if (!this.initialMergePreview || !this.initialMergeDeviceSnapshot) await this.prepareInitialMerge(configuration);
    if (canCombineInitialLibrariesWithoutReview(this.initialMergePreview)) {
      await this.commitInitialMerge({});
      return true;
    }
    this.setStatus("merge-required");
    return false;
  }

  private async captureInitialMergeDeviceSnapshot(configuration: DesktopSyncConfiguration): Promise<LibrarySnapshotV2> {
    const core = await buildLocalSnapshot(configuration.libraryId);
    const appState = await buildDurableAppStateDocuments();
    const deviceSnapshot: LibrarySnapshotV2 = { ...core, protocolVersion: PRIVATE_SYNC_PROTOCOL_VERSION, appState };
    assertLibrarySnapshotV2(deviceSnapshot);
    return deviceSnapshot;
  }

  private async prepareInitialMerge(configuration: DesktopSyncConfiguration): Promise<void> {
    await flushLocalPersistence();
    const data = await storageService.loadAll();
    const deviceSnapshot = await this.captureInitialMergeDeviceSnapshot(configuration);
    const communitySnapshot = await this.downloadSnapshot(configuration, PRIVATE_SYNC_PROTOCOL_VERSION) as LibrarySnapshotV2;
    assertLibrarySnapshotV2(communitySnapshot);
    const plan = planInitialLibraryMerge(deviceSnapshot, communitySnapshot);
    this.initialMergeDeviceSnapshot = deviceSnapshot;
    this.initialMergeOperationId = crypto.randomUUID();
    this.initialMergePreview = { ...plan, labels: mergeReviewLabels(data, deviceSnapshot, communitySnapshot, plan), supported: this.capabilities?.initialMergeReviewVersion === 1 };
  }

  private async pull(configuration: DesktopSyncConfiguration): Promise<boolean> {
    const cursor = await readCursor();
    const response = await this.request(configuration, `/api/v2/sync/pull?deviceId=${encodeURIComponent(configuration.deviceId)}&after=${cursor}&limit=200`, undefined, `"sync-cursor-${cursor}"`);
    if (response.unchanged) return false;
    // A remote update can arrive during the UI's short save debounce. Commit
    // those edits first so rehydrating from IndexedDB cannot discard them.
    await flushLocalPersistence();
    if (response.snapshotRequired) {
      // A whole-library upload must go through the library review instead.
      if ((await readOutbox()).some((intent) => intent.type === "library.snapshot")) throw new Error("snapshot_required: export or reconcile queued offline changes before replacing this replica");
      const snapshot = await this.downloadSnapshot(configuration, this.supportsV2 ? PRIVATE_SYNC_PROTOCOL_VERSION : 1);
      if (snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION) assertLibrarySnapshotV2(snapshot); else assertLibrarySnapshotV1(snapshot);
      const appState = snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION ? snapshot.appState : [];
      // Save edits made during the download so they are queued and kept.
      await flushLocalPersistence();
      window.dispatchEvent(new CustomEvent("tagify:prepareRemoteRestore"));
      const localDrafts = await capturePendingAppState();
      const saved = await indexedDBStorage.replaceCloudReplica(tagDataFromSnapshot(snapshot), replicaManifest(configuration, snapshot), [
        ...stateRecordsFromSnapshot(snapshot), ...localDrafts.map((draft) => ({ key: `pending-app-state:${draft.domain}`, ...draft })),
      ], appState, localDrafts, { keepQueuedEdits: true });
      if (!saved) throw new Error("The compacted cloud snapshot could not be committed atomically");
      if ((await readOutbox()).some((intent) => intent.type === "taxonomy.replace")) this.taxonomyRefreshRequested = true;
      await applyDurableAppStateDocuments([
        ...appState.filter((document) => !localDrafts.some((draft) => draft.domain === document.domain)), ...localDrafts,
      ], { smartPlaylistsAlreadyPersisted: true });
      await markManifestAppStateApplied();
      await this.request(configuration, "/api/v2/sync/ack", { deviceId: configuration.deviceId, cursor: snapshot.headCursor });
      dispatchSyncEvent("remote", crypto.randomUUID(), []);
      console.info("Tagify sync: replaced a compacted replica with the canonical snapshot", { headCursor: snapshot.headCursor, annotationCount: snapshot.annotations.length });
      this.resetRecoverySchedule();
      return true;
    }
    const batches = (response.batches || []) as PullBatch[];
    const pendingIntents = await readOutbox();
    const localSnapshotPending = pendingIntents.some((intent) => intent.type === "library.snapshot");
    const locallyChangedEntities = new Set(pendingIntents.flatMap((intent) =>
      intent.type === "entity.replace" || intent.type === "entity.delete" ? [entityKeyV1(intent.entity)] : []));
    const localTaxonomyPending = localSnapshotPending || pendingIntents.some((intent) => intent.type === "taxonomy.replace");
    for (const batch of batches) {
      for (const operation of batch.operations) {
        if (operation.type === "app-state.replace") {
          const localDrafts = await capturePendingAppState();
          const draft = localDrafts.find((document) => document.domain === operation.domain);
          if (draft && !durableStateEquals(draft.value, operation.value)) {
            await putState({ key: `pending-app-state:${draft.domain}`, ...draft });
            const current = await readAppStateDocument(operation.domain);
            await putAppStateDocument({ domain: operation.domain, value: operation.value, revision: (current?.revision || 0) + 1, updatedAt: new Date().toISOString() });
          } else {
            await deleteState(`pending-app-state:${operation.domain}`);
            await applyRemoteOperation(operation);
          }
        } else if (isAnnotationMutation(operation) && (localSnapshotPending || locallyChangedEntities.has(entityKeyV1(operation.entity)))) {
          await applyOperationToShadow(operation);
        } else if (!isAnnotationMutation(operation) && localTaxonomyPending) {
          await applyTaxonomyOperationToShadow(operation);
        } else {
          await applyRemoteOperation(operation);
        }
      }
      await writeCursorAndConflicts(batch.cursor, response.conflicts || []);
      dispatchSyncEvent("remote", batch.batchId, batch.operations);
    }
    if (batches.length || cursor < response.headCursor) {
      const appliedCursor = batches.at(-1)?.cursor ?? cursor;
      await this.request(configuration, "/api/v2/sync/ack", { deviceId: configuration.deviceId, cursor: appliedCursor });
    }
    if (batches.length) this.resetRecoverySchedule();
    return batches.length > 0;
  }

  private async settleLocalAndPublicSync(configuration: DesktopSyncConfiguration): Promise<void> {
    for (let pass = 0; pass < 1_000; pass++) {
      await flushLocalPersistence();
      const firstIntent = (await readOutbox())[0];
      if (firstIntent) {
        if (firstIntent.type !== "library.snapshot") await this.pull(configuration);
        await this.push(configuration);
        await this.pull(configuration);
        await this.refreshDeviceTaxonomyAfterBackup();
        continue;
      }

      await this.pull(configuration);
      await this.pushDurableAppState(configuration);
      await this.syncLocalFileBackup(configuration);
      await flushLocalPersistence();
      if (!(await readOutbox()).length) return;
    }
    throw new Error("snapshot_required: local changes continued arriving before Sync Now could settle");
  }

  private async push(configuration: DesktopSyncConfiguration): Promise<void> {
    const intents = await readOutbox();
    if (!intents.length) return;
    const plan = coalesceOutboxIntents(intents);
    const snapshotIntent = plan.intents[0]?.type === "library.snapshot" ? plan.intents[0] : null;
    if (snapshotIntent) {
      if (snapshotIntent.reason === "reset") throw new Error("intentional_cloud_reset_requires_confirmation");
      await this.bootstrap(configuration, snapshotIntent.id, snapshotIntent.batchId, snapshotIntent.createdAt);
      await deleteOutbox([snapshotIntent.id]);
      return;
    }
    const operations: SyncMutationV1[] = [];
    const selectedIntents: LocalSyncIntent[] = [];
    let partialIntent: LocalSyncIntent | null = null;
    for (const intent of plan.intents) {
      const next = withoutUnsupportedOperations(await materializeIntent(intent));
      if (operations.length + next.length > 500) {
        if (!operations.length) {
          operations.push(...next.slice(0, 500));
          partialIntent = intent;
        }
        break;
      }
      operations.push(...next);
      selectedIntents.push(intent);
    }
    const deleteIds = [...plan.supersededIds, ...selectedIntents.map((intent) => intent.id)];
    if (!operations.length) { await deleteOutbox(deleteIds); return; }
    const batchId = partialIntent
      ? await stableUuid(partialIntent.batchId, `part:${operations[0].operationId}`)
      : selectedIntents[0].batchId;
    const batch: SyncBatchV1 = {
      protocolVersion: 1,
      batchId,
      deviceId: configuration.deviceId,
      baseCursor: await readCursor(),
      operations,
    };
    const result = await this.request(configuration, "/api/v2/sync/push", batch);
    this.updateProjectionStatus(result.projection);
    if (partialIntent && (result.conflictIds || []).length && !(result.changes || []).length) {
      await this.prepareInitialMerge(configuration);
      throw new Error("merge_review_required");
    }
    const accepted = (result.changes || []) as SyncMutationV1[];
    await deleteOutbox(deleteIds);
    // A rejected taxonomy change stays on this device and is sent again with
    // its next edit, so only refresh from the cloud copy after a clean backup.
    if (selectedIntents.some((intent) => intent.type === "taxonomy.replace") && !(result.conflictIds || []).length) this.taxonomyRefreshRequested = true;
    // Do not advance or mutate the canonical shadow from a push response. Another
    // replica can commit between our pre-push pull and this batch. The pull that
    // immediately follows must replay every intervening server cursor, including
    // this device's own batch, in canonical order.
    dispatchSyncEvent("local", batchId, accepted);
  }

  /**
   * While this device had an unsent taxonomy edit, incoming taxonomy changes
   * were recorded only in the sync shadow. Once the edit is backed up, show
   * the combined result on this device.
   */
  private async refreshDeviceTaxonomyAfterBackup(): Promise<void> {
    if (!this.taxonomyRefreshRequested) return;
    await flushLocalPersistence();
    if ((await readOutbox()).some((intent) => intent.type === "taxonomy.replace" || intent.type === "library.snapshot")) return;
    this.taxonomyRefreshRequested = false;
    const current = await storageService.getTaxonomy();
    const next = rebuildDeviceTaxonomy(taxonomyFromShadowRecord(await readTaxonomyShadow()), current);
    if (stableTaxonomyJson(next) === stableTaxonomyJson(current)) return;
    if (!(await storageService.saveTaxonomy(next, { captureSync: false }))) {
      throw new Error("Tagify could not show taxonomy changes from your other devices");
    }
    dispatchSyncEvent("remote", crypto.randomUUID(), []);
  }

  /**
   * Local files sit outside the Spotify-ID protocol and use Community's
   * separate owner-only backup. A failure here is retried on the next sync and
   * never stops the rest of the library from backing up.
   */
  private async syncLocalFileBackup(configuration: DesktopSyncConfiguration): Promise<void> {
    const capability = (this.capabilities as { localFileBackup?: { enabled?: boolean; maxRequestBytes?: number } } | null)?.localFileBackup;
    if (!capability?.enabled) return;
    try {
      await flushLocalPersistence();
      const shadow = await getState<LocalFileBackupShadow>(LOCAL_FILE_BACKUP_SHADOW_KEY);
      let known = shadow?.entries ?? {};
      let revision = shadow?.revision ?? -1;
      const remote = await this.readLocalFileBackup(configuration, revision);
      if (remote) {
        const plan = planIncomingLocalFiles(remote.entries, localFileTracks((await storageService.loadAll()).tracks), known);
        for (const uri of plan.remove) {
          if (!(await storageService.deleteTrack(uri, { captureSync: false }))) throw new Error("A local file from Community could not be removed on this device");
        }
        for (const [uri, track] of Object.entries(plan.save)) {
          if (!(await storageService.saveTrack(uri, track, { captureSync: false }))) throw new Error("A local file from Community could not be saved on this device");
        }
        if (plan.remove.length || Object.keys(plan.save).length) dispatchSyncEvent("remote", crypto.randomUUID(), []);
        known = remote.entries;
        revision = remote.revision;
      }
      const outgoing = planOutgoingLocalFiles(localFileEntries((await storageService.loadAll()).tracks), known, Date.now());
      if (Object.keys(outgoing).length) {
        let expected = revision;
        for (const chunk of chunkLocalFileEntries(outgoing, Math.max(10_000, (capability.maxRequestBytes ?? 1_000_000) - 100_000))) {
          const result = await this.sendLocalFileBackup(configuration, chunk);
          if (result.changed) expected += 1;
          revision = result.revision;
        }
        known = { ...known, ...outgoing };
        // Another device wrote meanwhile: read the whole backup next time.
        if (revision !== expected) revision = -1;
      }
      await putState({ key: LOCAL_FILE_BACKUP_SHADOW_KEY, revision, entries: known } as LocalFileBackupShadow);
    } catch (error) {
      console.warn("Tagify sync: local-file backup will retry", error instanceof Error ? error.message : error);
    }
  }

  private async readLocalFileBackup(configuration: DesktopSyncConfiguration, knownRevision: number): Promise<{ revision: number; entries: LocalFileEntries } | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const entries: LocalFileEntries = {};
      let after: string | null = null;
      let revision: number | null = null;
      let restarted = false;
      do {
        const query: URLSearchParams = new URLSearchParams({ deviceId: configuration.deviceId, ...(after ? { after } : {}) });
        const response: Response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/local-files?${query}`, {
          headers: { ...syncClientHeaders(configuration.accessToken), ...(after === null && knownRevision >= 0 ? { "if-none-match": `"local-files-${knownRevision}"` } : {}) },
        });
        if (response.status === 304) return null;
        const payload: { revision?: unknown; entries?: LocalFileEntries; nextAfter?: unknown; error?: { code?: string; message?: string } } = await response.json().catch(() => ({}));
        if (!response.ok) throw new SyncHttpError(`${payload.error?.code || "sync_error"}: ${payload.error?.message || response.statusText}`, response.status, positiveNumber(response.headers.get("retry-after")));
        if (revision !== null && payload.revision !== revision) { restarted = true; break; }
        revision = Number(payload.revision);
        Object.assign(entries, payload.entries || {});
        after = typeof payload.nextAfter === "string" ? payload.nextAfter : null;
      } while (after);
      if (!restarted && revision !== null) return { revision, entries };
    }
    throw new Error("The local-file backup kept changing while it was read");
  }

  private async sendLocalFileBackup(configuration: DesktopSyncConfiguration, entries: LocalFileEntries): Promise<{ revision: number; changed: boolean }> {
    const response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/local-files`, {
      method: "PUT",
      headers: { ...syncClientHeaders(configuration.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: configuration.deviceId, entries }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new SyncHttpError(`${payload.error?.code || "sync_error"}: ${payload.error?.message || response.statusText}`, response.status, positiveNumber(response.headers.get("retry-after")));
    return { revision: Number(payload.revision), changed: payload.changed === true };
  }

  private async pushDurableAppState(configuration: DesktopSyncConfiguration): Promise<void> {
    if (!this.supportsV2) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const shadow = await readAppStateShadow();
      const savedSmartPlaylists = shadow["smart-playlists"];
      if (Array.isArray(savedSmartPlaylists?.value) &&
          savedSmartPlaylists.value.length > 0 &&
          !wereSmartPlaylistsExplicitlyCleared() &&
          (await indexedDBStorage.getAllSmartPlaylists()).length === 0) {
        await applyDurableAppStateDocuments([savedSmartPlaylists]);
      }
      const documents = await buildDurableAppStateDocuments(Object.fromEntries(Object.entries(shadow).map(([domain, document]) => [domain, document.revision])));
      for (const document of documents) {
        const pending = await getState<DurableAppStateDocumentV2>(`pending-app-state:${document.domain}`);
        if (pending) document.revision = pending.revision;
      }
      const changed = documents.filter((document) => !durableStateEquals(shadow[document.domain]?.value, document.value));
      if (!changed.length) {
        if (Array.isArray(savedSmartPlaylists?.value) && savedSmartPlaylists.value.length === 0) clearExplicitSmartPlaylistClear();
        return;
      }
      const conflictedDomains: DurableAppStateDomain[] = [];
      for (const group of appStatePushGroups(changed.filter((document) => this.fitsAppStateDocumentLimit(document)))) {
        const seed = crypto.randomUUID();
        const operations: AppStateReplaceMutationV2[] = await Promise.all(group.map(async (document) => ({
          type: "app-state.replace" as const,
          operationId: await stableUuid(seed, document.domain),
          origin: "desktop" as const,
          domain: document.domain,
          value: document.value,
          expectedRevision: document.revision,
        })));
        const result = await this.request(configuration, "/api/v2/sync/push", {
          protocolVersion: PRIVATE_SYNC_PROTOCOL_VERSION,
          batchId: seed,
          deviceId: configuration.deviceId,
          baseCursor: await readCursor(),
          operations,
        });
        this.updateProjectionStatus(result.projection);
        if ((result.conflictIds || []).length) {
          conflictedDomains.push(...group.map((document) => document.domain));
          continue;
        }
        for (const document of group) await deleteState(`pending-app-state:${document.domain}`);
        if (group.some((document) => document.domain === "smart-playlists")) clearExplicitSmartPlaylistClear();
      }
      if (!conflictedDomains.length) return;
      if (attempt === 1) throw new Error("Durable settings changed again while Tagify was reconciling them");
      for (const domain of conflictedDomains) await deleteState(`pending-app-state:${domain}`);
      Spicetify.showNotification("Your saved settings differ between devices. Open Community’s Library differences to choose which to keep.", false, 10000);
      await this.reconcileDurableAppState(configuration, conflictedDomains);
    }
  }

  private fitsAppStateDocumentLimit(document: DurableAppStateDocumentV2): boolean {
    const bytes = durableStateStoredByteLength(document.value);
    if (bytes <= MAX_APP_STATE_DOCUMENT_BYTES) return true;
    if (!this.oversizedAppStateDomains.has(document.domain)) {
      this.oversizedAppStateDomains.add(document.domain);
      console.warn("Tagify sync: a saved-settings document is too large for Community and stays on this device", { domain: document.domain, bytes });
    }
    return false;
  }

  private async reconcileDurableAppState(configuration: DesktopSyncConfiguration, domains: DurableAppStateDomain[]): Promise<void> {
    const response = await this.request(configuration, `/api/v2/sync/snapshot?deviceId=${encodeURIComponent(configuration.deviceId)}&protocolVersion=${PRIVATE_SYNC_PROTOCOL_VERSION}`);
    const snapshot = response.snapshot as LibrarySnapshotV2;
    assertLibrarySnapshotV2(snapshot);
    const plan = planDurableAppStateConflictReconciliation(domains, snapshot.appState);
    for (const document of plan.canonicalDocuments) await putAppStateDocument(document);
    for (const domain of plan.missingDomains) await deleteAppStateDocument(domain);
    if (plan.canonicalDocuments.length) await applyDurableAppStateDocuments(plan.canonicalDocuments);
  }

  private async bootstrap(configuration: DesktopSyncConfiguration, intentId: string, batchId: string, queuedAt: number): Promise<void> {
    // A retry of an unchanged library produces the same checksum and resumes
    // its upload; a changed library gets its own upload instead of being
    // rejected as a different payload under the same key.
    const snapshot = await buildLocalSnapshot(configuration.libraryId, undefined, new Date(queuedAt));
    const summary = (await this.request(configuration, "/api/v2/library")).library;
    const cloudHasData = Number(summary?.counts?.annotations || 0) > 0 || Number(summary?.counts?.taxonomy || 0) > 0;
    const localHasData = snapshot.annotations.length > 0 || snapshot.taxonomy.length > 0;
    if (cloudHasData && !localHasData) {
      throw new Error("snapshot_required: confirm Restore from cloud before replacing this replica");
    }
    if (cloudHasData && localHasData) {
      if (await this.reconcileInitialLibraries(configuration)) return;
      throw new Error("merge_review_required");
    }
    const chunks = snapshotChunks(snapshot);
    const checksum = await sha256Hex(JSON.stringify(snapshot));
    const start = await this.request(configuration, "/api/v2/sync/bootstrap", {
      deviceId: configuration.deviceId, idempotencyKey: await stableUuid(batchId, checksum), mode: "initialize",
      sourceStorageSchemaVersion: snapshot.sourceStorageSchemaVersion, checksum, expectedChunks: chunks.length,
    });
    const uploadId = start.upload.id as string;
    for (let index = Number(start.upload.receivedChunks || 0); index < chunks.length; index++) {
      const payload = chunks[index];
      const response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/bootstrap/${uploadId}/chunks`, {
        method: "PUT", headers: { ...syncClientHeaders(configuration.accessToken), "content-type": "application/json" },
        body: JSON.stringify({ deviceId: configuration.deviceId, index, checksum: await sha256Hex(JSON.stringify(payload)), payload }),
      });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error?.message || "Snapshot upload failed"); }
    }
    const result = await this.request(configuration, `/api/v2/sync/bootstrap/${uploadId}/finalize`, { deviceId: configuration.deviceId, checksum });
    const appliedCursor = result.bootstrap.headCursor || 0;
    const canonical: LibrarySnapshotV1 | LibrarySnapshotV2 = { ...snapshot, headCursor: appliedCursor };
    await seedShadowFromSnapshot(canonical, appliedCursor);
    await writeManifest(replicaManifest(configuration, canonical));
    await this.request(configuration, "/api/v2/sync/ack", { deviceId: configuration.deviceId, cursor: appliedCursor });
    this.backupHealthRefreshRequested = true;
    this.initialMergePreview = null;
    this.initialMergeDeviceSnapshot = null;
    this.initialMergeOperationId = null;
    console.info("Tagify sync: private library bootstrap complete", { mode: "initialize", annotationCount: canonical.annotations.length, taxonomyNodeCount: canonical.taxonomy.length, operationId: intentId });
  }

  private async request(configuration: DesktopSyncConfiguration, path: string, body?: unknown, ifNoneMatch?: string): Promise<any> {
    const response = await fetch(`${configuration.apiBaseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...syncClientHeaders(configuration.accessToken), ...(body === undefined ? {} : { "content-type": "application/json" }), ...(ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 304) return { unchanged: true };
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new SyncHttpError(
      `${payload.error?.code || "sync_error"}: ${payload.error?.message || response.statusText}`,
      response.status,
      positiveNumber(response.headers.get("retry-after")),
    );
    return payload;
  }

  private async requestCompressed(configuration: DesktopSyncConfiguration, path: string, body: unknown): Promise<any> {
    const compressed = await gzipJsonBody(body);
    if (compressed.byteLength > 4_000_000) throw new Error("This library is too large to combine in one review. Download a backup and contact Tagify support.");
    const response = await fetch(`${configuration.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        ...syncClientHeaders(configuration.accessToken),
        "content-type": "application/octet-stream",
        "x-tagify-content-encoding": "gzip",
      },
      body: compressed,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new SyncHttpError(
      `${payload.error?.code || "sync_error"}: ${payload.error?.message || response.statusText}`,
      response.status,
      positiveNumber(response.headers.get("retry-after")),
    );
    return payload;
  }

  private async loadCapabilities(configuration: DesktopSyncConfiguration): Promise<SyncCapabilitiesV1 | SyncCapabilitiesV2> {
    const cacheKey = capabilitiesCacheKey(configuration.apiBaseUrl);
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as { cachedAt?: unknown; value?: unknown } | null;
      if (cached && typeof cached.cachedAt === "number" && Date.now() - cached.cachedAt < CAPABILITIES_CACHE_MS && isSyncCapabilities(cached.value)) return cached.value;
    } catch { /* An unavailable cache must never block sync. */ }
    const response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/capabilities`, { headers: syncClientHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new SyncHttpError(
      `${payload.error?.code || "sync_error"}: ${payload.error?.message || response.statusText}`,
      response.status,
      positiveNumber(response.headers.get("retry-after")),
    );
    if (!isSyncCapabilities(payload)) throw new Error("invalid_capabilities: Community returned an invalid sync capability document");
    try { localStorage.setItem(cacheKey, JSON.stringify({ cachedAt: Date.now(), value: payload })); } catch { /* Best-effort deployment metadata cache. */ }
    return payload;
  }

  private async downloadSnapshot(configuration: DesktopSyncConfiguration, protocolVersion: number): Promise<LibrarySnapshotV1 | LibrarySnapshotV2> {
    const path = `/api/v2/sync/snapshot?deviceId=${encodeURIComponent(configuration.deviceId)}&protocolVersion=${protocolVersion}&delivery=direct-gzip-v1`;
    const descriptor = await this.request(configuration, path);
    if (descriptor.snapshot) return descriptor.snapshot as LibrarySnapshotV1 | LibrarySnapshotV2;
    const download = descriptor.download as { url?: unknown; encoding?: unknown; checksum?: unknown } | undefined;
    if (!download || typeof download.url !== "string" || download.encoding !== "gzip" || typeof download.checksum !== "string") {
      throw new Error("invalid_snapshot_response: Community returned an invalid snapshot download");
    }
    const response = await fetch(download.url, { cache: "no-store" });
    if (!response.ok || !response.body) throw new Error("snapshot_download_failed: The cloud snapshot could not be downloaded");
    if (typeof DecompressionStream === "undefined") throw new Error("snapshot_download_failed: This Spotify version cannot open compressed cloud backups");
    const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(decompressed).arrayBuffer());
    const checksum = await sha256HexBytes(bytes);
    if (checksum !== download.checksum) throw new Error("snapshot_checksum_mismatch: The cloud snapshot failed its integrity check");
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as LibrarySnapshotV1 | LibrarySnapshotV2;
    } catch {
      throw new Error("invalid_snapshot_response: The cloud snapshot was not valid JSON");
    }
  }

  private async refreshIfNeeded(configuration: DesktopSyncConfiguration): Promise<DesktopSyncConfiguration> {
    if (configuration.expiresAt * 1000 - Date.now() > 60_000) return configuration;
    const response = await fetch(`${configuration.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: configuration.supabasePublishableKey },
      body: JSON.stringify({ refresh_token: configuration.refreshToken }),
    });
    const session = await response.json().catch(() => ({}));
    if (!response.ok || !session.access_token) {
      if (response.status === 400 || response.status === 401) throw new Error("session_inactive");
      throw new Error("refresh_failed");
    }
    const next = { ...configuration, accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at };
    setDesktopSyncConfiguration(next);
    await this.realtime?.realtime.setAuth(next.accessToken);
    void enrollDesktopRecovery(next);
    return next;
  }

  private async connectRealtime(configuration: DesktopSyncConfiguration) {
    if (!configuration.supabaseUrl || !configuration.supabasePublishableKey || this.channel || this.realtimeConnecting) return;
    this.realtimeConnecting = true;
    try {
      this.realtime ??= createClient(configuration.supabaseUrl, configuration.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false, storageKey: `tagify-desktop-realtime:${configuration.libraryId}` } });
      const realtime = this.realtime;
      await realtime.realtime.setAuth(configuration.accessToken);
      if (!this.started || this.realtime !== realtime) return;
      const channel = realtime.channel(`tagify-library:${configuration.libraryId}`, { config: { private: true } });
      this.channel = channel;
      channel
        .on("broadcast", { event: "head_cursor" }, async ({ payload }) => {
          if (payload?.libraryId !== configuration.libraryId || !Number.isSafeInteger(payload?.headCursor)) return;
          if (Number(payload.headCursor) <= await readCursor()) return;
          this.resetRecoverySchedule();
          void this.syncNow(true);
        })
        .on("broadcast", { event: "projection_cursor" }, ({ payload }) => {
          if (payload?.libraryId !== configuration.libraryId || !Number.isSafeInteger(payload?.projectionCursor)) return;
          if (Number(payload.projectionCursor) < this.projectionTargetCursor) return;
          this.projectionPending = false;
          this.projectionReviewRequired = false;
          this.projectionTargetCursor = Number(payload.projectionCursor);
          if (this.status === "publishing") this.setStatus("idle");
        })
        .subscribe((status) => {
          // Removing an old channel also emits CLOSED. It must not schedule a new retry.
          if (this.channel !== channel) return;
          if (status === "SUBSCRIBED") this.realtimeSubscribedAt = Date.now();
          if (this.started && (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")) {
            if (this.realtimeSubscribedAt && Date.now() - this.realtimeSubscribedAt >= 30_000) this.reconnectAttempts = 0;
            this.realtimeSubscribedAt = 0;
            console.warn("Tagify sync: Realtime hint channel unavailable; recovery pulls remain active");
            this.scheduleRealtimeReconnect(configuration);
          }
        });
    } finally { this.realtimeConnecting = false; }
  }

  private setStatus(status: SyncStatus) {
    // Waiting for a Community choice or retry must never disable local saves.
    // Only the atomic replacement itself needs a short persistence barrier.
    setLocalPersistencePaused(status === "restoring");
    if (this.status === status) return;
    this.status = status;
    this.dispatchEvent(new CustomEvent("status", { detail: status }));
    window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status } }));
  }

  private scheduleSafetySync() {
    if (!this.started || document.visibilityState !== "visible") return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (document.visibilityState === "visible" && navigator.onLine) {
        this.recoveryPollStage = Math.min(this.recoveryPollStage + 1, RECOVERY_POLL_INTERVALS_MS.length - 1);
        void this.syncNow(true);
      }
      this.scheduleSafetySync();
    }, safetySyncDelayMs(this.recoveryPollStage));
  }

  private resetRecoverySchedule() { this.recoveryPollStage = 0; this.scheduleSafetySync(); }
  private handleOnline = () => { this.resetRecoverySchedule(); void this.syncNow(true); };
  private handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    this.resetRecoverySchedule();
    void this.syncNow(true);
  };
  private handleOutboxChanged = () => {
    if (this.initialMergePreview) {
      this.initialMergePreview = null;
      this.initialMergeDeviceSnapshot = null;
      this.initialMergeOperationId = null;
    }
    this.resetRecoverySchedule();
    void this.syncNow(true);
  };

  private scheduleRealtimeReconnect(configuration: DesktopSyncConfiguration) {
    if (!this.started || this.reconnectTimer) return;
    const delay = Math.round(Math.min(5 * 60_000, 1_000 * 2 ** Math.min(this.reconnectAttempts++, 8)) * (1 + Math.random() * 0.25));
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const previous = this.channel;
      this.channel = null;
      if (previous && this.realtime) await this.realtime.removeChannel(previous);
      if (!this.started || !navigator.onLine) return;
      try {
        const current = getDesktopSyncConfiguration() || configuration;
        const active = await this.refreshIfNeeded(current);
        await this.connectRealtime(active);
      } catch {
        this.scheduleRealtimeReconnect(getDesktopSyncConfiguration() || configuration);
      }
    }, delay);
  }

  private updateProjectionStatus(projection: unknown) {
    if (!projection || typeof projection !== "object") return;
    const value = projection as Record<string, unknown>;
    if (Number.isSafeInteger(value.targetCursor)) this.projectionTargetCursor = Math.max(this.projectionTargetCursor, Number(value.targetCursor));
    this.projectionReviewRequired = value.errorCode === "publication_review_required";
    this.projectionPending = value.complete !== true && !this.projectionReviewRequired;
    if (this.projectionReviewRequired) this.setStatus("publication-review-required");
    else if (this.projectionPending) this.setStatus("publishing");
  }

  private setSettledStatus() {
    this.setStatus(this.projectionReviewRequired ? "publication-review-required" : this.projectionPending ? "publishing" : "idle");
  }

  private installPublicApi() {
    window.TagifySync = {
      beginPairing: (apiBaseUrl, name, platform) => syncPairingService.begin(apiBaseUrl, name, platform),
      pollPairing: () => syncPairingService.poll(),
      completePairing: (approval, options) => syncPairingService.complete(approval, options),
      cancelPairing: () => syncPairingService.cancelPending(),
      syncNow: () => this.userSyncNow(),
      activateCurrentAccount: () => this.activateCurrentAccount(),
      getStatus: () => this.getStatus(),
      getInitialMergePreview: () => this.getInitialMergePreview(),
      getRecoveryPreview: () => this.getRecoveryPreview(),
      getLastRecovered: () => this.getLastRecovered(),
      getBackupHealth: () => this.getBackupHealth(),
      restoreFromCloud: () => this.restoreFromCloud(),
      commitInitialMerge: (resolutions) => this.commitInitialMerge(resolutions),
      downloadInitialMergeBackup: () => this.downloadInitialMergeBackup(),
      armCloudReplacement: () => this.armCloudReplacement(),
      replaceCloudWithCurrentLocalState: () => this.replaceCloudWithCurrentLocalState(),
      communityRequest: (path, options) => this.communityRequest(path, options),
      unlinkLocal: () => this.unlinkLocal(),
    };
  }
}

/**
 * Community rejects a whole batch when one operation is invalid, and the
 * runtime retries that batch indefinitely. Keep a value Community cannot hold
 * on this device only, so every other change still backs up.
 */
// Community accepts request bodies up to 1,000,000 bytes.
const APP_STATE_REQUEST_BUDGET_BYTES = 900_000;

/** Splits changed app-state documents into requests that stay under the push body limit. */
export function appStatePushGroups(documents: DurableAppStateDocumentV2[]): DurableAppStateDocumentV2[][] {
  const groups: DurableAppStateDocumentV2[][] = [];
  let current: DurableAppStateDocumentV2[] = [];
  let currentBytes = 0;
  for (const document of documents) {
    const bytes = durableStateStoredByteLength(document.value) + 512;
    if (current.length && currentBytes + bytes > APP_STATE_REQUEST_BUDGET_BYTES) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(document);
    currentBytes += bytes;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function withoutUnsupportedOperations(operations: SyncMutationV1[]): SyncMutationV1[] {
  return operations.filter((operation) => {
    try {
      assertSyncMutationV1(operation);
      return true;
    } catch (error) {
      console.warn("Tagify sync: kept an unsupported change on this device only", {
        type: operation.type,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  });
}

async function materializeIntent(intent: LocalSyncIntent): Promise<SyncMutationV1[]> {
  if (intent.type === "library.snapshot") return [];
  if (intent.type === "taxonomy.replace") return materializeTaxonomy(intent);
  const shadow = await readShadow(intent.entity);
  if (intent.type === "entity.delete") return [{
    type: "annotation.delete", operationId: await stableUuid(intent.id, "delete"), origin: "desktop",
    entity: intent.entity, expectedEntityRevision: shadow.entityRevision,
  }];
  return materializeEntity(intent, shadow);
}

async function materializeTaxonomy(intent: TaxonomyReplaceIntent): Promise<SyncMutationV1[]> {
  const desired = flattenTaxonomy(intent.taxonomy);
  const base = intent.base ? flattenTaxonomy(intent.base) : null;
  const shadow = await readTaxonomyShadow();
  const operations: SyncMutationV1[] = [];
  const parentRevisions = { ...shadow.parentRevisions };
  const allNodeIds = new Set([...Object.keys(shadow.nodes), ...Object.keys(desired.nodes)]);
  // Without a base (intents from older versions) the whole taxonomy is desired.
  const editedHere = <T>(baseItems: Record<string, T> | undefined, desiredItems: Record<string, T>, id: string, same: (left: T, right: T) => boolean) => {
    if (!baseItems) return true;
    const before = baseItems[id]; const after = desiredItems[id];
    return !before || !after ? before !== after : !same(before, after);
  };
  const sameNode = (left: TaxonomyNodeSnapshotV1, right: TaxonomyNodeSnapshotV1) => left.name === right.name && left.parentId === right.parentId && left.accentId === right.accentId && left.position === right.position && left.kind === right.kind;
  const sameColor = (left: CustomColorSnapshotV1, right: CustomColorSnapshotV1) => left.name === right.name && left.color === right.color;
  const sameCollection = (left: CollectionSnapshotV1, right: CollectionSnapshotV1) => left.name === right.name && left.position === right.position && JSON.stringify(left.colorIds) === JSON.stringify(right.colorIds);
  for (const id of [...allNodeIds].sort()) {
    if (!editedHere(base?.nodes, desired.nodes, id, sameNode)) continue;
    const before = shadow.nodes[id]; const after = desired.nodes[id];
    if (after && (!before || before.name !== after.name || before.parentId !== after.parentId || before.accentId !== after.accentId || before.position !== after.position || before.deleted)) {
      const parentKey = after.parentId || "__root__"; const expectedParent = parentRevisions[parentKey] || 0;
      operations.push({ type: "taxonomy.upsert", operationId: await stableUuid(intent.id, `node:${id}`), origin: "desktop", node: after, expectedNodeRevision: before?.nodeRevision || 0, expectedParentListRevision: expectedParent });
      parentRevisions[parentKey] = expectedParent + 1;
    } else if (before && !after && !before.deleted) {
      const parentKey = before.parentId || "__root__"; const expectedParent = parentRevisions[parentKey] || 0;
      operations.push({ type: "taxonomy.delete", operationId: await stableUuid(intent.id, `delete:${id}`), origin: "desktop", node: before, expectedNodeRevision: before.nodeRevision, expectedParentListRevision: expectedParent });
      parentRevisions[parentKey] = expectedParent + 1;
    }
  }
  for (const [id, color] of Object.entries(desired.colors)) {
    if (!editedHere(base?.colors, desired.colors, id, sameColor)) continue;
    const before = shadow.colors[id];
    if (!before || before.name !== color.name || before.color !== color.color || before.deleted) operations.push({ type: "color.upsert", operationId: await stableUuid(intent.id, `color:${id}`), origin: "desktop", color, expectedRevision: before?.revision || 0 });
  }
  for (const [id, color] of Object.entries(shadow.colors)) if (!desired.colors[id] && !color.deleted && editedHere(base?.colors, desired.colors, id, sameColor)) operations.push({ type: "color.delete", operationId: await stableUuid(intent.id, `color-delete:${id}`), origin: "desktop", color, expectedRevision: color.revision });
  for (const [id, collection] of Object.entries(desired.collections)) {
    if (!editedHere(base?.collections, desired.collections, id, sameCollection)) continue;
    const before = shadow.collections[id];
    if (!before || before.name !== collection.name || before.position !== collection.position || JSON.stringify(before.colorIds) !== JSON.stringify(collection.colorIds) || before.deleted) operations.push({ type: "collection.upsert", operationId: await stableUuid(intent.id, `collection:${id}`), origin: "desktop", collection, expectedRevision: before?.revision || 0 });
  }
  for (const [id, collection] of Object.entries(shadow.collections)) if (!desired.collections[id] && !collection.deleted && editedHere(base?.collections, desired.collections, id, sameCollection)) operations.push({ type: "collection.delete", operationId: await stableUuid(intent.id, `collection-delete:${id}`), origin: "desktop", collection, expectedRevision: collection.revision });
  return operations;
}

export async function materializeEntity(intent: EntityReplaceIntent, shadow: AnnotationSnapshotV1): Promise<SyncMutationV1[]> {
  const operations: SyncMutationV1[] = [];
  const fields: AnnotationPatchMutationV1["fields"] = {};
  const expectedRevisions: AnnotationPatchMutationV1["expectedRevisions"] = {};
  const desired = intent.desired;
  // Intents queued by older versions may hold values Community cannot accept.
  const pairs = [["rating", normalizeSyncRating(desired.rating)], ["energy", normalizeSyncEnergy(desired.energy)], ["bpm", normalizeSyncBpm(desired.bpm)], ["key", normalizeSyncKey(desired.key)]] as const;
  for (const [field, value] of pairs) {
    if (shadow.fields[field].value !== value) { fields[field] = value; expectedRevisions[field] = shadow.fields[field].revision; }
  }
  // Older Community servers ignore these fields.
  const timestamps = { ...(desired.createdAt ? { createdAt: desired.createdAt } : {}), ...(desired.modifiedAt ? { modifiedAt: desired.modifiedAt } : {}) };
  if (Object.keys(fields).length) operations.push({ type: "annotation.patch", operationId: await stableUuid(intent.id, "fields"), origin: "desktop", entity: intent.entity, fields, expectedRevisions, ...timestamps });
  const desiredTags = new Set(desired.tagIds.filter(isSyncSafeId));
  const knownTags = new Set([...Object.keys(shadow.tagMemberships), ...desiredTags]);
  for (const tagId of [...knownTags].sort()) {
    const known = shadow.tagMemberships[tagId] || { value: false, revision: 0 };
    const present = desiredTags.has(tagId);
    if (known.value !== present) operations.push({
      type: "annotation.tag-membership", operationId: await stableUuid(intent.id, `tag:${tagId}`), origin: "desktop",
      entity: intent.entity, tagId, present, expectedRevision: known.revision, ...timestamps,
    } as TagMembershipMutationV1);
  }
  return operations;
}

async function applyRemoteOperation(operation: SyncMutationV2): Promise<void> {
  if (operation.type === "app-state.replace") {
    const current = await readAppStateDocument(operation.domain);
    const document: DurableAppStateDocumentV2 = {
      domain: operation.domain, value: operation.value,
      revision: (current?.revision || 0) + 1, updatedAt: new Date().toISOString(),
    };
    await putAppStateDocument(document);
    await applyDurableAppStateDocuments([document]);
    return;
  }
  if (!isAnnotationMutation(operation)) {
    await applyTaxonomyOperationToShadow(operation);
    const shadow = await readTaxonomyShadow();
    const saved = await storageService.saveTaxonomy(rebuildDeviceTaxonomy(taxonomyFromShadowRecord(shadow), await storageService.getTaxonomy()), { captureSync: false });
    if (!saved) throw new Error("A remote taxonomy batch could not be written to the local replica");
    return;
  }
  const uri = `spotify:${operation.entity.kind}:${operation.entity.providerId}`;
  const storageKind = operation.entity.kind === "track" ? "track" : operation.entity.kind === "artist" ? "artist" : "playlist";
  const current = storageKind === "track" ? await storageService.getTrack(uri) : storageKind === "artist" ? await storageService.getArtist(uri) : await storageService.getPlaylist(uri);
  if (operation.type === "annotation.delete") {
    const deleted = storageKind === "track" ? await storageService.deleteTrack(uri, { captureSync: false })
      : storageKind === "artist" ? await storageService.deleteArtist(uri, { captureSync: false })
        : await storageService.deletePlaylist(uri, { captureSync: false });
    if (!deleted) throw new Error("A remote annotation deletion could not be written to the local replica");
  } else {
    const base = current || { rating: 0, energy: 0, tagIds: [], ...(storageKind === "track" ? { bpm: null, camelotKey: null } : {}) };
    if (operation.type === "annotation.patch") {
      if ("rating" in operation.fields) base.rating = Number(operation.fields.rating ?? 0);
      if ("energy" in operation.fields) base.energy = Number(operation.fields.energy ?? 0);
      if (storageKind === "track" && "bpm" in operation.fields) (base as TrackData).bpm = operation.fields.bpm as number | null;
      if (storageKind === "track" && "key" in operation.fields) (base as TrackData).camelotKey = operation.fields.key as string | null;
    } else if (operation.type === "annotation.tag-membership") {
      const tags = new Set(base.tagIds); if (operation.present) tags.add(operation.tagId); else tags.delete(operation.tagId); base.tagIds = [...tags];
    }
    // Use the other device's edit time when it sent one.
    if (shouldStampAnnotationDateModified(operation)) base.dateModified = deviceTimestamp((operation as { modifiedAt?: unknown }).modifiedAt) ?? Date.now();
    if (!current) {
      const dateCreated = deviceTimestamp((operation as { createdAt?: unknown }).createdAt);
      if (dateCreated !== undefined) base.dateCreated = dateCreated;
    }
    const saved = storageKind === "track" ? await storageService.saveTrack(uri, base as TrackData, { captureSync: false })
      : storageKind === "artist" ? await storageService.saveArtist(uri, base as ArtistData, { captureSync: false })
        : await storageService.savePlaylist(uri, base as PlaylistData, { captureSync: false });
    if (!saved) throw new Error("A remote annotation could not be written to the local replica");
  }
  await applyOperationToShadow(operation);
}

async function applyOperationToShadow(operation: SyncMutationV1): Promise<void> {
  if (!isAnnotationMutation(operation)) { await applyTaxonomyOperationToShadow(operation); return; }
  const shadow = await readShadow(operation.entity);
  if (operation.type === "annotation.patch") {
    for (const field of Object.keys(operation.fields) as Array<keyof typeof shadow.fields>) {
      shadow.fields[field] = { value: operation.fields[field] as never, revision: shadow.fields[field].revision + 1 };
    }
    shadow.entityRevision++;
    shadow.deleted = false;
  } else if (operation.type === "annotation.tag-membership") {
    const current = shadow.tagMemberships[operation.tagId] || { value: false, revision: 0 };
    shadow.tagMemberships[operation.tagId] = { value: operation.present, revision: current.revision + (current.value === operation.present ? 0 : 1) };
    shadow.entityRevision++;
    shadow.deleted = false;
  } else {
    shadow.entityRevision++;
    shadow.deleted = true;
  }
  await putState({ key: `entity:${entityKeyV1(operation.entity)}`, annotation: shadow } as ShadowRecord);
}

async function applyTaxonomyOperationToShadow(operation: Exclude<SyncMutationV1, AnnotationMutation>): Promise<void> {
  const shadow = await readTaxonomyShadow();
  if (operation.type === "taxonomy.upsert" || operation.type === "taxonomy.delete") {
    const before = shadow.nodes[operation.node.id];
    shadow.nodes[operation.node.id] = { ...operation.node, nodeRevision: (before?.nodeRevision || 0) + 1, parentListRevision: 0, deleted: operation.type === "taxonomy.delete" };
    const parentKey = operation.node.parentId || "__root__"; shadow.parentRevisions[parentKey] = (shadow.parentRevisions[parentKey] || 0) + 1;
  } else if (operation.type === "taxonomy.reorder") {
    operation.orderedNodeIds.forEach((id, position) => { const node = shadow.nodes[id]; if (node) shadow.nodes[id] = { ...node, position, nodeRevision: node.nodeRevision + 1 }; });
    const parentKey = operation.parentId || "__root__"; shadow.parentRevisions[parentKey] = (shadow.parentRevisions[parentKey] || 0) + 1;
  } else if (operation.type === "color.upsert" || operation.type === "color.delete") {
    const before = shadow.colors[operation.color.id]; shadow.colors[operation.color.id] = { ...operation.color, revision: (before?.revision || 0) + 1, deleted: operation.type === "color.delete" };
  } else if (operation.type === "collection.upsert" || operation.type === "collection.delete") {
    const before = shadow.collections[operation.collection.id]; shadow.collections[operation.collection.id] = { ...operation.collection, revision: (before?.revision || 0) + 1, deleted: operation.type === "collection.delete" };
  }
  await putState(shadow);
}

function isAnnotationMutation(operation: SyncMutationV1): operation is AnnotationMutation {
  return operation.type === "annotation.patch" || operation.type === "annotation.tag-membership" || operation.type === "annotation.delete";
}

function emptyShadow(entity: AnnotationSnapshotV1["entity"]): AnnotationSnapshotV1 {
  return { entity, fields: { rating: { value: null, revision: 0 }, energy: { value: null, revision: 0 }, bpm: { value: null, revision: 0 }, key: { value: null, revision: 0 } }, tagMemberships: {}, entityRevision: 0, deleted: false };
}

async function readShadow(entity: AnnotationSnapshotV1["entity"]): Promise<AnnotationSnapshotV1> {
  const record = await getState<ShadowRecord>(`entity:${entityKeyV1(entity)}`);
  return record?.annotation || emptyShadow(entity);
}
async function readTaxonomyShadow(): Promise<TaxonomyShadowRecord> {
  return await getState<TaxonomyShadowRecord>("taxonomy-shadow") || { key: "taxonomy-shadow", nodes: {}, colors: {}, collections: {}, parentRevisions: {} };
}
async function readCursor() { return (await getState<CursorRecord>("cursor"))?.value || 0; }
async function readManifest() { return await getState<ReplicaManifest>("replica-manifest") || null; }
async function writeManifest(manifest: ReplicaManifest) { await putState(manifest); }

async function readAppStateDocument(domain: DurableAppStateDomain): Promise<DurableAppStateDocumentV2 | undefined> {
  const db = await openSyncDb();
  return requestResult(db.transaction(SYNC_STORES.APP_STATE).objectStore(SYNC_STORES.APP_STATE).get(domain));
}

async function capturePendingAppState(): Promise<DurableAppStateDocumentV2[]> {
  const shadow = await readAppStateShadow();
  const local = await buildDurableAppStateDocuments();
  const drafts: DurableAppStateDocumentV2[] = [];
  for (const document of local) {
    const pending = await getState<DurableAppStateDocumentV2>(`pending-app-state:${document.domain}`);
    const previous = shadow[document.domain];
    if (pending || (previous && !durableStateEquals(previous.value, document.value))) {
      drafts.push({ ...document, revision: pending?.revision ?? previous?.revision ?? 0 });
    }
  }
  return drafts;
}
async function readAppStateShadow(): Promise<Partial<Record<DurableAppStateDomain, DurableAppStateDocumentV2>>> {
  const db = await openSyncDb();
  const documents = await requestResult<DurableAppStateDocumentV2[]>(db.transaction(SYNC_STORES.APP_STATE).objectStore(SYNC_STORES.APP_STATE).getAll());
  return Object.fromEntries(documents.map((document) => [document.domain, document]));
}
async function putAppStateDocument(document: DurableAppStateDocumentV2) {
  const db = await openSyncDb();
  await completeTransaction(db.transaction(SYNC_STORES.APP_STATE, "readwrite"), (transaction) => transaction.objectStore(SYNC_STORES.APP_STATE).put(document));
}
async function deleteAppStateDocument(domain: DurableAppStateDomain) {
  const db = await openSyncDb();
  await completeTransaction(db.transaction(SYNC_STORES.APP_STATE, "readwrite"), (transaction) => transaction.objectStore(SYNC_STORES.APP_STATE).delete(domain));
}

async function writeCursorAndConflicts(cursor: number, conflicts: SyncConflictV1[]) {
  const db = await openSyncDb();
  const manifest = await readManifest();
  await completeTransaction(db.transaction([SYNC_STORES.STATE, SYNC_STORES.CONFLICTS], "readwrite"), (transaction) => {
    transaction.objectStore(SYNC_STORES.STATE).put({ key: "cursor", value: cursor });
    if (manifest) transaction.objectStore(SYNC_STORES.STATE).put({ ...manifest, appliedCursor: cursor, updatedAt: new Date().toISOString() });
    conflicts.forEach((conflict) => transaction.objectStore(SYNC_STORES.CONFLICTS).put(conflict));
  });
}
async function readOutbox(): Promise<LocalSyncIntent[]> { const db = await openSyncDb(); return requestResult(db.transaction(SYNC_STORES.OUTBOX).objectStore(SYNC_STORES.OUTBOX).index("by-created-at").getAll()); }
async function deleteOutbox(ids: string[]) { const db = await openSyncDb(); await completeTransaction(db.transaction(SYNC_STORES.OUTBOX, "readwrite"), (transaction) => ids.forEach((id) => transaction.objectStore(SYNC_STORES.OUTBOX).delete(id))); }
async function getState<T>(key: string): Promise<T | undefined> { const db = await openSyncDb(); return requestResult(db.transaction(SYNC_STORES.STATE).objectStore(SYNC_STORES.STATE).get(key)); }
async function putState(value: unknown) { const db = await openSyncDb(); await completeTransaction(db.transaction(SYNC_STORES.STATE, "readwrite"), (transaction) => transaction.objectStore(SYNC_STORES.STATE).put(value)); }
async function deleteState(key: string) { const db = await openSyncDb(); await completeTransaction(db.transaction(SYNC_STORES.STATE, "readwrite"), (transaction) => transaction.objectStore(SYNC_STORES.STATE).delete(key)); }

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const request = indexedDB.open(getTagifyDatabaseName()); request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); }; request.onerror = () => reject(request.error); });
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function completeTransaction(transaction: IDBTransaction, populate: (transaction: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => { populate(transaction); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
}
async function stableUuid(seed: string, suffix: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${seed}:${suffix}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function sha256Hex(value: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function sha256HexBytes(value: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

export async function buildLocalSnapshot(libraryId: string, sourceData?: TagDataStructure, generatedAt = new Date()): Promise<LibrarySnapshotV1> {
  const data = sourceData ?? await storageService.loadAll();
  const taxonomy = flattenTaxonomy(data.taxonomy);
  const annotations: AnnotationSnapshotV1[] = [];
  const add = (uri: string, value: TrackData | PlaylistData | ArtistData) => {
    const match = uri.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{10,64})$/); if (!match) return;
    const track = match[1] === "track" ? value as TrackData : null;
    if (!(value.rating > 0 || value.energy > 0 || value.tagIds.length || track?.bpm || track?.camelotKey)) return;
    annotations.push({
      entity: { provider: "spotify", kind: match[1] as AnnotationSnapshotV1["entity"]["kind"], providerId: match[2] },
      fields: { rating: { value: normalizeSyncRating(value.rating), revision: 0 }, energy: { value: normalizeSyncEnergy(value.energy), revision: 0 }, bpm: { value: normalizeSyncBpm(track?.bpm), revision: 0 }, key: { value: normalizeSyncKey(track?.camelotKey), revision: 0 } },
      tagMemberships: Object.fromEntries([...new Set(value.tagIds)].filter(isSyncSafeId).map((tagId) => [tagId, { value: true, revision: 0 }])), entityRevision: 0, deleted: false,
      ...syncTimestamps(value),
    });
  };
  Object.entries(data.tracks).forEach(([uri, value]) => add(uri, value)); Object.entries(data.playlists).forEach(([uri, value]) => add(uri, value)); Object.entries(data.artists).forEach(([uri, value]) => add(uri, value));
  const snapshot: LibrarySnapshotV1 = { protocolVersion: 1, sourceStorageSchemaVersion: data.schemaVersion, libraryId, headCursor: 0, generatedAt: generatedAt.toISOString(), taxonomy: Object.values(taxonomy.nodes), colors: Object.values(taxonomy.colors), collections: Object.values(taxonomy.collections), annotations };
  assertLibrarySnapshotV1(snapshot); return snapshot;
}

function snapshotChunks(snapshot: LibrarySnapshotV1) {
  const chunks: Array<{ kind: "taxonomy" | "colors" | "collections" | "annotations"; items: unknown[] }> = [];
  const add = (kind: (typeof chunks)[number]["kind"], items: unknown[]) => { for (let index=0; index<items.length; index+=250) chunks.push({ kind, items: items.slice(index,index+250) }); };
  add("taxonomy", snapshot.taxonomy); add("colors", snapshot.colors); add("collections", snapshot.collections); add("annotations", snapshot.annotations);
  return chunks.length ? chunks : [{ kind: "annotations" as const, items: [] }];
}

async function seedShadowFromSnapshot(snapshot: LibrarySnapshotV1, cursor: number) {
  const db = await openSyncDb();
  await completeTransaction(db.transaction([SYNC_STORES.STATE, SYNC_STORES.CONFLICTS, SYNC_STORES.TOMBSTONES], "readwrite"), (transaction) => {
    const store = transaction.objectStore(SYNC_STORES.STATE);
    store.clear();
    transaction.objectStore(SYNC_STORES.CONFLICTS).clear();
    transaction.objectStore(SYNC_STORES.TOMBSTONES).clear();
    store.put({ key: "cursor", value: cursor });
    const parentRevisions = parentRevisionsFromSnapshot(snapshot.taxonomy);
    store.put({ key: "taxonomy-shadow", nodes: Object.fromEntries(snapshot.taxonomy.map((node) => [node.id,node])), colors: Object.fromEntries(snapshot.colors.map((color) => [color.id,color])), collections: Object.fromEntries(snapshot.collections.map((collection) => [collection.id,collection])), parentRevisions } as TaxonomyShadowRecord);
    snapshot.annotations.forEach((annotation) => store.put({ key: `entity:${entityKeyV1(annotation.entity)}`, annotation } as ShadowRecord));
  });
}

function stateRecordsFromSnapshot(snapshot: LibrarySnapshotV1 | LibrarySnapshotV2): unknown[] {
  return [
    { key: "cursor", value: snapshot.headCursor },
    {
      key: "taxonomy-shadow",
      nodes: Object.fromEntries(snapshot.taxonomy.map((node) => [node.id, node])),
      colors: Object.fromEntries(snapshot.colors.map((color) => [color.id, color])),
      collections: Object.fromEntries(snapshot.collections.map((collection) => [collection.id, collection])),
      parentRevisions: parentRevisionsFromSnapshot(snapshot.taxonomy),
    } as TaxonomyShadowRecord,
    ...snapshot.annotations.map((annotation) => ({ key: `entity:${entityKeyV1(annotation.entity)}`, annotation } as ShadowRecord)),
  ];
}

function tagDataFromSnapshot(snapshot: LibrarySnapshotV1 | LibrarySnapshotV2, current?: TagDataStructure): TagDataStructure {
  const tracks: TagDataStructure["tracks"] = {};
  const playlists: TagDataStructure["playlists"] = {};
  const artists: TagDataStructure["artists"] = {};
  for (const annotation of snapshot.annotations) {
    const uri = `spotify:${annotation.entity.kind}:${annotation.entity.providerId}`;
    const existing = annotation.entity.kind === "track" ? current?.tracks[uri] : annotation.entity.kind === "artist" ? current?.artists[uri] : current?.playlists[uri];
    // The device's own dates win; Community's fill them in on a new device.
    const dateCreated = existing?.dateCreated ?? deviceTimestamp(annotation.createdAt);
    const dateModified = existing?.dateModified ?? deviceTimestamp(annotation.modifiedAt);
    const base = {
      rating: Number(annotation.fields.rating.value || 0), energy: Number(annotation.fields.energy.value || 0),
      tagIds: Object.entries(annotation.tagMemberships).filter(([, membership]) => membership.value).map(([tagId]) => tagId),
      ...(dateCreated === undefined ? {} : { dateCreated }),
      ...(dateModified === undefined ? {} : { dateModified }),
    };
    if (annotation.entity.kind === "track") tracks[uri] = { ...current?.tracks[uri], ...base, bpm: annotation.fields.bpm.value as number | null, camelotKey: annotation.fields.key.value as string | null };
    else if (annotation.entity.kind === "artist") artists[uri] = { ...current?.artists[uri], ...base };
    else playlists[uri] = { ...current?.playlists[uri], ...base };
  }
  return { schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy: expandSyncTaxonomy(snapshot), tracks, playlists, artists, smartPlaylists: [] };
}

function mergeReviewLabels(data: TagDataStructure, device: LibrarySnapshotV2, community: LibrarySnapshotV2, plan: InitialMergePlanV1): Record<string, string> {
  const taxonomy = data.taxonomy;
  const smartPlaylists = data.smartPlaylists || [];
  const labels = Object.fromEntries(plan.conflicts.map((conflict) => {
    if (conflict.subjectId.startsWith("spotify:track:")) return [conflict.id, data.tracks[conflict.subjectId]?.name || "Saved song"];
    if (conflict.subjectId.startsWith("spotify:artist:")) return [conflict.id, data.artists[conflict.subjectId]?.name || "Saved artist"];
    if (conflict.subjectId.startsWith("spotify:playlist:") || conflict.subjectId.startsWith("spotify:album:")) return [conflict.id, data.playlists[conflict.subjectId]?.name || "Saved playlist or album"];
    if (conflict.kind === "taxonomy") return [conflict.id, taxonomy.categoriesById[conflict.subjectId]?.name || taxonomy.subcategoriesById[conflict.subjectId]?.name || taxonomy.tagsById[conflict.subjectId]?.name || "Tag organization"];
    if (conflict.kind === "smart-playlist") {
      const deviceValue = conflict.deviceValue as { playlistName?: unknown };
      const communityValue = conflict.communityValue as { playlistName?: unknown };
      return [conflict.id, String(deviceValue?.playlistName || communityValue?.playlistName || smartPlaylists.find((playlist) => playlist.id === conflict.subjectId)?.playlistName || "Smart Playlist")];
    }
    return [conflict.id, friendlySavedSetting(conflict.field || conflict.subjectId)];
  }));
  for (const [source, snapshot] of [["device", device], ["community", community]] as const) {
    for (const node of snapshot.taxonomy) labels[`taxonomy-path:${source}:${node.id}`] = taxonomyPath(snapshot, node.id);
    for (const color of snapshot.colors) labels[`color:${source}:${color.id}`] = color.name;
  }
  return labels;
}

function taxonomyPath(snapshot: LibrarySnapshotV2, nodeId: string): string {
  const nodes = new Map(snapshot.taxonomy.map((node) => [node.id, node]));
  const names: string[] = [];
  const visited = new Set<string>();
  let current = nodes.get(nodeId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return names.join(" › ") || "another group";
}

function friendlySavedSetting(value: string): string {
  return value
    .replace(/^tagify:/, "")
    .replace(/[-_:]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function replicaManifest(configuration: DesktopSyncConfiguration, snapshot: { protocolVersion: number; headCursor: number; checksum?: string }): ReplicaManifest {
  const now = new Date().toISOString();
  return {
    key: "replica-manifest", accountId: configuration.accountId, libraryId: configuration.libraryId,
    storageSchemaVersion: TAG_DATA_SCHEMA_VERSION, protocolVersion: snapshot.protocolVersion,
    appliedCursor: snapshot.headCursor, snapshotChecksum: snapshot.checksum || null,
    appStateAppliedAt: snapshot.protocolVersion === PRIVATE_SYNC_PROTOCOL_VERSION ? null : now,
    initializedAt: now, updatedAt: now,
  };
}

async function markManifestAppStateApplied(): Promise<void> {
  const manifest = await readManifest();
  if (manifest) await writeManifest({ ...manifest, appStateAppliedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

function backupHealthFromSummary(summary: any): BackupHealth {
  return {
    lastBackupAt: summary?.lastCommittedAt || null,
    annotations: Number(summary?.counts?.annotations || 0),
    taxonomyNodes: Number(summary?.counts?.taxonomy || 0),
    appStateDocuments: Number(summary?.counts?.appState || 0),
    protectedDomains: summary?.backupHealth?.protectedDomains || [],
  };
}

function smartPlaylistsFromAppState(appState: DurableAppStateDocumentV2[]): unknown[] {
  return sanitizeSmartPlaylists(
    appState.find((document) => document.domain === "smart-playlists")?.value,
  );
}

export function parentRevisionsFromSnapshot(nodes: TaxonomyNodeSnapshotV1[]): Record<string, number> {
  const revisions: Record<string, number> = {};
  nodes.forEach((node) => {
    const key = node.parentId || "__root__";
    revisions[key] = Math.max(revisions[key] || 0, node.parentListRevision);
  });
  return revisions;
}

export function planDurableAppStateConflictReconciliation(
  domains: DurableAppStateDomain[],
  canonicalDocuments: DurableAppStateDocumentV2[],
): { canonicalDocuments: DurableAppStateDocumentV2[]; missingDomains: DurableAppStateDomain[] } {
  const canonicalByDomain = new Map(canonicalDocuments.map((document) => [document.domain, document]));
  return {
    canonicalDocuments: domains.flatMap((domain) => {
      const document = canonicalByDomain.get(domain);
      return document ? [document] : [];
    }),
    missingDomains: domains.filter((domain) => !canonicalByDomain.has(domain)),
  };
}
function stableTaxonomyJson(taxonomy: TagTaxonomy): string {
  return JSON.stringify(flattenTaxonomy(normalizeTaxonomyTree(taxonomy)));
}

function dispatchSyncEvent(origin: "local" | "remote", batchId: string, operations: SyncMutationV2[]) {
  window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "sync", origin, batchId, operationIds: operations.map((operation) => operation.operationId), entities: operations.filter((operation): operation is SyncChangeV1["operation"] & { entity: AnnotationSnapshotV1["entity"] } => "entity" in operation).map((operation) => entityKeyV1(operation.entity)) } }));
}

declare global {
  interface Window {
    TagifySync?: {
      beginPairing(apiBaseUrl: string, name: string, platform: string): ReturnType<typeof syncPairingService.begin>;
      pollPairing(): ReturnType<typeof syncPairingService.poll>;
      completePairing(...args: Parameters<typeof syncPairingService.complete>): ReturnType<typeof syncPairingService.complete>;
      cancelPairing(): void;
      syncNow(): Promise<void>;
      activateCurrentAccount(): Promise<void>;
      getStatus(): SyncStatus;
      getInitialMergePreview(): InitialMergeReview | null;
      getRecoveryPreview(): RecoveryPreview | null;
      getLastRecovered(): RecoveryPreview | null;
      getBackupHealth(): BackupHealth | null;
      restoreFromCloud(): Promise<void>;
      commitInitialMerge(resolutions: Record<string, InitialMergeSource>): Promise<InitialMergeResultV1>;
      downloadInitialMergeBackup(): Promise<void>;
      armCloudReplacement(): void;
      replaceCloudWithCurrentLocalState(): Promise<void>;
      communityRequest(path: string, options?: { method?: "GET" | "POST" | "PUT"; body?: unknown }): Promise<any>;
      unlinkLocal(): Promise<void>;
    };
  }
}

class SyncHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds: number | null) {
    super(message);
  }
}

function positiveNumber(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isSyncCapabilities(value: unknown): value is SyncCapabilitiesV1 | SyncCapabilitiesV2 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Number.isSafeInteger(candidate.protocolVersion)
    && Array.isArray(candidate.supportedProtocolVersions)
    && candidate.supportedProtocolVersions.every(Number.isSafeInteger);
}

function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

export const syncRuntime = new SyncRuntime();
