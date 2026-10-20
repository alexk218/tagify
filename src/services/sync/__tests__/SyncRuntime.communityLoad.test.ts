import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { getDesktopSyncConfiguration, SESSION_REFRESH_AHEAD_MS, setDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import {
  LIVE_SYNC_HINT_MAX_AGE_MS,
  LIVE_SYNC_HINT_PREFIX,
  liveSyncHint,
  REALTIME_JOIN_WAIT_MS,
  sessionExpiresAt,
  syncRuntime,
} from "../SyncRuntime";

// Requests Tagify used to send that Community did not need (production audit,
// October 18-19, 2026): a second pull whenever Realtime joined, and a Realtime
// channel closed every hour because its session expired.

const NOW = 1_800_000_000_000;
const configuration: DesktopSyncConfiguration = {
  accountId: "community-load-account",
  libraryId: "123e4567-e89b-42d3-a456-426614174034",
  deviceId: "123e4567-e89b-42d3-a456-426614174035",
  apiBaseUrl: "https://community.example",
  supabaseUrl: "https://supabase.example",
  supabasePublishableKey: "sb_publishable_fixture",
  accessToken: "device-token-1",
  refreshToken: "refresh-1",
  expiresAt: NOW / 1_000 + 3_600,
};

type ChannelFixture = { on: Mock; subscribe: Mock; callback?: (status: string) => void };
type RuntimeFixture = {
  started: boolean;
  channel: unknown;
  realtimeWanted: boolean | null;
  realtimeSuspended: boolean;
  headConfirmedAt: number;
  capabilities: unknown;
  start: () => void;
  stop: () => void;
  run: (configuration: DesktopSyncConfiguration, explicit?: boolean) => Promise<void>;
  syncNow: (automatic?: boolean) => Promise<void>;
  ensureRealtime: (configuration: DesktopSyncConfiguration) => void;
  connectRealtime: (configuration: DesktopSyncConfiguration) => Promise<void>;
  refreshIfNeeded: (configuration: DesktopSyncConfiguration) => Promise<DesktopSyncConfiguration>;
  noteLiveSync: (response: unknown) => void;
  handleVisibilityChange: () => void;
  communityRequest: (path: string) => Promise<unknown>;
};

function newRuntime(started = true): RuntimeFixture {
  const runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
  runtime.started = started;
  return runtime;
}

function realtimeClient() {
  const channels: ChannelFixture[] = [];
  const client = {
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel: vi.fn(() => {
      const channel: ChannelFixture = {
        on: vi.fn(() => channel),
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

let visibility: DocumentVisibilityState = "visible";
let runtimes: RuntimeFixture[] = [];
const track = (runtime: RuntimeFixture) => { runtimes.push(runtime); return runtime; };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, "random").mockReturnValue(0);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  localStorage.clear();
  setDesktopSyncConfiguration(configuration);
});

afterEach(() => {
  runtimes.forEach((runtime) => runtime.stop());
  runtimes = [];
  delete window.TagifySync;
  setDesktopSyncConfiguration(null);
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A run that confirms this device is current, as a pull that reaches the head does. */
function countingRun(runtime: RuntimeFixture) {
  const run = vi.fn(async () => { runtime.headConfirmedAt = Date.now(); });
  runtime.run = run;
  runtime.refreshIfNeeded = vi.fn(async (value: DesktopSyncConfiguration) => value);
  return run;
}

describe("one pull per sync when Realtime joins", () => {
  it("joins first and pulls once when a sync starts while the live connection opens", async () => {
    const { channels } = realtimeClient();
    const runtime = track(newRuntime());
    runtime.realtimeWanted = true;
    const run = countingRun(runtime);

    const sync = runtime.syncNow(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(channels).toHaveLength(1);
    // Before: the pull went out now, and the join asked for a second one.
    expect(run).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 400);
    channels[0].callback?.("SUBSCRIBED");
    await sync;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("still pulls once when the join answers before the sync has its account lock", async () => {
    // Spotify grants navigator.locks asynchronously; a quick join can answer first.
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: (_name: string, _options: unknown, callback: () => Promise<unknown>) => new Promise((resolve) => setTimeout(resolve, 20)).then(callback) },
    });
    try {
      const { channels } = realtimeClient();
      const runtime = track(newRuntime());
      runtime.realtimeWanted = true;
      const run = countingRun(runtime);

      const sync = runtime.syncNow(true);
      await vi.advanceTimersByTimeAsync(0);
      channels[0].callback?.("SUBSCRIBED");
      await vi.advanceTimersByTimeAsync(20);
      await sync;
      await vi.advanceTimersByTimeAsync(1_000);
      // Before this fix: the join asked for a catch-up as well, so two pulls.
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it("joins before the first pull at startup when Community said recently that someone else is active", async () => {
    localStorage.setItem(`${LIVE_SYNC_HINT_PREFIX}${configuration.libraryId}`, JSON.stringify({ realtime: true, at: NOW - 2 * 60 * 60_000 }));
    const { channels } = realtimeClient();
    const runtime = track(newRuntime(false));
    const run = countingRun(runtime);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(channels).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 400);
    channels[0].callback?.("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("pulls first when the hint is older than three hours, then joins and checks once", async () => {
    localStorage.setItem(`${LIVE_SYNC_HINT_PREFIX}${configuration.libraryId}`, JSON.stringify({ realtime: true, at: NOW - LIVE_SYNC_HINT_MAX_AGE_MS }));
    const { channels } = realtimeClient();
    const runtime = track(newRuntime(false));
    const run = countingRun(runtime);

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(1);
    vi.setSystemTime(Date.now() + 400);
    channels[0].callback?.("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never opens a connection at startup when Community said recently that nobody else is active", async () => {
    localStorage.setItem(`${LIVE_SYNC_HINT_PREFIX}${configuration.libraryId}`, JSON.stringify({ realtime: false, at: NOW - 60_000 }));
    const { channels } = realtimeClient();
    const runtime = track(newRuntime(false));
    const run = countingRun(runtime);

    runtime.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(0);
  });

  it("keeps Community's hint per library for the next start, saving an unchanged one at most every 15 minutes", () => {
    const runtime = track(newRuntime());
    runtime.capabilities = { liveSyncHints: true };
    runtime.ensureRealtime = vi.fn();
    const savedAt = () => JSON.parse(localStorage.getItem(`${LIVE_SYNC_HINT_PREFIX}${configuration.libraryId}`) || "{}").at;

    runtime.noteLiveSync({ unchanged: true, headCursor: 1, liveSync: { realtime: true } });
    expect(liveSyncHint(configuration.libraryId)).toBe(true);
    expect(savedAt()).toBe(NOW);
    vi.setSystemTime(Date.now() + 14 * 60_000);
    runtime.noteLiveSync({ unchanged: true, headCursor: 1, liveSync: { realtime: true } });
    expect(savedAt()).toBe(NOW);
    vi.setSystemTime(Date.now() + 60_000);
    runtime.noteLiveSync({ unchanged: true, headCursor: 1, liveSync: { realtime: true } });
    expect(savedAt()).toBe(NOW + 15 * 60_000);
    // A change is saved at once.
    runtime.noteLiveSync({ unchanged: true, headCursor: 1, liveSync: { realtime: false } });
    expect(liveSyncHint(configuration.libraryId)).toBe(false);
    expect(liveSyncHint("another-library")).toBeNull();
    expect(liveSyncHint(configuration.libraryId, Date.now() + LIVE_SYNC_HINT_MAX_AGE_MS)).toBeNull();
  });

  it("lets a sync go after ten seconds when the join doesn't answer, and checks once when it does", async () => {
    const { channels } = realtimeClient();
    const runtime = track(newRuntime());
    runtime.realtimeWanted = true;
    const run = countingRun(runtime);

    const sync = runtime.syncNow(true);
    await vi.advanceTimersByTimeAsync(REALTIME_JOIN_WAIT_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await sync;
    expect(run).toHaveBeenCalledTimes(1);

    // That pull came before the join, so announcements in between weren't heard.
    vi.setSystemTime(Date.now() + 400);
    channels[0].callback?.("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("lets a waiting sync go at once when the join fails", async () => {
    const { channels } = realtimeClient();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = track(newRuntime());
    runtime.realtimeWanted = true;
    const run = countingRun(runtime);

    const sync = runtime.syncNow(true);
    await vi.advanceTimersByTimeAsync(0);
    channels[0].callback?.("CHANNEL_ERROR");
    await sync;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("returns from another app with one sync after Realtime was released", async () => {
    const { channels } = realtimeClient();
    const runtime = track(newRuntime());
    runtime.realtimeWanted = true;
    const run = countingRun(runtime);
    runtime.realtimeSuspended = true;
    visibility = "hidden";
    runtime.handleVisibilityChange();
    vi.setSystemTime(Date.now() + 10 * 60_000);

    visibility = "visible";
    runtime.handleVisibilityChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 400);
    channels[0].callback?.("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(1_000);
    // Before: a sync at once, and a second one when the channel joined.
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("refreshing the session before it expires", () => {
  const nowSeconds = () => Math.floor(Date.now() / 1_000);
  function refreshAnswers() {
    let issued = 1;
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (!String(input).includes("/auth/v1/token")) return Response.json({ error: { code: "not_found" } }, { status: 404 });
      issued++;
      return Response.json({ access_token: `device-token-${issued}`, refresh_token: `refresh-${issued}`, expires_at: nowSeconds() + 3_600, expires_in: 3_600 });
    });
    const refreshes = () => request.mock.calls.filter(([input]) => String(input).includes("/auth/v1/token")).length;
    return { request, refreshes };
  }

  it("refreshes five minutes before expiry while Realtime holds the session, so the channel is never closed", async () => {
    const { client, channels } = realtimeClient();
    const { refreshes } = refreshAnswers();
    const runtime = track(newRuntime());
    runtime.syncNow = vi.fn(async () => undefined);
    runtime.realtimeWanted = true;
    await runtime.connectRealtime(configuration);
    channels[0].callback?.("SUBSCRIBED");

    await vi.advanceTimersByTimeAsync(60 * 60_000 - SESSION_REFRESH_AHEAD_MS - 1);
    expect(refreshes()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshes()).toBe(1);
    expect(getDesktopSyncConfiguration()?.accessToken).toBe("device-token-2");
    expect(client.realtime.setAuth).toHaveBeenLastCalledWith("device-token-2");

    // Each new session is refreshed the same way, without a new join.
    await vi.advanceTimersByTimeAsync(60 * 60_000 - SESSION_REFRESH_AHEAD_MS);
    expect(refreshes()).toBe(2);
    expect(client.channel).toHaveBeenCalledTimes(1);
  });

  it("leaves the session alone without a live connection; requests refresh it themselves", async () => {
    const { refreshes } = refreshAnswers();
    const runtime = track(newRuntime());

    await runtime.refreshIfNeeded({ ...configuration, expiresAt: nowSeconds() + 60 });
    expect(refreshes()).toBe(1);
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(refreshes()).toBe(1);
  });

  it("stops the early refresh once the channel closes", async () => {
    const { channels } = realtimeClient();
    const { refreshes } = refreshAnswers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = track(newRuntime());
    runtime.syncNow = vi.fn(async () => undefined);
    runtime.realtimeWanted = true;
    await runtime.connectRealtime(configuration);
    channels[0].callback?.("SUBSCRIBED");
    runtime.capabilities = { liveSyncHints: true };
    runtime.noteLiveSync({ liveSync: { realtime: false } });

    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(refreshes()).toBe(0);
  });

  it("refreshes a session within five minutes of expiring, not only in its last minute", async () => {
    const { refreshes } = refreshAnswers();
    const runtime = track(newRuntime());

    await runtime.refreshIfNeeded({ ...configuration, expiresAt: nowSeconds() + 6 * 60 });
    expect(refreshes()).toBe(0);
    await runtime.refreshIfNeeded({ ...configuration, expiresAt: nowSeconds() + 4 * 60 });
    expect(refreshes()).toBe(1);
  });

  it("counts a refreshed session's lifetime from now when this device's clock is behind", () => {
    // Supabase's clock is ten minutes ahead of this device's.
    expect(sessionExpiresAt({ expires_at: Math.floor(NOW / 1_000) + 600 + 3_600, expires_in: 3_600 }, NOW)).toBe(Math.floor(NOW / 1_000) + 3_600);
    // And ten minutes behind: Supabase's own expiry comes first.
    expect(sessionExpiresAt({ expires_at: Math.floor(NOW / 1_000) - 600 + 3_600, expires_in: 3_600 }, NOW)).toBe(Math.floor(NOW / 1_000) - 600 + 3_600);
    expect(sessionExpiresAt({ expires_at: Math.floor(NOW / 1_000) + 3_600 }, NOW)).toBe(Math.floor(NOW / 1_000) + 3_600);
    expect(sessionExpiresAt({}, NOW)).toBe(Math.floor(NOW / 1_000) + 3_600);
  });

  it("refreshes a session Community refused before its expiry instead of sending it again", async () => {
    const { request, refreshes } = refreshAnswers();
    request.mockImplementationOnce(async () => Response.json({ error: { code: "authentication_required", message: "Sign in to Community again to keep syncing" } }, { status: 401 }));
    const runtime = track(newRuntime());

    await expect(runtime.communityRequest("/api/v2/device/profile")).rejects.toMatchObject({ status: 401 });
    expect(refreshes()).toBe(0);
    await runtime.refreshIfNeeded(getDesktopSyncConfiguration()!);
    expect(refreshes()).toBe(1);
    // The new session is used as normal.
    await runtime.refreshIfNeeded(getDesktopSyncConfiguration()!);
    expect(refreshes()).toBe(1);
  });
});
