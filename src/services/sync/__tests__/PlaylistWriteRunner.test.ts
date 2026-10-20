import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canWritePlaylists,
  localCreatedPlaylists,
  playlistWriteNotice,
  playlistWritesCapability,
  PlaylistWriteScheduler,
  readPlaylistClaim,
  runPlaylistWrites,
  type CreatedPlaylists,
  type PlaylistWriter,
  type PlaylistWriteRun,
  type PlaylistWritesCapability,
} from "../PlaylistWriteRunner";
import { desktopFeatures } from "../SyncRuntime";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const entity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const trackId = (n: number) => `T${String(n).padStart(21, "0")}`;
const spotifyId = (n: number) => `P${String(n).padStart(21, "0")}`;
const session = async () => ({ apiBaseUrl: "https://community.example", accessToken: "token", deviceId: DEVICE });
const capability: PlaylistWritesCapability = { path: "/api/v2/sync/playlist-writes", maxClaim: 5, pollMinutes: 15 };
const advertised = {
  playlistWrites: { path: "/api/v2/sync/playlist-writes", protocolVersion: 1, event: "playlist_write_request", maxClaim: 5, maxTracks: 500, claimSeconds: 120, pollMinutes: 15 },
};

function playlist(n: number, overrides: Record<string, unknown> = {}) {
  return { id: entity(n), name: `Playlist ${n}`, description: "Made on Tagify Community from your tags.", spotifyPlaylistId: null, trackIds: [trackId(1), trackId(2)], fingerprint: "0123456789abcdef", ...overrides };
}

/** Spotify's desktop playlists, as the runner sees and changes them. */
function spotify(options: { gone?: string[]; createFails?: unknown; replaceFails?: unknown } = {}) {
  const playlists = new Map<string, { name: string; description: string; uris: string[] }>();
  let created = 0;
  const writer: PlaylistWriter = {
    createPrivatePlaylist: vi.fn(async (name: string, description: string) => {
      if (options.createFails) throw options.createFails;
      const id = spotifyId(++created);
      playlists.set(id, { name, description, uris: [] });
      return id;
    }),
    ownPlaylistState: vi.fn(async (id: string) => (options.gone?.includes(id) || !playlists.has(id) ? "gone" as const : "mine" as const)),
    updatePlaylistDetails: vi.fn(async (id: string, details: { name: string; description: string }) => {
      Object.assign(playlists.get(id)!, details);
    }),
    replacePlaylistTracks: vi.fn(async (id: string, uris: string[]) => {
      if (options.replaceFails) throw options.replaceFails;
      playlists.get(id)!.uris = [...uris];
    }),
  };
  return { playlists, writer };
}

function memoryCreated(): CreatedPlaylists & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (id) => map.get(id) ?? null, set: (id, value) => { map.set(id, value); }, delete: (id) => { map.delete(id); } };
}

/** A Community that hands out `queue` in claims and records each report. */
function community(queue: unknown[], options: { claim?: () => Response; finish?: () => Response } = {}) {
  const reports: Array<Array<Record<string, unknown>>> = [];
  const request = vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).pathname).toBe("/api/v2/sync/playlist-writes");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.deviceId).toBe(DEVICE);
    if (init.method === "POST") {
      if (options.claim) return options.claim();
      return new Response(JSON.stringify({ playlists: queue.splice(0, 5) }), { status: 200 });
    }
    if (options.finish) return options.finish();
    reports.push(body.results as Array<Record<string, unknown>>);
    return new Response(JSON.stringify({ finished: (body.results as unknown[]).length }), { status: 200 });
  });
  return { reports, request: request as unknown as typeof fetch, calls: request };
}

describe("Keeping Community playlists in Spotify", () => {
  it("is reported only when Spotify's desktop app can create and change playlists", () => {
    const platform = {
      RootlistAPI: { createPlaylist: () => undefined, remove: () => undefined },
      PlaylistAPI: { add: () => undefined, remove: () => undefined, getContents: () => undefined, getMetadata: () => undefined, updateDetails: () => undefined },
      PlaylistPermissionsAPI: { setBasePermission: () => undefined, getBasePermission: () => undefined },
    };
    expect(canWritePlaylists(platform)).toBe(true);
    expect(canWritePlaylists({ ...platform, PlaylistPermissionsAPI: {} })).toBe(false);
    expect(canWritePlaylists({})).toBe(false);
    expect(desktopFeatures(platform, {})).toEqual(["playlistWrites"]);
    expect(desktopFeatures({}, {})).toEqual([]);
  });

  it("reads Community's capability only for this protocol, and never polls faster than 15 minutes", () => {
    expect(playlistWritesCapability(advertised)).toEqual(capability);
    expect(playlistWritesCapability({ playlistWrites: { ...advertised.playlistWrites, pollMinutes: 1 } })?.pollMinutes).toBe(15);
    expect(playlistWritesCapability({ playlistWrites: { ...advertised.playlistWrites, protocolVersion: 2 } })).toBeNull();
    expect(playlistWritesCapability({ playlistWrites: { ...advertised.playlistWrites, path: "https://elsewhere.example/x" } })).toBeNull();
    expect(playlistWritesCapability({})).toBeNull();
    expect(playlistWritesCapability(null)).toBeNull();
  });

  it("creates a private playlist with the songs in order for a new one", async () => {
    const { playlists, writer } = spotify();
    const created = memoryCreated();
    const songs = [trackId(3), trackId(1), trackId(2)];
    const { reports, request } = community([playlist(1, { trackIds: songs })]);
    const run = await runPlaylistWrites(session, writer, capability, created, request);
    expect(run).toEqual({ written: 1, failed: 0, created: ["Playlist 1"] });
    expect(writer.createPrivatePlaylist).toHaveBeenCalledWith("Playlist 1", "Made on Tagify Community from your tags.");
    expect(playlists.get(spotifyId(1))!.uris).toEqual(songs.map((id) => `spotify:track:${id}`));
    expect(reports).toEqual([[{ id: entity(1), result: "written", spotifyPlaylistId: spotifyId(1), fingerprint: "0123456789abcdef" }]]);
    // Community knows the playlist now, so nothing is left to reuse.
    expect(created.map.size).toBe(0);
    expect(playlistWriteNotice(run)).toBe("Added “Playlist 1” from Tagify Community to your Spotify playlists.");
  });

  it("renames and replaces the songs of a playlist it wrote before, quietly", async () => {
    const { playlists, writer } = spotify();
    const id = await writer.createPrivatePlaylist("Old name", "old");
    await writer.replacePlaylistTracks(id, ["spotify:track:" + trackId(9)]);
    vi.mocked(writer.createPrivatePlaylist).mockClear();
    const { reports, request } = community([playlist(1, { name: "New name", spotifyPlaylistId: id, trackIds: [trackId(2), trackId(1)], fingerprint: "fedcba9876543210" })]);
    const run = await runPlaylistWrites(session, writer, capability, memoryCreated(), request);
    expect(writer.createPrivatePlaylist).not.toHaveBeenCalled();
    expect(writer.updatePlaylistDetails).toHaveBeenCalledWith(id, { name: "New name", description: "Made on Tagify Community from your tags." });
    expect(playlists.get(id)).toEqual({ name: "New name", description: "Made on Tagify Community from your tags.", uris: [`spotify:track:${trackId(2)}`, `spotify:track:${trackId(1)}`] });
    expect(reports[0]).toEqual([{ id: entity(1), result: "written", spotifyPlaylistId: id, fingerprint: "fedcba9876543210" }]);
    expect(playlistWriteNotice(run)).toBeNull();
  });

  it("empties a playlist whose songs all fell out of its rules", async () => {
    const { playlists, writer } = spotify();
    const id = await writer.createPrivatePlaylist("Playlist 1", "");
    await writer.replacePlaylistTracks(id, ["spotify:track:" + trackId(9)]);
    const { reports, request } = community([playlist(1, { spotifyPlaylistId: id, trackIds: [] })]);
    await runPlaylistWrites(session, writer, capability, memoryCreated(), request);
    expect(playlists.get(id)!.uris).toEqual([]);
    expect(reports[0][0]).toMatchObject({ result: "written" });
  });

  it("reports a playlist the member deleted in Spotify as gone, without recreating or changing it", async () => {
    const { writer } = spotify({ gone: [spotifyId(7)] });
    const { reports, request } = community([playlist(1, { spotifyPlaylistId: spotifyId(7) })]);
    const run = await runPlaylistWrites(session, writer, capability, memoryCreated(), request);
    expect(run).toMatchObject({ written: 0, failed: 1 });
    expect(reports[0]).toEqual([{ id: entity(1), result: "failed", failure: "playlist_gone" }]);
    expect(writer.createPrivatePlaylist).not.toHaveBeenCalled();
    expect(writer.updatePlaylistDetails).not.toHaveBeenCalled();
    expect(writer.replacePlaylistTracks).not.toHaveBeenCalled();
  });

  it("fills the playlist it created on an earlier try instead of making a second one", async () => {
    const { playlists, writer } = spotify({ replaceFails: new Error("offline") });
    const created = memoryCreated();
    const first = community([playlist(1)]);
    await runPlaylistWrites(session, writer, capability, created, first.request);
    expect(first.reports[0]).toEqual([{ id: entity(1), result: "failed", failure: "spotify_unavailable" }]);
    expect(created.map.get(entity(1))).toBe(spotifyId(1));

    vi.mocked(writer.replacePlaylistTracks).mockImplementation(async (id, uris) => { playlists.get(id)!.uris = [...uris]; });
    const second = community([playlist(1)]);
    const run = await runPlaylistWrites(session, writer, capability, created, second.request);
    expect(writer.createPrivatePlaylist).toHaveBeenCalledTimes(1);
    expect(second.reports[0]).toEqual([{ id: entity(1), result: "written", spotifyPlaylistId: spotifyId(1), fingerprint: "0123456789abcdef" }]);
    expect(run.created).toEqual([]);
    expect(created.map.size).toBe(0);
  });

  it("tells Spotify asking Tagify to slow down apart from Spotify being unreachable", async () => {
    const busy = spotify({ createFails: Object.assign(new Error("Too many requests"), { status: 429 }) });
    const one = community([playlist(1)]);
    await runPlaylistWrites(session, busy.writer, capability, memoryCreated(), one.request);
    expect(one.reports[0]).toEqual([{ id: entity(1), result: "failed", failure: "spotify_busy" }]);

    const offline = spotify({ createFails: new Error("Spotify couldn’t create your playlist") });
    const two = community([playlist(1)]);
    await runPlaylistWrites(session, offline.writer, capability, memoryCreated(), two.request);
    expect(two.reports[0]).toEqual([{ id: entity(1), result: "failed", failure: "spotify_unavailable" }]);
  });

  it("reports a playlist it can't read as failed and writes the rest of the claim", async () => {
    const claim = readPlaylistClaim({ playlists: [playlist(1, { trackIds: ["not-a-track"] }), playlist(2), { id: "nope" }, playlist(2)] }, 5);
    expect(claim.playlists.map((item) => item.id)).toEqual([entity(2)]);
    expect(claim.unreadable).toEqual([entity(1)]);

    const { writer } = spotify();
    const { reports, request } = community([playlist(1, { trackIds: ["not-a-track"] }), playlist(2)]);
    const run = await runPlaylistWrites(session, writer, capability, memoryCreated(), request);
    expect(run).toMatchObject({ written: 1, failed: 1 });
    expect(reports[0]).toEqual([
      { id: entity(2), result: "written", spotifyPlaylistId: spotifyId(1), fingerprint: "0123456789abcdef" },
      { id: entity(1), result: "failed", failure: "unknown" },
    ]);
  });

  it("keeps claiming while Community hands out full claims", async () => {
    const { writer } = spotify();
    const { reports, request, calls } = community(Array.from({ length: 7 }, (_, index) => playlist(index + 1)));
    const run = await runPlaylistWrites(session, writer, capability, memoryCreated(), request);
    expect(run.written).toBe(7);
    expect(reports.map((report) => report.length)).toEqual([5, 2]);
    expect(calls).toHaveBeenCalledTimes(4);
  });

  it("asks once and stops when nothing is waiting", async () => {
    const { writer } = spotify();
    const { reports, calls, request } = community([]);
    expect(await runPlaylistWrites(session, writer, capability, memoryCreated(), request)).toEqual({ written: 0, failed: 0, created: [] });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(reports).toEqual([]);
  });

  it("stops when Community pauses playlists, is busy, or doesn't have them", async () => {
    const { writer } = spotify();
    const paused = community([], { claim: () => new Response(JSON.stringify({ error: { code: "playlists_paused", message: "Playlists are paused right now." } }), { status: 503 }) });
    expect(await runPlaylistWrites(session, writer, capability, memoryCreated(), paused.request)).toMatchObject({ stopped: "paused" });

    const busy = community([], { claim: () => new Response("{}", { status: 503, headers: { "retry-after": "120" } }) });
    expect(await runPlaylistWrites(session, writer, capability, memoryCreated(), busy.request)).toMatchObject({ stopped: "busy", retryAfterSeconds: 120 });

    const limited = community([], { claim: () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }) });
    expect(await runPlaylistWrites(session, writer, capability, memoryCreated(), limited.request)).toMatchObject({ stopped: "busy", retryAfterSeconds: 30 });

    const missing = community([], { claim: () => new Response("{}", { status: 404 }) });
    expect(await runPlaylistWrites(session, writer, capability, memoryCreated(), missing.request)).toMatchObject({ stopped: "unsupported" });

    const signedOut = community([], { claim: () => new Response("{}", { status: 401 }) });
    expect(await runPlaylistWrites(session, writer, capability, memoryCreated(), signedOut.request)).toMatchObject({ stopped: "signed_out" });

    const offline = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    expect(await runPlaylistWrites(session, writer, capability, memoryCreated(), offline)).toMatchObject({ stopped: "network" });
    expect(writer.createPrivatePlaylist).not.toHaveBeenCalled();
  });

  it("keeps a playlist it created when the report doesn't reach Community", async () => {
    const { writer } = spotify();
    const created = memoryCreated();
    const { request } = community([playlist(1)], { finish: () => new Response("{}", { status: 502 }) });
    const run = await runPlaylistWrites(session, writer, capability, created, request);
    expect(run).toMatchObject({ written: 0, stopped: "busy" });
    expect(created.map.get(entity(1))).toBe(spotifyId(1));
  });

  it("remembers created playlists per Spotify account", () => {
    let account = "alice";
    const created = localCreatedPlaylists(() => account);
    created.set(entity(1), spotifyId(1));
    expect(created.get(entity(1))).toBe(spotifyId(1));
    account = "bob";
    expect(created.get(entity(1))).toBeNull();
    account = "alice";
    created.delete(entity(1));
    expect(created.get(entity(1))).toBeNull();
  });
});

describe("When Tagify asks Community for playlists", () => {
  afterEach(() => { vi.useRealTimers(); });

  function scheduler(results: Array<Partial<PlaylistWriteRun>> = []) {
    vi.useFakeTimers({ now: new Date("2026-10-20T12:00:00Z") });
    const run = vi.fn(async (): Promise<PlaylistWriteRun> => ({ written: 0, failed: 0, created: [], ...(results.shift() ?? {}) }));
    return { run, scheduler: new PlaylistWriteScheduler({ run, random: () => 0 }) };
  }
  const settle = async (target: PlaylistWriteScheduler) => { await Promise.resolve(); await target.pending; };
  const minutes = (n: number) => vi.advanceTimersByTimeAsync(n * 60_000);

  it("asks nothing when Community doesn't advertise playlist writes, even when asked", async () => {
    const { run, scheduler: target } = scheduler();
    target.poll({});
    target.request();
    target.poll(null);
    await minutes(120);
    expect(run).not.toHaveBeenCalled();
  });

  it("asks when Tagify starts, then every 15 minutes while open, however often it syncs", async () => {
    const { run, scheduler: target } = scheduler();
    target.poll(advertised);
    await settle(target);
    expect(run).toHaveBeenCalledTimes(1);
    target.poll(advertised);
    await minutes(5);
    target.poll(advertised);
    expect(run).toHaveBeenCalledTimes(1);
    await minutes(10);
    expect(run).toHaveBeenCalledTimes(2);
    await minutes(15);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("asks at once when the member asks on Community, once more if they ask again meanwhile", async () => {
    const { run, scheduler: target } = scheduler();
    target.poll(advertised);
    await settle(target);
    target.request();
    target.request();
    target.request();
    await settle(target);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("waits for the next poll when Community pauses playlists, ignoring requests meanwhile", async () => {
    const { run, scheduler: target } = scheduler([{ stopped: "paused" }]);
    target.poll(advertised);
    await settle(target);
    target.request();
    await minutes(14);
    expect(run).toHaveBeenCalledTimes(1);
    await minutes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("backs off from a busy Community for as long as Retry-After asks", async () => {
    const { run, scheduler: target } = scheduler([{ stopped: "busy", retryAfterSeconds: 3600 }]);
    target.poll(advertised);
    await settle(target);
    target.request();
    target.poll(advertised);
    await minutes(59);
    expect(run).toHaveBeenCalledTimes(1);
    await minutes(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("backs off further after each failure, and never polls sooner than 15 minutes", async () => {
    const { run, scheduler: target } = scheduler([{ stopped: "network" }, { stopped: "network" }, { stopped: "network" }, { stopped: "network" }, { stopped: "network" }, { stopped: "network" }]);
    target.poll(advertised);
    await settle(target);
    // A request a minute later is allowed after the first failure's 1-minute back-off.
    await minutes(1);
    target.request();
    await settle(target);
    expect(run).toHaveBeenCalledTimes(2);
    // Then 2 minutes, but the timer still waits for the 15-minute poll.
    await minutes(14);
    expect(run).toHaveBeenCalledTimes(2);
    await minutes(2);
    expect(run).toHaveBeenCalledTimes(3);
    // Failures 3..5 wait 4, 8, 16 minutes: the fifth failure pushes the next ask past 15 minutes.
    await minutes(15);
    expect(run).toHaveBeenCalledTimes(4);
    await minutes(15);
    expect(run).toHaveBeenCalledTimes(5);
    await minutes(14);
    expect(run).toHaveBeenCalledTimes(5);
    await minutes(1);
    expect(run).toHaveBeenCalledTimes(6);
  });

  it("stops asking for the session when Community has no playlist writes", async () => {
    const { run, scheduler: target } = scheduler([{ stopped: "unsupported" }]);
    target.poll(advertised);
    await settle(target);
    target.request();
    target.poll(advertised);
    await minutes(120);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("asks nothing after sync stops, and asks again on the next start", async () => {
    const { run, scheduler: target } = scheduler();
    target.poll(advertised);
    await settle(target);
    target.stop();
    target.request();
    await minutes(60);
    expect(run).toHaveBeenCalledTimes(1);
    target.poll(advertised);
    await settle(target);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("turns off the timer when Community stops advertising playlist writes", async () => {
    const { run, scheduler: target } = scheduler();
    target.poll(advertised);
    await settle(target);
    target.poll({});
    await minutes(60);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
