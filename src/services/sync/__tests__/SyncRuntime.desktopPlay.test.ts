import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../SyncLocalState", async (original) => ({ ...(await original<typeof import("../SyncLocalState")>()), getDesktopSyncConfiguration: () => configuration }));
import { desktopFeatures, syncRuntime } from "../SyncRuntime";

type Handler = (message: { payload: unknown }) => void;
type RuntimeFixture = {
  started: boolean;
  capabilities: Record<string, unknown> | null;
  connectRealtime: (value: typeof configuration) => Promise<void>;
  refreshIfNeeded: (value: typeof configuration) => Promise<typeof configuration>;
  noteLiveSync: (response: unknown) => void;
  scheduleRealtimeSuspend: () => void;
  realtimeSuspendTimer: ReturnType<typeof setTimeout> | null;
  realtimeWanted: boolean | null;
  stop: () => void;
};

describe("playing songs pressed on Community", () => {
  let runtime: RuntimeFixture;
  let handlers: Map<string, Handler>;
  const playUri = vi.fn();
  const fetcher = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-19T18:00:00.000Z"));
    handlers = new Map();
    type Channel = { on: (type: string, filter: { event: string }, handler: Handler) => Channel; subscribe: () => Channel };
    const channel: Channel = {
      on: (_type, filter, handler) => { handlers.set(filter.event, handler); return channel; },
      subscribe: () => channel,
    };
    mocks.createClient.mockReset().mockReturnValue({ realtime: { setAuth: vi.fn().mockResolvedValue(undefined) }, channel: vi.fn(() => channel), removeChannel: vi.fn() });
    playUri.mockReset().mockResolvedValue(undefined);
    fetcher.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("Spicetify", { Player: { playUri }, showNotification: vi.fn() });
    vi.stubGlobal("fetch", fetcher);
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
    runtime.refreshIfNeeded = vi.fn(async () => configuration);
  });
  afterEach(() => { runtime.stop(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("plays the song Community asked this computer for, once, and answers", async () => {
    await runtime.connectRealtime(configuration);
    const ask = handlers.get("desktop_play_request")!;
    const payload = { libraryId: configuration.libraryId, deviceId: configuration.deviceId, requestId: "33333333-3333-4333-8333-333333333333", trackId: "4uLU6hMCjMI75M1A2tKUQC", requestedAt: "2026-10-19T17:59:59.000Z" };
    ask({ payload });
    ask({ payload });
    await vi.advanceTimersByTimeAsync(0);
    expect(playUri).toHaveBeenCalledTimes(1);
    expect(playUri).toHaveBeenCalledWith("spotify:track:4uLU6hMCjMI75M1A2tKUQC");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://community.example/api/v2/sync/desktop-play");
    expect(JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))).toMatchObject({ requestId: payload.requestId, outcome: "played" });
  });

  it("leaves another computer's request alone", async () => {
    await runtime.connectRealtime(configuration);
    handlers.get("desktop_play_request")!({ payload: { libraryId: configuration.libraryId, deviceId: "44444444-4444-4444-8444-444444444444", requestId: "33333333-3333-4333-8333-333333333333", trackId: "4uLU6hMCjMI75M1A2tKUQC", requestedAt: "2026-10-19T17:59:59.000Z" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(playUri).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("tells Community it can play songs only when this Spotify can play by URI", () => {
    const library = { LibraryAPI: { add: () => undefined, contains: () => undefined, getTracks: () => undefined }, RootlistAPI: { getContents: () => undefined }, PlaylistAPI: { getContents: () => undefined } };
    expect(desktopFeatures(library, { playUri: () => undefined })).toEqual(["spotifyLists", "spotifySaves", "desktopPlay"]);
    expect(desktopFeatures({}, { playUri: () => undefined })).toEqual(["desktopPlay"]);
    expect(desktopFeatures({}, {})).toEqual([]);
  });

  it("keeps listening while Spotify is hidden when Community says the member plays from there", () => {
    runtime.capabilities = { liveSyncHints: true };
    runtime.realtimeWanted = true;
    runtime.scheduleRealtimeSuspend();
    expect(runtime.realtimeSuspendTimer).not.toBeNull();
    runtime.noteLiveSync({ liveSync: { realtime: true, listenWhileHidden: true } });
    expect(runtime.realtimeSuspendTimer).toBeNull();
    runtime.scheduleRealtimeSuspend();
    expect(runtime.realtimeSuspendTimer).toBeNull();
    // Once the member stops playing from Community, a hidden Spotify lets the channel go again.
    runtime.noteLiveSync({ liveSync: { realtime: true, listenWhileHidden: false } });
    runtime.scheduleRealtimeSuspend();
    expect(runtime.realtimeSuspendTimer).not.toBeNull();
  });
});
