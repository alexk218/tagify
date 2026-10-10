import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { storageService } from "@/services/storage/StorageService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getTagifyDatabaseName, setDesktopSyncConfiguration, SYNC_STORES, type DesktopSyncConfiguration } from "../SyncLocalState";
import {
  EDIT_SYNC_DEBOUNCE_MS,
  EDIT_SYNC_MAX_WAIT_MS,
  editSyncDelayMs,
  HIDDEN_REALTIME_CLOSE_MS,
  isDefinitiveSessionFailure,
  shouldSyncWhenVisible,
  SideSyncBackoff,
  sideSyncBackoffMs,
  syncRuntime,
  VISIBLE_RESYNC_AFTER_MS,
} from "../SyncRuntime";

const configuration: DesktopSyncConfiguration = {
  accountId: "request-usage-account",
  libraryId: "123e4567-e89b-42d3-a456-426614174014",
  deviceId: "123e4567-e89b-42d3-a456-426614174015",
  apiBaseUrl: "https://community.example",
  supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "sb_publishable_fixture",
  accessToken: "device-token-1",
  refreshToken: "refresh-1",
  expiresAt: Math.floor(Date.now() / 1000) + 3_600,
};

type Status = ReturnType<typeof syncRuntime.getStatus>;
type ChannelFixture = {
  handlers: Record<string, (message: { payload: unknown }) => void>;
  on: Mock;
  subscribe: Mock;
  callback?: (status: string) => void;
};
type RuntimeFixture = {
  started: boolean;
  status: Status;
  running: Promise<void> | null;
  channel: unknown;
  realtime: unknown;
  realtimeSubscribedAt: number;
  realtimeSuspended: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lastSuccessfulSyncAt: number;
  localEditCount: number;
  settledEditCount: number;
  pendingRealtimeHead: number;
  inactiveRefreshToken: string | null;
  syncNow: (automatic?: boolean) => Promise<void>;
  run: (configuration: DesktopSyncConfiguration, explicit?: boolean) => Promise<void>;
  stop: () => void;
  connectRealtime: (configuration: DesktopSyncConfiguration) => Promise<void>;
  ensureRealtime: (configuration: DesktopSyncConfiguration) => void;
  refreshIfNeeded: (configuration: DesktopSyncConfiguration) => Promise<DesktopSyncConfiguration>;
  scheduleRealtimeReconnect: (configuration: DesktopSyncConfiguration) => void;
  handleOutboxChanged: () => void;
  handleVisibilityChange: () => void;
  handleRemoteHead: (headCursor: number) => Promise<void>;
};

function newRuntime(): RuntimeFixture {
  const runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
  runtime.started = true;
  return runtime;
}

let visibility: DocumentVisibilityState = "visible";
function setVisibility(runtime: RuntimeFixture, next: DocumentVisibilityState) {
  visibility = next;
  runtime.handleVisibilityChange();
}

function realtimeClient() {
  const channels: ChannelFixture[] = [];
  const client = {
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel: vi.fn(() => {
      const channel: ChannelFixture = {
        handlers: {},
        on: vi.fn((_type: string, filter: { event: string }, handler: (message: { payload: unknown }) => void) => {
          channel.handlers[filter.event] = handler;
          return channel;
        }),
        subscribe: vi.fn((callback: (status: string) => void) => { channel.callback = callback; return channel; }),
      };
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn(async (channel: ChannelFixture) => { channel.callback?.("CLOSED"); }),
  };
  mocks.createClient.mockReset().mockReturnValue(client);
  return { client, channels };
}

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  setDesktopSyncConfiguration(configuration);
});

afterEach(() => {
  setDesktopSyncConfiguration(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("request scheduling helpers", () => {
  it("debounces edits by three seconds but never waits more than fifteen", () => {
    expect(editSyncDelayMs(1_000, 1_000)).toBe(EDIT_SYNC_DEBOUNCE_MS);
    expect(editSyncDelayMs(1_000, 1_000 + EDIT_SYNC_MAX_WAIT_MS - 2_000)).toBe(2_000);
    expect(editSyncDelayMs(1_000, 1_000 + EDIT_SYNC_MAX_WAIT_MS + 5_000)).toBe(0);
  });

  it("checks Community on return only when the live connection may have missed changes", () => {
    const healthy = { hiddenForMs: 60_000, realtimeSubscribed: true, msSinceLastSync: 60_000 };
    expect(shouldSyncWhenVisible(healthy)).toBe(false);
    expect(shouldSyncWhenVisible({ ...healthy, hiddenForMs: VISIBLE_RESYNC_AFTER_MS })).toBe(true);
    expect(shouldSyncWhenVisible({ ...healthy, realtimeSubscribed: false })).toBe(true);
    expect(shouldSyncWhenVisible({ ...healthy, msSinceLastSync: VISIBLE_RESYNC_AFTER_MS })).toBe(true);
  });

  it("backs failed optional backups off from one minute to at most an hour", () => {
    expect([1, 2, 3, 6, 7, 20].map((failures) => sideSyncBackoffMs(failures, () => 0))).toEqual([
      60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000,
    ]);
    expect(sideSyncBackoffMs(7, () => 1)).toBe(3_600_000);
    const backoff = new SideSyncBackoff(() => 0);
    expect(backoff.shouldRun(0)).toBe(true);
    backoff.failed(0);
    backoff.failed(0);
    expect(backoff.shouldRun(119_999)).toBe(false);
    expect(backoff.shouldRun(119_999, true)).toBe(true);
    expect(backoff.shouldRun(120_000)).toBe(true);
    backoff.succeeded();
    expect(backoff.shouldRun(0)).toBe(true);
  });

  it("treats only rejected sessions as needing a reconnect", () => {
    expect(isDefinitiveSessionFailure("session_inactive")).toBe(true);
    expect(isDefinitiveSessionFailure("device_revoked: This device session is no longer active")).toBe(true);
    expect(isDefinitiveSessionFailure("refresh_failed")).toBe(false);
    expect(isDefinitiveSessionFailure("authentication_required: Sign in to Community again to keep syncing")).toBe(false);
    expect(isDefinitiveSessionFailure("sync_unavailable: Changes are temporarily unavailable")).toBe(false);
  });
});

describe("edit-triggered sync", () => {
  let runtime: RuntimeFixture;
  let syncNow: Mock;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    runtime = newRuntime();
    runtime.status = "idle";
    syncNow = vi.fn(async () => { runtime.settledEditCount = runtime.localEditCount; runtime.status = "idle"; });
    runtime.syncNow = syncNow;
  });
  afterEach(() => runtime.stop());

  it("shows edits as saving immediately and backs them up once editing pauses", async () => {
    runtime.handleOutboxChanged();
    expect(runtime.status).toBe("syncing");
    await vi.advanceTimersByTimeAsync(2_000);
    runtime.handleOutboxChanged();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(syncNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(syncNow).toHaveBeenCalledWith(true);
    expect(runtime.status).toBe("idle");
  });

  it("backs up continuous editing at least every fifteen seconds", async () => {
    for (let second = 0; second < 20; second++) {
      runtime.handleOutboxChanged();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(Date.now() - 100_000).toBeGreaterThanOrEqual(EDIT_SYNC_MAX_WAIT_MS);
  });

  it("skips the follow-up when a sync already covered every edit", async () => {
    let finish!: () => void;
    runtime.running = new Promise<void>((resolve) => { finish = resolve; });
    runtime.status = "syncing";
    runtime.handleOutboxChanged();
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DEBOUNCE_MS);
    expect(syncNow).not.toHaveBeenCalled();
    // The running sync's final pass read the outbox after this edit.
    runtime.settledEditCount = runtime.localEditCount;
    runtime.running = null;
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncNow).not.toHaveBeenCalled();
    expect(runtime.status).toBe("idle");
  });

  it("does not claim to be saving while automatic retries are paused", async () => {
    runtime.status = "error";
    runtime.handleOutboxChanged();
    expect(runtime.status).toBe("error");
    runtime.status = "idle";
    (runtime as unknown as { automaticRetryNotBefore: number }).automaticRetryNotBefore = Date.now() + 60_000;
    runtime.handleOutboxChanged();
    expect(runtime.status).toBe("idle");
  });

  it("keeps edits safely queued when Spotify closes before the debounce", async () => {
    runtime.handleOutboxChanged();
    runtime.stop();
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_MAX_WAIT_MS);
    expect(syncNow).not.toHaveBeenCalled();
  });
});

describe("Realtime announcements", () => {
  let runtime: RuntimeFixture;
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await storageService.switchAccountDatabase()).toBe(true);
    runtime = newRuntime();
  });
  afterEach(() => {
    runtime.stop();
    indexedDBStorage.resetConnection();
  });

  async function writeCursor(cursor: number) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(getTagifyDatabaseName());
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SYNC_STORES.STATE, "readwrite");
      transaction.objectStore(SYNC_STORES.STATE).put({ key: "cursor", value: cursor });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  it("ignores this device's own backup announcements", async () => {
    const { channels } = realtimeClient();
    const handleRemoteHead = vi.fn(async () => undefined);
    runtime.handleRemoteHead = handleRemoteHead;
    await runtime.connectRealtime(configuration);
    const announce = channels[0].handlers.head_cursor;

    announce({ payload: { libraryId: configuration.libraryId, headCursor: 4, deviceId: configuration.deviceId } });
    announce({ payload: { libraryId: "another-library", headCursor: 4, deviceId: "another-device" } });
    expect(handleRemoteHead).not.toHaveBeenCalled();

    announce({ payload: { libraryId: configuration.libraryId, headCursor: 4, deviceId: "another-device" } });
    announce({ payload: { libraryId: configuration.libraryId, headCursor: 5 } });
    expect(handleRemoteHead.mock.calls).toEqual([[4], [5]]);
  });

  it("folds announcements during a sync into one follow-up only when Community is still ahead", async () => {
    let finishRun!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => { finishRun = resolve; }));
    runtime.run = run;
    runtime.ensureRealtime = vi.fn();
    const firstSync = runtime.syncNow(true);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    await runtime.handleRemoteHead(6);
    await runtime.handleRemoteHead(7);
    expect(runtime.pendingRealtimeHead).toBe(7);
    // The running sync's own pull reached the announced cursor.
    await writeCursor(7);
    finishRun();
    await firstSync;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run).toHaveBeenCalledTimes(1);

    const secondSync = runtime.syncNow(true);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await runtime.handleRemoteHead(8);
    await runtime.handleRemoteHead(9);
    finishRun();
    await secondSync;
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    finishRun();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("starts a sync for a newer cursor when nothing is running", async () => {
    await writeCursor(3);
    const syncNow = vi.fn(async () => undefined);
    runtime.syncNow = syncNow;
    await runtime.handleRemoteHead(3);
    expect(syncNow).not.toHaveBeenCalled();
    await runtime.handleRemoteHead(4);
    expect(syncNow).toHaveBeenCalledWith(true);
  });
});

describe("visibility and the live connection", () => {
  let runtime: RuntimeFixture;
  let syncNow: Mock;
  let ensureRealtime: Mock;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    runtime = newRuntime();
    syncNow = vi.fn(async () => undefined);
    ensureRealtime = vi.fn();
    runtime.syncNow = syncNow;
    runtime.ensureRealtime = ensureRealtime;
  });
  afterEach(() => runtime.stop());

  function healthyConnection() {
    const { client, channels } = realtimeClient();
    runtime.realtime = client;
    runtime.channel = client.channel();
    runtime.realtimeSubscribedAt = Date.now();
    runtime.lastSuccessfulSyncAt = Date.now();
    return { client, channel: channels[0] };
  }

  it("does not sync after a short absence while Realtime is healthy", async () => {
    healthyConnection();
    setVisibility(runtime, "hidden");
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility(runtime, "visible");
    expect(syncNow).not.toHaveBeenCalled();
  });

  it.each([
    ["Spotify was hidden for five minutes", (fixture: RuntimeFixture) => { void fixture; }, VISIBLE_RESYNC_AFTER_MS],
    ["Realtime is not subscribed", (fixture: RuntimeFixture) => { fixture.realtimeSubscribedAt = 0; }, 60_000],
    ["the last sync is old", (fixture: RuntimeFixture) => { fixture.lastSuccessfulSyncAt = Date.now() - VISIBLE_RESYNC_AFTER_MS; }, 60_000],
  ])("syncs on return when %s", async (_reason, prepare, hiddenFor) => {
    healthyConnection();
    prepare(runtime);
    setVisibility(runtime, "hidden");
    await vi.advanceTimersByTimeAsync(hiddenFor);
    setVisibility(runtime, "visible");
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("closes Realtime after ten hidden minutes and reconnects once with one catch-up sync", async () => {
    const { client, channel } = healthyConnection();
    setVisibility(runtime, "hidden");
    await vi.advanceTimersByTimeAsync(HIDDEN_REALTIME_CLOSE_MS - 1);
    expect(client.removeChannel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
    expect(runtime.channel).toBeNull();
    expect(runtime.realtimeSuspended).toBe(true);

    // A hint channel error while hidden does not start reconnecting.
    runtime.scheduleRealtimeReconnect(configuration);
    expect(runtime.reconnectTimer).toBeNull();

    setVisibility(runtime, "visible");
    setVisibility(runtime, "visible");
    expect(runtime.realtimeSuspended).toBe(false);
    expect(ensureRealtime).toHaveBeenCalledTimes(1);
    expect(syncNow).toHaveBeenCalledTimes(2);
    expect(syncNow).toHaveBeenNthCalledWith(1, true);
  });

  it("keeps Realtime open when Spotify returns within ten minutes", async () => {
    const { client } = healthyConnection();
    setVisibility(runtime, "hidden");
    await vi.advanceTimersByTimeAsync(HIDDEN_REALTIME_CLOSE_MS - 60_000);
    setVisibility(runtime, "visible");
    await vi.advanceTimersByTimeAsync(HIDDEN_REALTIME_CLOSE_MS);
    expect(client.removeChannel).not.toHaveBeenCalled();
    expect(runtime.realtimeSuspended).toBe(false);
  });
});

describe("Realtime session token", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("answers Realtime's token requests with the current device session, not the publishable key", async () => {
    realtimeClient();
    const runtime = newRuntime();
    await runtime.connectRealtime(configuration);
    const options = mocks.createClient.mock.calls[0][2] as { accessToken?: () => Promise<string>; auth?: unknown };
    expect(options.auth).toBeUndefined();
    expect(await options.accessToken?.()).toBe("device-token-1");

    setDesktopSyncConfiguration({ ...configuration, accessToken: "device-token-2", refreshToken: "refresh-2" });
    expect(await options.accessToken?.()).toBe("device-token-2");
    runtime.stop();
  });

  it("updates Realtime when a sync refreshes the session", async () => {
    const { client } = realtimeClient();
    const runtime = newRuntime();
    await runtime.connectRealtime(configuration);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).includes("/auth/v1/token")
      ? Response.json({ access_token: "device-token-3", refresh_token: "refresh-3", expires_at: Math.floor(Date.now() / 1000) + 3_600 })
      : Response.json({}));

    const next = await runtime.refreshIfNeeded({ ...configuration, expiresAt: Math.floor(Date.now() / 1000) });

    expect(next.accessToken).toBe("device-token-3");
    expect(client.realtime.setAuth).toHaveBeenLastCalledWith("device-token-3");
    runtime.stop();
  });
});

describe("rejected sessions", () => {
  let runtime: RuntimeFixture;
  const expired = { ...configuration, expiresAt: Math.floor(Date.now() / 1000) };
  beforeEach(() => {
    setDesktopSyncConfiguration(expired);
    runtime = newRuntime();
    runtime.status = "idle";
  });
  afterEach(() => runtime.stop());

  it("stops refreshing, polling, and reconnecting after Supabase rejects the refresh token", async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }, { status: 400 }));

    await expect(runtime.refreshIfNeeded(expired)).rejects.toThrow("session_inactive");
    expect(runtime.status).toBe("reauthorize");
    expect(request).toHaveBeenCalledTimes(1);

    await expect(runtime.refreshIfNeeded(expired)).rejects.toThrow("session_inactive");
    await runtime.syncNow(true);
    runtime.scheduleRealtimeReconnect(expired);
    runtime.ensureRealtime(expired);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(runtime.reconnectTimer).toBeNull();
    expect(runtime.status).toBe("reauthorize");
  });

  it("starts again once the device reconnects with a new session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ error_code: "session_not_found" }, { status: 401 }));
    await expect(runtime.refreshIfNeeded(expired)).rejects.toThrow("session_inactive");

    const reconnected = { ...expired, refreshToken: "refresh-after-reconnect" };
    setDesktopSyncConfiguration(reconnected);
    const run = vi.fn(async () => undefined);
    runtime.run = run;
    runtime.ensureRealtime = vi.fn();
    await runtime.syncNow(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying with back-off when the refresh only failed temporarily", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    await expect(runtime.refreshIfNeeded(expired)).rejects.toThrow("refresh_failed");
    expect(runtime.inactiveRefreshToken).toBeNull();
    expect(runtime.status).toBe("idle");
  });

  it("shares one refresh between sync and Realtime", async () => {
    let respond!: (response: Response) => void;
    const request = vi.spyOn(globalThis, "fetch").mockImplementation((input) => String(input).includes("/auth/v1/token")
      ? new Promise<Response>((resolve) => { respond = resolve; })
      : Promise.resolve(Response.json({})));
    const first = runtime.refreshIfNeeded(expired);
    const second = runtime.refreshIfNeeded(expired);
    respond(Response.json({ access_token: "fresh", refresh_token: "refresh-next", expires_at: Math.floor(Date.now() / 1000) + 3_600 }));
    expect((await first).accessToken).toBe("fresh");
    expect((await second).accessToken).toBe("fresh");
    expect(request.mock.calls.filter(([input]) => String(input).includes("/auth/v1/token"))).toHaveLength(1);
  });
});

describe("pulls in a backup run", () => {
  type BackupRuntime = RuntimeFixture & {
    capabilities: unknown;
    lastPullReachedHead: boolean;
    pull: (configuration: DesktopSyncConfiguration) => Promise<boolean>;
    push: (configuration: DesktopSyncConfiguration) => Promise<{ sent: number; accepted: number; confirmed: number; snapshot: boolean }>;
    pushDurableAppState: (configuration: DesktopSyncConfiguration) => Promise<void>;
    syncLocalFileBackup: (configuration: DesktopSyncConfiguration) => Promise<boolean>;
    settleLocalAndPublicSync: (configuration: DesktopSyncConfiguration, explicit?: boolean) => Promise<void>;
  };
  let runtime: BackupRuntime;

  async function syncStore(mode: IDBTransactionMode, store: string, work: (objectStore: IDBObjectStore) => void) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(getTagifyDatabaseName());
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      work(transaction.objectStore(store));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await storageService.switchAccountDatabase()).toBe(true);
    runtime = newRuntime() as BackupRuntime;
    runtime.capabilities = null;
    runtime.pushDurableAppState = vi.fn(async () => undefined);
    runtime.syncLocalFileBackup = vi.fn(async () => true);
    // The backup sends and confirms every queued edit.
    runtime.push = vi.fn(async () => {
      await syncStore("readwrite", SYNC_STORES.OUTBOX, (outbox) => outbox.clear());
      return { sent: 1, accepted: 1, confirmed: 1, snapshot: false };
    });
  });
  afterEach(() => {
    runtime.stop();
    indexedDBStorage.resetConnection();
  });

  async function queueEdit() {
    await syncStore("readwrite", SYNC_STORES.OUTBOX, (outbox) => outbox.put({
      id: "edit-1", batchId: "batch-1", createdAt: Date.now(), type: "entity.replace",
      entity: { provider: "spotify", kind: "track", providerId: "4uLU6hMCjMI75M1A2tKUQC" },
      desired: { rating: 4, energy: 0, bpm: null, key: null, tagIds: [] },
    }));
  }

  function pullsReaching(reachedHead: boolean) {
    const pull = vi.fn(async () => { runtime.lastPullReachedHead = reachedHead; return false; });
    runtime.pull = pull;
    return pull;
  }

  function liveRealtime() {
    runtime.channel = {};
    runtime.realtimeSubscribedAt = Date.now();
  }

  it("skips the final pull when the pull after the backup reached Community's newest cursor", async () => {
    await queueEdit();
    liveRealtime();
    const pull = pullsReaching(true);
    await runtime.settleLocalAndPublicSync(configuration);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(runtime.push).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Realtime is not connected", () => undefined, true],
    ["the pull after the backup stopped short of the newest cursor", liveRealtime, false],
    ["Realtime announced a newer change during the run", () => { liveRealtime(); runtime.pendingRealtimeHead = 9; }, true],
  ])("pulls again when %s", async (_reason, prepare, reachedHead) => {
    await queueEdit();
    prepare();
    const pull = pullsReaching(reachedHead);
    await runtime.settleLocalAndPublicSync(configuration);
    expect(pull).toHaveBeenCalledTimes(3);
  });

  it("always pulls when there was nothing to back up", async () => {
    liveRealtime();
    const pull = pullsReaching(true);
    await runtime.settleLocalAndPublicSync(configuration);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(runtime.push).not.toHaveBeenCalled();
  });

  it.each([
    ["an unchanged reply", { unchanged: true, headCursor: 0 }, true],
    ["every batch up to the newest cursor", { batches: [{ cursor: 3, batchId: "remote-3", committedAt: new Date().toISOString(), operations: [] }], headCursor: 3, conflicts: [] }, true],
    ["Community reporting a newer cursor without its changes", { batches: [], headCursor: 5, conflicts: [] }, false],
    ["a reply without a cursor", { batches: [], conflicts: [] }, false],
  ])("records whether a pull reached the newest cursor after %s", async (_label, body, reachedHead) => {
    const fresh = newRuntime() as BackupRuntime;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(body));
    await fresh.pull(configuration);
    expect(fresh.lastPullReachedHead).toBe(reachedHead);
    fresh.stop();
  });
});
