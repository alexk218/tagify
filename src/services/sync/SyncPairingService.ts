import type { ArtistData, PlaylistData, TagDataStructure, TagTaxonomy, TrackData } from "@/types/tagData";
import { storageService } from "@/services/storage/StorageService";
import { IndexedDBStorageService } from "@/services/storage/IndexedDBStorageService";
import {
  appendIntent,
  createEntityDeleteIntent,
  createEntityReplaceIntent,
  flushLocalPersistence,
  getDesktopSyncConfiguration,
  getDisconnectedSyncProvenance,
  getTagifyDatabaseName,
  makeEntityReplaceIntent,
  makeTaxonomyIntent,
  setDesktopSyncConfiguration,
  setDisconnectedSyncProvenance,
  SYNC_STORES,
  TAGIFY_DATABASE_VERSION,
  type DesktopSyncConfiguration,
  type DisconnectedSyncProvenance,
  type EntityDeleteIntent,
  type EntityReplaceIntent,
  type TaxonomyReplaceIntent,
} from "./SyncLocalState";
import {
  applyDurableAppStateDocuments,
  applyDurableLocalState,
  captureDurableLocalState,
  clearDurableLocalStateForAccountSwitch,
  restoreDurableLocalStateForAccount,
  stashDurableLocalStateForAccount,
} from "./DurableAppState";
import type { DurableAppStateDocumentV2 } from "@tagify/sync-contracts";
import { defaultTagData } from "@/constants/defaultTagData";
import { enrollDesktopRecovery } from "./SyncInstallRecovery";
import { wereSmartPlaylistsExplicitlyCleared } from "@/features/smart-playlists/utils/smartPlaylist.storage";

export const PENDING_PAIRING_STORAGE_KEY = "tagify:sync:pending-pairing";
const LEGACY_DATABASE_NAME = "tagify-db";
const LEGACY_RECOVERY_META_KEY = "syncLegacyRecoveryLastModified";

interface PendingPairing {
  apiBaseUrl: string;
  deviceCode: string;
  verifier: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

export type PairingRelationship = "first-link" | "reconnect" | "account-switch";

export interface ApprovedPairing {
  configuration: DesktopSyncConfiguration;
  relationship: PairingRelationship;
  previousAccount: DisconnectedSyncProvenance | null;
}

type PairingPollResult =
  | { status: "pending" }
  | { status: "approved"; approval: ApprovedPairing };

let stagedApproval: ApprovedPairing | null = null;

export class SyncPairingService {
  async begin(apiBaseUrl: string, name: string, platform: string): Promise<PendingPairing> {
    this.cancelPending();
    const verifier = randomBase64Url(48);
    const response = await fetch(`${trimSlash(apiBaseUrl)}/api/v2/device-authorizations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, platform, verifierChallenge: await sha256Hex(verifier) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || "Tagify could not start device linking");
    const pending: PendingPairing = {
      apiBaseUrl: trimSlash(apiBaseUrl), deviceCode: body.deviceCode, verifier,
      userCode: body.userCode, verificationUri: body.verificationUriComplete || body.verificationUri,
      expiresAt: Date.now() + body.expiresIn * 1000, interval: body.interval,
    };
    localStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify(pending));
    return pending;
  }

  getPending(): PendingPairing | null {
    try {
      const value = localStorage.getItem(PENDING_PAIRING_STORAGE_KEY);
      if (!value) return null;
      const pending = JSON.parse(value) as PendingPairing;
      if (pending.expiresAt <= Date.now()) { this.cancelPending(); return null; }
      return pending;
    } catch { return null; }
  }

  async poll(): Promise<PairingPollResult> {
    if (stagedApproval) return { status: "approved", approval: stagedApproval };
    const pending = this.getPending();
    if (!pending) throw new Error("The device code expired. Start linking again.");
    const response = await fetch(`${pending.apiBaseUrl}/api/v2/device-authorizations/token`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: pending.deviceCode, verifier: pending.verifier }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 428 || body.status === "authorization_pending") return { status: "pending" };
    if (response.status === 429 && body.status === "slow_down") {
      const retryAfter = Number(response.headers.get("retry-after") || body.interval || 20);
      pending.interval = Math.min(60, Math.max(pending.interval * 2, retryAfter));
      localStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify(pending));
      return { status: "pending" };
    }
    if (!response.ok) throw new Error(body.error?.message || "Device linking failed");
    const claims = decodeJwt(body.accessToken);
    const configuration: DesktopSyncConfiguration = {
      accountId: claims.sub,
      libraryId: body.libraryId,
      deviceId: body.deviceId,
      apiBaseUrl: pending.apiBaseUrl,
      supabaseUrl: body.supabaseUrl || claims.iss.replace(/\/auth\/v1\/?$/, ""),
      supabasePublishableKey: body.supabasePublishableKey,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresAt: body.expiresAt,
    };
    const previous = getDesktopSyncConfiguration();
    const provenance = getDisconnectedSyncProvenance();
    stagedApproval = {
      configuration,
      relationship: getPairingRelationship(previous, provenance, configuration.accountId),
      previousAccount: provenance || (previous ? {
        accountId: previous.accountId,
        libraryId: previous.libraryId,
        disconnectedAt: new Date().toISOString(),
        profile: previous.profile,
      } : null),
    };
    return { status: "approved", approval: stagedApproval };
  }

  async complete(
    approval: ApprovedPairing,
    options: { confirmedAccountSwitch?: boolean } = {},
  ): Promise<{ configuration: DesktopSyncConfiguration; requiresReload: boolean }> {
    if (
      !stagedApproval ||
      stagedApproval.configuration.deviceId !== approval.configuration.deviceId ||
      stagedApproval.configuration.accountId !== approval.configuration.accountId
    ) {
      throw new Error("This Community approval is no longer active. Start again.");
    }
    if (approval.relationship === "account-switch" && !options.confirmedAccountSwitch) {
      throw new Error("Confirm the Community account switch before continuing.");
    }

    const previous = getDesktopSyncConfiguration();
    const provenance = getDisconnectedSyncProvenance();
    const durableBefore = captureDurableLocalState();
    const reconnectingFromLocalOnly =
      !previous &&
      provenance?.accountId === approval.configuration.accountId;
    let configurationSwitched = false;

    try {
      if (approval.relationship === "account-switch" && previous) {
        stashDurableLocalStateForAccount(previous.accountId);
      }
      if (!previous && provenance) {
        stashDurableLocalStateForAccount(provenance.accountId);
        await reconcileUnlinkedReplica(provenance.accountId);
      }

      if (!reconnectingFromLocalOnly) {
        const mode = approval.relationship === "first-link"
          ? "seed-unlinked"
          : approval.relationship === "account-switch"
            ? "hydrate-cloud"
            : "reuse";
        await prepareAccountReplica(approval.configuration.accountId, mode);
      }

      await switchSyncConfigurationTransactional(
        approval.configuration,
        previous,
      );
      configurationSwitched = true;

      if (approval.relationship === "account-switch") {
        clearDurableLocalStateForAccountSwitch();
        const restoredDraft = restoreDurableLocalStateForAccount(
          approval.configuration.accountId,
        );
        if (!restoredDraft) {
          const documents = await readAccountDurableDocuments(
            approval.configuration.accountId,
          );
          if (documents.length) await applyDurableAppStateDocuments(documents);
        }
      }

      setDisconnectedSyncProvenance(null);
      void enrollDesktopRecovery(approval.configuration);
      this.cancelPending();
      window.dispatchEvent(new CustomEvent("tagify:syncStatus", {
        detail: { status: window.TagifySync?.getStatus() || "unlinked" },
      }));
      return {
        configuration: approval.configuration,
        requiresReload: approval.relationship === "account-switch",
      };
    } catch (error) {
      if (configurationSwitched) {
        setDesktopSyncConfiguration(previous);
        await storageService.switchAccountDatabase();
      }
      applyDurableLocalState(durableBefore);
      throw error;
    }
  }

  cancelPending(): void {
    stagedApproval = null;
    localStorage.removeItem(PENDING_PAIRING_STORAGE_KEY);
  }

  async unlinkLocal(): Promise<void> {
    const configuration = getDesktopSyncConfiguration();
    if (!configuration) return;

    await flushLocalPersistence();
    const localData = await storageService.loadAll();
    stashDurableLocalStateForAccount(configuration.accountId);
    setDesktopSyncConfiguration(null);

    try {
      if (!(await storageService.switchAccountDatabase())) {
        throw new Error("The local-only Tagify database could not be opened");
      }
      if (!(await storageService.saveAll(localData))) {
        throw new Error("Tagify could not preserve the current library locally");
      }
      setDisconnectedSyncProvenance({
        accountId: configuration.accountId,
        libraryId: configuration.libraryId,
        disconnectedAt: new Date().toISOString(),
        profile: configuration.profile,
      });
      this.cancelPending();
    } catch (error) {
      setDesktopSyncConfiguration(configuration);
      await storageService.switchAccountDatabase();
      throw error;
    }
  }

  async recoverLegacyReplica(accountId: string): Promise<void> {
    if (typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases();
      if (!databases.some((database) => database.name === LEGACY_DATABASE_NAME)) return;
    }
    const source = await openReplica(LEGACY_DATABASE_NAME, false);
    const target = await openReplica(`tagify-db:${accountId}`, true);
    try {
      const requiredStores = ["tracks", "playlists", "artists", "categories", "metadata"];
      if (requiredStores.some((store) => !source.objectStoreNames.contains(store) || !target.objectStoreNames.contains(store))) return;
      const [sourceMetadata, targetMetadata] = await Promise.all([
        getStoreRecords(source, "metadata"),
        getStoreRecords(target, "metadata"),
      ]);
      const sourceModified = metadataNumber(sourceMetadata, "lastModified");
      const targetModified = metadataNumber(targetMetadata, "lastModified");
      const recoveredModified = metadataNumber(targetMetadata, LEGACY_RECOVERY_META_KEY);
      if (!shouldRecoverLegacyReplica(sourceModified, targetModified, recoveredModified)) return;

      const [sourceTracks, sourcePlaylists, sourceArtists, sourceCategories, sourceSmartPlaylists, targetTracks, targetPlaylists, targetArtists, targetCategories, targetSmartPlaylists] = await Promise.all([
        getStoreRecords(source, "tracks"), getStoreRecords(source, "playlists"), getStoreRecords(source, "artists"), getStoreRecords(source, "categories"),
        source.objectStoreNames.contains("smartPlaylists") ? getStoreRecords(source, "smartPlaylists") : Promise.resolve([]),
        getStoreRecords(target, "tracks"), getStoreRecords(target, "playlists"), getStoreRecords(target, "artists"), getStoreRecords(target, "categories"),
        getStoreRecords(target, "smartPlaylists"),
      ]);
      const transaction = target.transaction(["tracks", "playlists", "artists", "categories", "smartPlaylists", "metadata", SYNC_STORES.OUTBOX], "readwrite");
      const batchId = crypto.randomUUID();
      let recovered = 0;
      recovered += recoverEntityRecords(transaction, "tracks", "track", sourceTracks, targetTracks, batchId);
      recovered += recoverEntityRecords(transaction, "playlists", "playlist", sourcePlaylists, targetPlaylists, batchId);
      recovered += recoverEntityRecords(transaction, "artists", "artist", sourceArtists, targetArtists, batchId);
      const sourceTaxonomy = sourceCategories.find((record) => (record as { id?: unknown }).id === "taxonomy") as { id: string; data: TagTaxonomy } | undefined;
      const targetTaxonomy = targetCategories.find((record) => (record as { id?: unknown }).id === "taxonomy");
      if (sourceTaxonomy && JSON.stringify(sourceTaxonomy) !== JSON.stringify(targetTaxonomy)) {
        transaction.objectStore("categories").put(sourceTaxonomy);
        appendIntent(transaction, makeTaxonomyIntent(sourceTaxonomy.data, batchId));
        recovered++;
      }
      const targetSmartById = new Map(targetSmartPlaylists.map((record) => [(record as { id: string }).id, record]));
      for (const record of sourceSmartPlaylists) {
        const sourcePlaylist = record as { id: string; updatedAt?: number };
        const targetPlaylist = targetSmartById.get(sourcePlaylist.id) as { updatedAt?: number } | undefined;
        if (targetPlaylist && (sourcePlaylist.updatedAt || 0) <= (targetPlaylist.updatedAt || 0)) continue;
        transaction.objectStore("smartPlaylists").put(record);
        recovered++;
      }
      transaction.objectStore("metadata").put({ key: LEGACY_RECOVERY_META_KEY, value: sourceModified });
      await transactionDone(transaction);
      if (recovered > 0) console.info("Tagify sync: recovered newer pre-pairing changes", { recovered });
    } finally {
      source.close();
      target.close();
    }
  }
}

function randomBase64Url(bytes: number) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = ""; value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(value: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function trimSlash(value: string) { return value.replace(/\/+$/, ""); }
function decodeJwt(token: string): { sub: string; iss: string } {
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  if (typeof payload.sub !== "string" || typeof payload.iss !== "string") throw new Error("Invalid Community session");
  return { sub: payload.sub, iss: payload.iss };
}

export function getPairingRelationship(
  previous: DesktopSyncConfiguration | null,
  provenance: DisconnectedSyncProvenance | null,
  accountId: string,
): PairingRelationship {
  const priorAccountId = previous?.accountId || provenance?.accountId;
  if (!priorAccountId) return "first-link";
  return priorAccountId === accountId ? "reconnect" : "account-switch";
}

export async function switchSyncConfigurationTransactional(
  configuration: DesktopSyncConfiguration,
  previous: DesktopSyncConfiguration | null,
  switchDatabase: () => Promise<boolean> = () => storageService.switchAccountDatabase(),
): Promise<void> {
  setDesktopSyncConfiguration(configuration);
  if (await switchDatabase()) return;

  setDesktopSyncConfiguration(previous);
  await switchDatabase();
  throw new Error("The account-scoped Tagify database could not be opened");
}

export function buildReplicaReconciliationPlan(
  source: TagDataStructure,
  target: TagDataStructure,
): {
  entityIntents: Array<EntityReplaceIntent | EntityDeleteIntent>;
  taxonomyIntent: TaxonomyReplaceIntent | null;
} {
  const batchId = crypto.randomUUID();
  const entityIntents: Array<EntityReplaceIntent | EntityDeleteIntent> = [];
  const collections = [
    [source.tracks, target.tracks, "track"],
    [source.playlists, target.playlists, "playlist"],
    [source.artists, target.artists, "artist"],
  ] as const;

  for (const [sourceRecords, targetRecords, kind] of collections) {
    for (const [uri, data] of Object.entries(sourceRecords)) {
      if (JSON.stringify(data) === JSON.stringify(targetRecords[uri])) continue;
      const intent = createEntityReplaceIntent(uri, kind, data, batchId);
      if (intent) entityIntents.push(intent);
    }
    for (const uri of Object.keys(targetRecords)) {
      if (sourceRecords[uri]) continue;
      const intent = createEntityDeleteIntent(uri, kind, batchId);
      if (intent) entityIntents.push(intent);
    }
  }

  const taxonomyIntent = JSON.stringify(source.taxonomy) === JSON.stringify(target.taxonomy)
    ? null
    : {
        id: crypto.randomUUID(),
        batchId,
        createdAt: Date.now(),
        type: "taxonomy.replace" as const,
        taxonomy: source.taxonomy,
      };

  return { entityIntents, taxonomyIntent };
}

export function getReplicaPreparationMode(
  previous: DesktopSyncConfiguration | null,
  accountId: string,
): "seed-unlinked" | "hydrate-cloud" | "reuse" {
  if (!previous) return "seed-unlinked";
  return previous.accountId === accountId ? "reuse" : "hydrate-cloud";
}

export function getEmptyReplicaPreparation(
  mode: ReturnType<typeof getReplicaPreparationMode>,
): "copy-local" | "queue-snapshot" | "leave-empty" {
  if (mode === "seed-unlinked") return "copy-local";
  return mode === "reuse" ? "queue-snapshot" : "leave-empty";
}

async function reconcileUnlinkedReplica(accountId: string): Promise<void> {
  const source = await openReplica(getTagifyDatabaseName(), false);
  const target = await openReplica(`tagify-db:${accountId}`, true);
  const coreStores = ["tracks", "playlists", "artists", "categories", "metadata"] as const;
  try {
    const sourceContents = new Map<string, unknown[]>();
    const targetContents = new Map<string, unknown[]>();
    await Promise.all(coreStores.flatMap((store) => [
      getStoreRecords(source, store).then((records) => sourceContents.set(store, records)),
      getStoreRecords(target, store).then((records) => targetContents.set(store, records)),
    ]));
    const sourceSmartPlaylists = source.objectStoreNames.contains("smartPlaylists")
      ? await getStoreRecords(source, "smartPlaylists")
      : null;
    const replaceSmartPlaylists = sourceSmartPlaylists !== null &&
      (sourceSmartPlaylists.length > 0 || wereSmartPlaylistsExplicitlyCleared());

    const sourceData = tagDataFromRecords(sourceContents);
    const targetData = tagDataFromRecords(targetContents);
    const plan = buildReplicaReconciliationPlan(sourceData, targetData);
    const transaction = target.transaction(
      [...coreStores, ...(replaceSmartPlaylists ? ["smartPlaylists"] : []), SYNC_STORES.OUTBOX],
      "readwrite",
    );
    for (const store of coreStores) {
      const targetStore = transaction.objectStore(store);
      targetStore.clear();
      sourceContents.get(store)?.forEach((record) => targetStore.put(record));
    }
    if (replaceSmartPlaylists) {
      const targetStore = transaction.objectStore("smartPlaylists");
      targetStore.clear();
      sourceSmartPlaylists?.forEach((record) => targetStore.put(record));
    }
    const outbox = transaction.objectStore(SYNC_STORES.OUTBOX);
    plan.entityIntents.forEach((intent) => outbox.put(intent));
    if (plan.taxonomyIntent) outbox.put(plan.taxonomyIntent);
    await transactionDone(transaction);
  } finally {
    source.close();
    target.close();
  }
}

function tagDataFromRecords(records: Map<string, unknown[]>): TagDataStructure {
  const byUri = <T>(store: "tracks" | "playlists" | "artists") =>
    Object.fromEntries(records.get(store)?.map((record) => {
      const { uri, ...data } = record as { uri: string } & Record<string, unknown>;
      return [uri, data as T];
    }) || []);
  const taxonomy = (records.get("categories")?.find((record) =>
    (record as { id?: unknown }).id === "taxonomy"
  ) as { data?: TagTaxonomy } | undefined)?.data || defaultTagData.taxonomy;
  return {
    schemaVersion: defaultTagData.schemaVersion,
    taxonomy,
    tracks: byUri<TrackData>("tracks"),
    playlists: byUri<PlaylistData>("playlists"),
    artists: byUri<ArtistData>("artists"),
  };
}

async function readAccountDurableDocuments(
  accountId: string,
): Promise<DurableAppStateDocumentV2[]> {
  const database = await openReplica(`tagify-db:${accountId}`, true);
  try {
    return await getStoreRecords(database, SYNC_STORES.APP_STATE) as DurableAppStateDocumentV2[];
  } finally {
    database.close();
  }
}

async function prepareAccountReplica(accountId: string, mode: ReturnType<typeof getReplicaPreparationMode>): Promise<void> {
  const targetName = `tagify-db:${accountId}`;
  const target = await openReplica(targetName, true);
  const targetHasReplica = await Promise.all([
    "tracks", "playlists", "artists", "smartPlaylists", SYNC_STORES.OUTBOX, SYNC_STORES.STATE,
    SYNC_STORES.CONFLICTS, SYNC_STORES.TOMBSTONES,
  ].map((store) => countStore(target, store))).then((counts) => counts.some((count) => count > 0));
  if (targetHasReplica) { target.close(); return; }
  const preparation = getEmptyReplicaPreparation(mode);
  if (preparation === "leave-empty") {
    target.close();
    return;
  }
  if (preparation === "queue-snapshot") {
    await queueInitialSnapshot(target);
    target.close();
    return;
  }
  const sourceName = getTagifyDatabaseName();
  const source = await openReplica(sourceName, false);
  const stores = ["tracks", "playlists", "artists", "categories", "metadata", "smartPlaylists"];
  const contents = new Map<string, unknown[]>();
  await Promise.all(stores.map(async (store) => {
    contents.set(store, source.objectStoreNames.contains(store) ? await requestResult(source.transaction(store).objectStore(store).getAll()) : []);
  }));
  await new Promise<void>((resolve, reject) => {
    const transaction = target.transaction([...stores, SYNC_STORES.OUTBOX], "readwrite");
    stores.forEach((store) => contents.get(store)?.forEach((item) => transaction.objectStore(store).put(item)));
    transaction.objectStore(SYNC_STORES.OUTBOX).put({ id: crypto.randomUUID(), batchId: crypto.randomUUID(), createdAt: Date.now(), type: "library.snapshot", reason: "migration" });
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
  source.close(); target.close();
}

export function shouldRecoverLegacyReplica(sourceModified: number, targetModified: number, recoveredModified: number): boolean {
  return Number.isFinite(sourceModified) && sourceModified > Math.max(targetModified || 0, recoveredModified || 0);
}

function metadataNumber(records: unknown[], key: string): number {
  const value = (records.find((record) => (record as { key?: unknown }).key === key) as { value?: unknown } | undefined)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recoverEntityRecords(
  transaction: IDBTransaction,
  storeName: "tracks" | "playlists" | "artists",
  storageKind: "track" | "playlist" | "artist",
  sourceRecords: unknown[],
  targetRecords: unknown[],
  batchId: ReturnType<Crypto["randomUUID"]>,
): number {
  const targetByUri = new Map(targetRecords.map((record) => [(record as { uri: string }).uri, record]));
  let recovered = 0;
  for (const record of sourceRecords) {
    const sourceRecord = record as { uri: string } & (TrackData | PlaylistData | ArtistData);
    if (JSON.stringify(sourceRecord) === JSON.stringify(targetByUri.get(sourceRecord.uri))) continue;
    transaction.objectStore(storeName).put(sourceRecord);
    const { uri, ...data } = sourceRecord;
    appendIntent(transaction, makeEntityReplaceIntent(uri, storageKind, data as TrackData | PlaylistData | ArtistData, batchId));
    recovered++;
  }
  return recovered;
}

function queueInitialSnapshot(target: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = target.transaction(SYNC_STORES.OUTBOX, "readwrite");
    transaction.objectStore(SYNC_STORES.OUTBOX).put({
      id: crypto.randomUUID(), batchId: crypto.randomUUID(), createdAt: Date.now(),
      type: "library.snapshot", reason: "migration",
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openReplica(name: string, create: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = create ? indexedDB.open(name, TAGIFY_DATABASE_VERSION) : indexedDB.open(name);
    request.onupgradeneeded = () => {
      IndexedDBStorageService.createSchema(request.result, request.transaction ?? undefined);
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
function countStore(db: IDBDatabase, store: string): Promise<number> { return requestResult(db.transaction(store).objectStore(store).count()); }
function getStoreRecords(db: IDBDatabase, store: string): Promise<unknown[]> { return requestResult(db.transaction(store).objectStore(store).getAll()); }
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }

export const syncPairingService = new SyncPairingService();
