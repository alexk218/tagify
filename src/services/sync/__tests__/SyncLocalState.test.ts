import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendIntent,
  classifyLocalReplica,
  createEntityReplaceIntent,
  ensureSyncStores,
  entityFromUri,
  getDesktopSyncConfiguration,
  getDisconnectedSyncProvenance,
  getTagifyDatabaseName,
  isActiveSyncDatabase,
  isSyncCaptureEnabled,
  setLocalPersistencePaused,
  setDesktopSyncConfiguration,
  setDisconnectedSyncProvenance,
  SYNC_OUTBOX_CHANGED_EVENT,
  SYNC_STORES,
  TAGIFY_DATABASE_VERSION,
  type DesktopSyncConfiguration,
} from "../SyncLocalState";
import {
  buildReplicaReconciliationPlan,
  getEmptyReplicaPreparation,
  getPairingRelationship,
  getReplicaPreparationMode,
  PENDING_PAIRING_STORAGE_KEY,
  shouldRecoverLegacyReplica,
  switchSyncConfigurationTransactional,
  syncPairingService,
} from "../SyncPairingService";
import { defaultTagData } from "@/constants/defaultTagData";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import { storageService } from "@/services/storage/StorageService";

describe("desktop sync storage boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    syncPairingService.cancelPending();
    localStorage.clear();
    setLocalPersistencePaused(false);
  });

  it("accepts only Spotify entities covered by the private contract", () => {
    expect(entityFromUri("spotify:track:4uLU6hMCjMI75M1A2tKUQC", "track")).toEqual({ provider: "spotify", kind: "track", providerId: "4uLU6hMCjMI75M1A2tKUQC" });
    expect(entityFromUri("spotify:album:4LH4d3cOWNNsVw41Gqt2kv", "playlist")?.kind).toBe("album");
    expect(entityFromUri("local:track:file.mp3", "track")).toBeNull();
    expect(entityFromUri("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", "track")).toBeNull();
  });

  it("sends an unset track tempo as empty instead of zero", () => {
    const intent = createEntityReplaceIntent("spotify:track:4uLU6hMCjMI75M1A2tKUQC", "track", {
      rating: 0.5, energy: 5, bpm: 0, camelotKey: "1A", tagIds: ["tag_1s2agyx"], dateModified: 1_000,
    });
    expect(intent?.desired.bpm).toBeNull();
  });

  it("resolves the active IndexedDB namespace for app and extension readers", () => {
    const unlinkedDatabase = { name: "tagify-db" } as IDBDatabase;
    const accountDatabase = { name: "tagify-db:account-a" } as IDBDatabase;
    expect(getTagifyDatabaseName()).toBe("tagify-db");
    expect(isActiveSyncDatabase(unlinkedDatabase)).toBe(true);
    expect(isActiveSyncDatabase(accountDatabase)).toBe(false);
    setDesktopSyncConfiguration({ accountId: "account-a", libraryId: "library-a", deviceId: "device-a", apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: 1 });
    expect(getTagifyDatabaseName()).toBe("tagify-db:account-a");
    expect(isActiveSyncDatabase(unlinkedDatabase)).toBe(false);
    expect(isActiveSyncDatabase(accountDatabase)).toBe(true);
    setDesktopSyncConfiguration(null);
    expect(getTagifyDatabaseName()).toBe("tagify-db");
  });

  it("hydrates an account switch from its cloud library instead of another account's replica", () => {
    const accountA = { accountId: "account-a" } as DesktopSyncConfiguration;
    expect(getReplicaPreparationMode(null, "account-a")).toBe("seed-unlinked");
    expect(getReplicaPreparationMode(accountA, "account-a")).toBe("reuse");
    expect(getReplicaPreparationMode(accountA, "account-b")).toBe("hydrate-cloud");
    expect(getEmptyReplicaPreparation("hydrate-cloud")).toBe("leave-empty");
    expect(getEmptyReplicaPreparation("seed-unlinked")).toBe("copy-local");
  });

  it("remembers disconnected account provenance without retaining credentials", () => {
    setDisconnectedSyncProvenance({
      accountId: "account-a",
      libraryId: "library-a",
      disconnectedAt: "2026-08-22T00:00:00.000Z",
      profile: { handle: "alex", displayName: "Alex" },
    });

    expect(getDesktopSyncConfiguration()).toBeNull();
    expect(getDisconnectedSyncProvenance()).toMatchObject({
      accountId: "account-a",
      libraryId: "library-a",
      profile: { handle: "alex" },
    });
  });

  it("distinguishes same-account reconnects from confirmed account switches", () => {
    const provenance = {
      accountId: "account-a",
      libraryId: "library-a",
      disconnectedAt: "2026-08-22T00:00:00.000Z",
    };

    expect(getPairingRelationship(null, provenance, "account-a")).toBe("reconnect");
    expect(getPairingRelationship(null, provenance, "account-b")).toBe("account-switch");
    expect(getPairingRelationship(null, null, "account-b")).toBe("first-link");
  });

  it("plans exact local-only edits for the prior account replica", () => {
    const base = {
      ...defaultTagData,
      tracks: {
        "spotify:track:4uLU6hMCjMI75M1A2tKUQC": {
          rating: 1,
          energy: 0,
          bpm: null,
          camelotKey: null,
          tagIds: [],
        },
        "spotify:track:5ChkMS8OtdzJeqyybCc9R5": {
          rating: 5,
          energy: 0,
          bpm: null,
          camelotKey: null,
          tagIds: [],
        },
      },
    };
    const localOnly = {
      ...base,
      tracks: {
        "spotify:track:4uLU6hMCjMI75M1A2tKUQC": {
          ...base.tracks["spotify:track:4uLU6hMCjMI75M1A2tKUQC"],
          rating: 4,
        },
      },
    };

    const plan = buildReplicaReconciliationPlan(localOnly, base);

    expect(plan.entityIntents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "entity.replace", entity: expect.objectContaining({ providerId: "4uLU6hMCjMI75M1A2tKUQC" }) }),
      expect.objectContaining({ type: "entity.delete", entity: expect.objectContaining({ providerId: "5ChkMS8OtdzJeqyybCc9R5" }) }),
    ]));
  });

  it("stages the browser-approved account until Tagify confirms it", async () => {
    setDisconnectedSyncProvenance({
      accountId: "account-a",
      libraryId: "library-a",
      disconnectedAt: "2026-08-22T00:00:00.000Z",
    });
    localStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify({
      apiBaseUrl: "https://community.tagify.fm",
      deviceCode: "device-code",
      verifier: "verifier",
      userCode: "ABCD-EFGH",
      verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH",
      expiresAt: Date.now() + 60_000,
      interval: 5,
    }));
    const payload = btoa(JSON.stringify({
      sub: "account-b",
      iss: "https://example.supabase.co/auth/v1",
    })).replace(/=+$/, "");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      accessToken: `header.${payload}.signature`,
      refreshToken: "refresh",
      libraryId: "library-b",
      deviceId: "device-b",
      supabasePublishableKey: "key",
      expiresAt: Date.now() + 60_000,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await syncPairingService.poll();

    expect(result).toMatchObject({
      status: "approved",
      approval: {
        relationship: "account-switch",
        configuration: { accountId: "account-b" },
      },
    });
    expect(getDesktopSyncConfiguration()).toBeNull();
    if (result.status === "approved") {
      await expect(syncPairingService.complete(result.approval)).rejects.toThrow(
        "Confirm the Community account switch",
      );
    }

    syncPairingService.cancelPending();
    expect(syncPairingService.getPending()).toBeNull();
  });

  it("rolls back credentials and database selection when activation fails", async () => {
    const next = {
      accountId: "account-b",
      libraryId: "library-b",
      deviceId: "device-b",
      apiBaseUrl: "https://community.tagify.fm",
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "key",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
    };
    const switchDatabase = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(
      switchSyncConfigurationTransactional(next, null, switchDatabase),
    ).rejects.toThrow("account-scoped Tagify database could not be opened");

    expect(getDesktopSyncConfiguration()).toBeNull();
    expect(getTagifyDatabaseName()).toBe("tagify-db");
    expect(switchDatabase).toHaveBeenCalledTimes(2);
  });

  it("preserves the connected library in local-only storage before unlinking", async () => {
    setDesktopSyncConfiguration({ accountId: "account-a", libraryId: "library-a", deviceId: "device-a", apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: 1 });
    vi.spyOn(storageService, "loadAll").mockResolvedValue(defaultTagData);
    const switchDatabase = vi.spyOn(storageService, "switchAccountDatabase").mockResolvedValue(true);
    const saveAll = vi.spyOn(storageService, "saveAll").mockResolvedValue(true);

    await syncPairingService.unlinkLocal();

    expect(getDesktopSyncConfiguration()).toBeNull();
    expect(getTagifyDatabaseName()).toBe("tagify-db");
    expect(switchDatabase).toHaveBeenCalledTimes(1);
    expect(saveAll).toHaveBeenCalledWith(defaultTagData);
  });

  it("restores the connection when local-only preservation fails", async () => {
    const configuration = { accountId: "account-a", libraryId: "library-a", deviceId: "device-a", apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: 1 };
    setDesktopSyncConfiguration(configuration);
    vi.spyOn(storageService, "loadAll").mockResolvedValue(defaultTagData);
    const switchDatabase = vi.spyOn(storageService, "switchAccountDatabase")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(syncPairingService.unlinkLocal()).rejects.toThrow(
      "The local-only Tagify database could not be opened",
    );

    expect(getDesktopSyncConfiguration()).toEqual(configuration);
    expect(getTagifyDatabaseName()).toBe("tagify-db:account-a");
    expect(switchDatabase).toHaveBeenCalledTimes(2);
  });

  it("recovers only legacy writes newer than the paired replica and prior recovery", () => {
    expect(shouldRecoverLegacyReplica(300, 200, 0)).toBe(true);
    expect(shouldRecoverLegacyReplica(300, 200, 300)).toBe(false);
    expect(shouldRecoverLegacyReplica(200, 300, 0)).toBe(false);
    expect(shouldRecoverLegacyReplica(0, 0, 0)).toBe(false);
  });

  it("blocks local sync capture while a lost replica awaits confirmation", () => {
    setDesktopSyncConfiguration({ accountId: "account-a", libraryId: "library-a", deviceId: "device-a", apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key", accessToken: "token", refreshToken: "refresh", expiresAt: 1 });
    expect(isSyncCaptureEnabled()).toBe(true);
    setLocalPersistencePaused(true);
    expect(isSyncCaptureEnabled()).toBe(false);
  });

  it("upgrades paired replicas that predate the sync object stores", () => {
    const stores = new Set(["tracks", "playlists", "artists", "categories", "metadata"]);
    const indexes = new Map<string, string[]>();
    const db = {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: (name: string) => {
        stores.add(name);
        return { createIndex: (indexName: string) => indexes.set(name, [...(indexes.get(name) ?? []), indexName]) };
      },
    } as unknown as IDBDatabase;

    ensureSyncStores(db);

    expect(TAGIFY_DATABASE_VERSION).toBe(10);
    expect([...Object.values(SYNC_STORES)].every((store) => stores.has(store))).toBe(true);
    expect(indexes.get(SYNC_STORES.OUTBOX)).toEqual(["by-created-at", "by-entity"]);
  });

  it("requests one immediate sync after an outbox transaction commits", () => {
    const put = vi.fn();
    const completeListeners: EventListener[] = [];
    const transaction = {
      objectStoreNames: { contains: (name: string) => name === SYNC_STORES.OUTBOX },
      objectStore: () => ({ put }),
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "complete") completeListeners.push(listener);
      }),
    } as unknown as IDBTransaction;
    const onOutboxChanged = vi.fn();
    window.addEventListener(SYNC_OUTBOX_CHANGED_EVENT, onOutboxChanged, { once: true });
    const intent = {
      id: "intent-a", batchId: "batch-a", createdAt: 1, type: "entity.delete" as const,
      entity: { provider: "spotify" as const, kind: "track" as const, providerId: "4uLU6hMCjMI75M1A2tKUQC" },
    };

    appendIntent(transaction, intent);
    appendIntent(transaction, { ...intent, id: "intent-b" });
    completeListeners[0]?.(new Event("complete"));

    expect(put).toHaveBeenCalledTimes(2);
    expect(transaction.addEventListener).toHaveBeenCalledTimes(1);
    expect(onOutboxChanged).toHaveBeenCalledTimes(1);
  });

  it("does not mistake the built-in taxonomy for meaningful user data", () => {
    const emptyReplica = { ...defaultTagData, tracks: {}, playlists: {}, artists: {} };
    expect(classifyLocalReplica(emptyReplica, defaultTagData.taxonomy, null)).toBe("fresh-default");
    expect(classifyLocalReplica({ ...emptyReplica, taxonomy: createEmptyTaxonomy() }, defaultTagData.taxonomy, null)).toBe("fresh-default");
    expect(classifyLocalReplica({ ...emptyReplica, tracks: { "spotify:track:4uLU6hMCjMI75M1A2tKUQC": {} } }, defaultTagData.taxonomy, null)).toBe("meaningful-unlinked");
    expect(classifyLocalReplica(emptyReplica, defaultTagData.taxonomy, {
      key: "replica-manifest", accountId: "account-a", libraryId: "library-a", storageSchemaVersion: 9,
      protocolVersion: 2, appliedCursor: 4, snapshotChecksum: null, appStateAppliedAt: new Date().toISOString(), initializedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })).toBe("initialized-replica");
  });
});
