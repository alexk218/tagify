import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { storageService } from "@/services/storage/StorageService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getTagifyDatabaseName, setDesktopSyncConfiguration, SYNC_STORES, type DesktopSyncConfiguration } from "../SyncLocalState";
import {
  EDIT_SESSION_GAP_MS,
  EDIT_SYNC_DEBOUNCE_MS,
  EDIT_SYNC_MAX_WAIT_MS,
  editSyncDelayMs,
  LONG_EDIT_SESSION_AFTER_MS,
  LONG_SESSION_EDIT_SYNC_DEBOUNCE_MS,
  LONG_SESSION_EDIT_SYNC_MAX_WAIT_MS,
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
  headConfirmedAt: number;
  realtimeWanted: boolean | null;
  capabilities: unknown;
  scheduleSafetySync: (restart?: boolean) => void;
  noteLiveSync: (response: unknown) => void;
  noteLibrarySummary: (summary: unknown) => void;
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
    const quiet = { hiddenForMs: 60_000, realtime: "quiet" as const, msSinceLastSync: 60_000 };
    expect(shouldSyncWhenVisible(quiet)).toBe(false);
    expect(shouldSyncWhenVisible({ ...quiet, hiddenForMs: VISIBLE_RESYNC_AFTER_MS })).toBe(true);
    expect(shouldSyncWhenVisible({ ...quiet, msSinceLastSync: VISIBLE_RESYNC_AFTER_MS })).toBe(true);
    expect(shouldSyncWhenVisible({ ...quiet, realtime: "down" })).toBe(true);
    // Every change since the last check was announced.
    expect(shouldSyncWhenVisible({ hiddenForMs: VISIBLE_RESYNC_AFTER_MS, realtime: "live", msSinceLastSync: 24 * 60 * 60_000 })).toBe(false);
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

  it("groups a long tagging session into fewer backups", async () => {
    // One edit every five seconds for an hour.
    for (let edit = 0; edit < 720; edit++) {
      runtime.handleOutboxChanged();
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await vi.advanceTimersByTimeAsync(LONG_SESSION_EDIT_SYNC_DEBOUNCE_MS);
    // Before: five seconds is a pause longer than the 3 s debounce, so every
    // edit was its own backup: 720 in the hour, three requests each.
    // After: the same during the first minute (12), then one a minute (59).
    expect(syncNow).toHaveBeenCalledTimes(71);
  });

  it("goes back to quick backups after a pause", async () => {
    for (let edit = 0; edit < 30; edit++) {
      runtime.handleOutboxChanged();
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await vi.advanceTimersByTimeAsync(EDIT_SESSION_GAP_MS);
    syncNow.mockClear();
    runtime.handleOutboxChanged();
    await vi.advanceTimersByTimeAsync(EDIT_SYNC_DEBOUNCE_MS);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("waits ten seconds of quiet, not three, once the session is long", () => {
    expect(editSyncDelayMs(100_000, 100_000, 100_000 - LONG_EDIT_SESSION_AFTER_MS)).toBe(LONG_SESSION_EDIT_SYNC_DEBOUNCE_MS);
    expect(editSyncDelayMs(100_000, 100_000 + LONG_SESSION_EDIT_SYNC_MAX_WAIT_MS - 4_000, 0)).toBe(4_000);
    expect(editSyncDelayMs(100_000, 100_000, 100_000 - LONG_EDIT_SESSION_AFTER_MS + 1)).toBe(EDIT_SYNC_DEBOUNCE_MS);
  });

  it("backs up waiting edits as soon as Spotify is hidden", async () => {
    runtime.handleOutboxChanged();
    setVisibility(runtime, "hidden");
    await vi.advanceTimersByTimeAsync(0);
    expect(syncNow).toHaveBeenCalledTimes(1);
    setVisibility(runtime, "visible");
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

  it("closes Realtime after two hidden minutes and reconnects once with one catch-up sync", async () => {
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

  it("keeps Realtime open when Spotify returns within two minutes", async () => {
    const { client } = healthyConnection();
    setVisibility(runtime, "hidden");
    await vi.advanceTimersByTimeAsync(HIDDEN_REALTIME_CLOSE_MS - 60_000);
    setVisibility(runtime, "visible");
    await vi.advanceTimersByTimeAsync(HIDDEN_REALTIME_CLOSE_MS);
    expect(client.removeChannel).not.toHaveBeenCalled();
    expect(runtime.realtimeSuspended).toBe(false);
  });
});

describe("safety checks while Spotify is open", () => {
  let runtime: RuntimeFixture;
  let syncNow: Mock;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0);
    runtime = newRuntime();
    syncNow = vi.fn(async () => undefined);
    runtime.syncNow = syncNow;
    runtime.ensureRealtime = vi.fn();
  });
  afterEach(() => { runtime.stop(); vi.useRealTimers(); });

  function liveConnection() {
    const { client, channels } = realtimeClient();
    runtime.realtime = client;
    runtime.channel = client.channel();
    runtime.realtimeSubscribedAt = Date.now();
    runtime.headConfirmedAt = Date.now();
    runtime.lastSuccessfulSyncAt = Date.now();
    return { client, channel: channels[0] };
  }

  async function threeHours(during?: (minute: number) => Promise<void>) {
    runtime.scheduleSafetySync(true);
    for (let minute = 0; minute < 180; minute++) {
      await during?.(minute);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    return syncNow.mock.calls.length;
  }

  it("before, and still while the live connection is down: every 5, 15, then 30 minutes", async () => {
    // Checks at 5, 20, 50, 80, 110, 140 and 170 minutes.
    expect(await threeHours()).toBe(7);
  });

  it("after: once in the first hour, then every 90 and 120 minutes while Realtime is live", async () => {
    liveConnection();
    // Checks at 60 and 150 minutes.
    expect(await threeHours()).toBe(2);
  });

  it("checks just as rarely for a library nobody else uses", async () => {
    runtime.realtimeWanted = false;
    expect(await threeHours()).toBe(2);
  });

  it("does not add or postpone checks when switching apps", async () => {
    liveConnection();
    // Away from Spotify for one minute in every ten. Before, each return
    // after five minutes since the last sync checked Community and restarted
    // the 5-minute ladder: about 18 checks in three hours.
    const checks = await threeHours(async (minute) => {
      if (minute % 10 === 0) setVisibility(runtime, "hidden");
      if (minute % 10 === 1) setVisibility(runtime, "visible");
    });
    expect(checks).toBe(2);
  });

  it("makes up a check that fell due while Spotify was hidden", async () => {
    liveConnection();
    runtime.scheduleSafetySync(true);
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    setVisibility(runtime, "hidden");
    // Within two minutes, so Realtime stays connected.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(syncNow).not.toHaveBeenCalled();
    setVisibility(runtime, "visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("shortens the next check when the live connection drops", async () => {
    const { channels } = realtimeClient();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runtime.realtimeWanted = true;
    await runtime.connectRealtime(configuration);
    channels[0].callback?.("SUBSCRIBED");
    // The catch-up check after joining found the device current.
    runtime.headConfirmedAt = Date.now();
    runtime.scheduleSafetySync(true);
    syncNow.mockClear();

    channels[0].callback?.("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(syncNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });
});

describe("whether to hold a live connection", () => {
  let runtime: RuntimeFixture;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000_000);
    runtime = newRuntime();
    runtime.syncNow = vi.fn(async () => undefined);
    runtime.capabilities = { liveSyncHints: true };
  });
  afterEach(() => { runtime.stop(); vi.useRealTimers(); });

  it("never opens one for a library used on one computer", async () => {
    realtimeClient();
    runtime.noteLiveSync({ unchanged: true, headCursor: 3, liveSync: { realtime: false } });
    runtime.ensureRealtime(configuration);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.createClient).not.toHaveBeenCalled();
    // Nothing to release when hidden, so nothing to catch up on when shown.
    setVisibility(runtime, "hidden");
    await vi.advanceTimersByTimeAsync(HIDDEN_REALTIME_CLOSE_MS);
    expect(runtime.realtimeSuspended).toBe(false);
  });

  it("opens one once another device or the website is in use, and closes it when they stop", async () => {
    const { client, channels } = realtimeClient();
    runtime.noteLiveSync({ liveSync: { realtime: true } });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.channel).toHaveBeenCalledTimes(1);
    runtime.noteLiveSync({ liveSync: { realtime: false } });
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(runtime.channel).toBeNull();
    // A late error from the closed channel does not reconnect it.
    runtime.scheduleRealtimeReconnect(configuration);
    expect(runtime.reconnectTimer).toBeNull();
  });

  it("checks once after joining, since earlier announcements were not heard", async () => {
    const { channels } = realtimeClient();
    runtime.realtimeWanted = true;
    runtime.headConfirmedAt = Date.now();
    await vi.advanceTimersByTimeAsync(1_000);
    await runtime.connectRealtime(configuration);
    channels[0].callback?.("SUBSCRIBED");
    expect(runtime.syncNow).toHaveBeenCalledTimes(1);
    // Once a check confirms the device is current, rejoining is needed again only after a drop.
    runtime.headConfirmedAt = Date.now();
    expect(runtime.headConfirmedAt).toBeGreaterThanOrEqual(runtime.realtimeSubscribedAt);
  });

  it("ignores hints Community did not advertise", () => {
    runtime.capabilities = {};
    runtime.noteLiveSync({ liveSync: { realtime: false } });
    expect(runtime.realtimeWanted).toBeNull();
  });

  it("uses the device count from an older Community, and only to skip a certainly idle connection", () => {
    runtime.capabilities = {};
    runtime.noteLibrarySummary({ devices: 1 });
    expect(runtime.realtimeWanted).toBe(false);
    runtime.noteLibrarySummary({ devices: 2 });
    expect(runtime.realtimeWanted).toBe(true);
    runtime.noteLibrarySummary({});
    expect(runtime.realtimeWanted).toBe(true);
    // Community's own hint wins over the count.
    runtime.capabilities = { liveSyncHints: true };
    runtime.noteLibrarySummary({ devices: 1 });
    expect(runtime.realtimeWanted).toBe(true);
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
