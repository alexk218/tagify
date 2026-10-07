import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { syncRuntime } from "../SyncRuntime";

const configuration = { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", libraryId: "library" };

describe("realtime reconnect lifecycle", () => {
  type RuntimeFixture = {
    started: boolean;
    connectRealtime: (value: typeof configuration) => Promise<void>;
    refreshIfNeeded: (value: typeof configuration) => Promise<typeof configuration>;
    stop: () => void;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
  };
  type ChannelFixture = {
    on: Mock<[], ChannelFixture>;
    subscribe: Mock<[(status: string) => void], ChannelFixture>;
    callback?: (status: string) => void;
  };
  let runtime: RuntimeFixture;
  let callbacks: ((status: string) => void)[];
  let client: {
    realtime: { setAuth: Mock<[string], Promise<void>> };
    channel: Mock<[], ChannelFixture>;
    removeChannel: Mock<[ChannelFixture], Promise<void>>;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.spyOn(Math, "random").mockReturnValue(0);
    callbacks = [];
    client = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn(() => {
        const channel: ChannelFixture = { on: vi.fn(() => channel), subscribe: vi.fn((callback: (status: string) => void) => { callbacks.push(callback); channel.callback = callback; return channel; }) };
        return channel;
      }),
      removeChannel: vi.fn(async (channel: ChannelFixture) => { channel.callback?.("CLOSED"); }),
    };
    mocks.createClient.mockReset().mockReturnValue(client);
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
    runtime.refreshIfNeeded = vi.fn(async () => configuration);
  });
  afterEach(() => { runtime.stop(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("ignores closed callbacks from removed channels and reuses the client", async () => {
    await runtime.connectRealtime(configuration);
    callbacks[0]("SUBSCRIBED");
    callbacks[0]("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.channel).toHaveBeenCalledTimes(2);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.channel).toHaveBeenCalledTimes(2);
    callbacks[1]("SUBSCRIBED");
    callbacks[1]("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(client.channel).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.channel).toHaveBeenCalledTimes(3);
  });

  it("coalesces connections while auth is pending and does not connect after stopping", async () => {
    let release!: () => void;
    client.realtime.setAuth.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    const pending = runtime.connectRealtime(configuration);
    await runtime.connectRealtime(configuration);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    runtime.stop();
    release();
    await pending;
    expect(client.channel).not.toHaveBeenCalled();
    expect(runtime.reconnectTimer).toBeNull();
  });
});
