import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuration = {
  supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", refreshToken: "refresh",
  libraryId: "11111111-1111-4111-8111-111111111111", deviceId: "22222222-2222-4222-8222-222222222222", accountId: "account",
  apiBaseUrl: "https://community.example", expiresAt: 4_000_000_000,
};
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../SyncLocalState", async (original) => ({ ...(await original<typeof import("../SyncLocalState")>()), getDesktopSyncConfiguration: () => configuration }));
import { syncRuntime } from "../SyncRuntime";

type Handler = (message: { payload: unknown }) => void;
type RuntimeFixture = {
  started: boolean;
  capabilities: Record<string, unknown> | null;
  connectRealtime: (value: typeof configuration) => Promise<void>;
  refreshIfNeeded: (value: typeof configuration) => Promise<typeof configuration>;
  pollPlaylistWrites: () => void;
  playlistWrites: { pending: Promise<void> | null };
  stop: () => void;
};

const COMMUNITY_PLAYLIST = "33333333-3333-4333-8333-333333333333";
const NEW_PLAYLIST = "4uLU6hMCjMI75M1A2tKUQC";
const SONGS = ["0VjIjW4GlUZAMYd2vXMi3b", "7qiZfU4dY1lWllzX7mPBI3"];
const advertised = { playlistWrites: { path: "/api/v2/sync/playlist-writes", protocolVersion: 1, event: "playlist_write_request", maxClaim: 5, maxTracks: 500, claimSeconds: 120, pollMinutes: 15 } };

describe("keeping Community playlists in Spotify from the sync runtime", () => {
  let runtime: RuntimeFixture;
  let handlers: Map<string, Handler>;
  let contents: string[];
  const fetcher = vi.fn();
  const showNotification = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-20T18:00:00.000Z"));
    handlers = new Map();
    contents = [];
    type Channel = { on: (type: string, filter: { event: string }, handler: Handler) => Channel; subscribe: () => Channel };
    const channel: Channel = { on: (_type, filter, handler) => { handlers.set(filter.event, handler); return channel; }, subscribe: () => channel };
    mocks.createClient.mockReset().mockReturnValue({ realtime: { setAuth: vi.fn().mockResolvedValue(undefined) }, channel: vi.fn(() => channel), removeChannel: vi.fn() });
    let claimed = false;
    fetcher.mockReset().mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") {
        const playlists = claimed ? [] : [{ id: COMMUNITY_PLAYLIST, name: "Late night", description: "Made on Tagify Community from your tags.", spotifyPlaylistId: null, trackIds: SONGS, fingerprint: "0123456789abcdef" }];
        claimed = true;
        return new Response(JSON.stringify({ playlists }), { status: 200 });
      }
      return new Response(JSON.stringify({ finished: 1 }), { status: 200 });
    });
    showNotification.mockReset();
    // Spotify's desktop app, as far as creating and filling a private playlist goes.
    vi.stubGlobal("Spicetify", {
      ...globalThis.Spicetify,
      showNotification,
      Platform: {
        ...globalThis.Spicetify.Platform,
        RootlistAPI: { createPlaylist: vi.fn(async () => `spotify:playlist:${NEW_PLAYLIST}`), remove: vi.fn() },
        PlaylistPermissionsAPI: { setBasePermission: vi.fn(async () => undefined), getBasePermission: vi.fn(async () => "BLOCKED") },
        PlaylistAPI: {
          getMetadata: vi.fn(async () => ({ isOwnedBySelf: true, isSaved: true, canEditItems: true })),
          updateDetails: vi.fn(async () => undefined),
          getContents: vi.fn(async () => ({ items: contents.map((uri, index) => ({ uri, uid: `uid-${index}` })), totalLength: contents.length })),
          add: vi.fn(async (_uri: string, uris: string[]) => { contents.push(...uris); }),
          remove: vi.fn(),
        },
      },
    });
    vi.stubGlobal("fetch", fetcher);
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
    runtime.refreshIfNeeded = vi.fn(async () => configuration);
  });
  afterEach(() => { runtime.stop(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

  const settle = async () => { await vi.advanceTimersByTimeAsync(0); await runtime.playlistWrites.pending; await vi.advanceTimersByTimeAsync(0); };

  it("writes a playlist the member asked for on Community and reports it written", async () => {
    runtime.capabilities = advertised;
    await runtime.connectRealtime(configuration);
    runtime.pollPlaylistWrites();
    await settle();
    expect(contents).toEqual(SONGS.map((id) => `spotify:track:${id}`));
    const calls = fetcher.mock.calls.map(([url, init]) => [url, (init as RequestInit).method]);
    expect(calls).toEqual([
      ["https://community.example/api/v2/sync/playlist-writes", "POST"],
      ["https://community.example/api/v2/sync/playlist-writes", "PUT"],
    ]);
    expect(JSON.parse(String((fetcher.mock.calls[1][1] as RequestInit).body))).toEqual({
      deviceId: configuration.deviceId,
      results: [{ id: COMMUNITY_PLAYLIST, result: "written", spotifyPlaylistId: NEW_PLAYLIST, fingerprint: "0123456789abcdef" }],
    });
    expect(showNotification).toHaveBeenCalledWith("Added “Late night” from Tagify Community to your Spotify playlists.");

    // The member's next request is heard on the library's channel.
    handlers.get("playlist_write_request")!({ payload: { libraryId: configuration.libraryId } });
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(3);
    // Another library's request is not.
    handlers.get("playlist_write_request")!({ payload: { libraryId: "55555555-5555-4555-8555-555555555555" } });
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("asks Community nothing when it doesn't advertise playlist writes", async () => {
    runtime.capabilities = { liveSyncHints: true };
    await runtime.connectRealtime(configuration);
    runtime.pollPlaylistWrites();
    handlers.get("playlist_write_request")!({ payload: { libraryId: configuration.libraryId } });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
