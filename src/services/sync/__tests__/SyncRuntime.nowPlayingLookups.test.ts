import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../SyncLocalState", async (original) => ({ ...(await original<typeof import("../SyncLocalState")>()), getDesktopSyncConfiguration: () => configuration }));
import { NOW_PLAYING_LOOKUP_REQUEST_EVENT } from "../CommunityNowPlayingLookups";
import { SPOTIFY_SEARCH_LOOKUP_REQUEST_EVENT } from "../CommunitySpotifySearchLookups";
import { syncRuntime } from "../SyncRuntime";

type Handler = (message: { payload: unknown }) => void;
type RuntimeFixture = {
  started: boolean;
  connectRealtime: (value: typeof configuration) => Promise<void>;
  nowPlayingLookups: { nudge: () => void };
  spotifySearchLookups: { nudge: () => void };
  stop: () => void;
};

describe("hearing Now playing lookups on the library channel", () => {
  let runtime: RuntimeFixture;
  let handlers: Map<string, Handler>;

  beforeEach(() => {
    handlers = new Map();
    type Channel = { on: (type: string, filter: { event: string }, handler: Handler) => Channel; subscribe: () => Channel };
    const channel: Channel = { on: (_type, filter, handler) => { handlers.set(filter.event, handler); return channel; }, subscribe: () => channel };
    mocks.createClient.mockReset().mockReturnValue({ realtime: { setAuth: vi.fn().mockResolvedValue(undefined) }, channel: vi.fn(() => channel), removeChannel: vi.fn() });
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
  });
  afterEach(() => { runtime.stop(); vi.restoreAllMocks(); });

  it("asks the lookups lane to look now when Community announces a request", async () => {
    const nudge = vi.spyOn(runtime.nowPlayingLookups, "nudge");
    await runtime.connectRealtime(configuration);
    expect(NOW_PLAYING_LOOKUP_REQUEST_EVENT).toBe("now_playing_lookup_request");
    handlers.get(NOW_PLAYING_LOOKUP_REQUEST_EVENT)!({ payload: { requestedAt: "2026-11-13T12:00:00.000Z" } });
    expect(nudge).toHaveBeenCalledTimes(1);
    handlers.get(NOW_PLAYING_LOOKUP_REQUEST_EVENT)!({ payload: { libraryId: configuration.libraryId, requestedAt: "2026-11-13T12:00:01.000Z" } });
    expect(nudge).toHaveBeenCalledTimes(2);
    // An announcement naming another library is not this desktop's.
    handlers.get(NOW_PLAYING_LOOKUP_REQUEST_EVENT)!({ payload: { libraryId: "55555555-5555-4555-8555-555555555555" } });
    expect(nudge).toHaveBeenCalledTimes(2);
  });

  it("asks the Spotify search lane to look now when Community announces a search", async () => {
    const nudge = vi.spyOn(runtime.spotifySearchLookups, "nudge");
    const nowPlaying = vi.spyOn(runtime.nowPlayingLookups, "nudge");
    await runtime.connectRealtime(configuration);
    expect(SPOTIFY_SEARCH_LOOKUP_REQUEST_EVENT).toBe("spotify_search_lookup_request");
    handlers.get(SPOTIFY_SEARCH_LOOKUP_REQUEST_EVENT)!({ payload: { libraryId: configuration.libraryId, requestedAt: "2026-11-24T12:00:00.000Z" } });
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(nowPlaying).not.toHaveBeenCalled();
    handlers.get(SPOTIFY_SEARCH_LOOKUP_REQUEST_EVENT)!({ payload: { libraryId: "55555555-5555-4555-8555-555555555555" } });
    expect(nudge).toHaveBeenCalledTimes(1);
  });
});
