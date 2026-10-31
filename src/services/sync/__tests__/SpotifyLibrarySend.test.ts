import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { spotifyLocalPause } from "@/utils/spotifyRequestFailure";
import { spotifySendNotice } from "../SyncRuntime";
import {
  canReadSpotifyLibrary, currentSpotifyLibrarySend, isSpotifyBusy, listFingerprint, partSongs, reportDesktopFeatures, runSpotifyLibrarySend, sendFailure,
  SpotifyLibrarySendError, SpotifyReadFailure, SPOTIFY_LIBRARY_SEND_EVENT, type LibraryReader,
} from "../SpotifyLibrarySender";

const id = (n: number) => `S${String(n).padStart(21, "0")}`;
const track = (n: number): SpotifyTrack => ({ uri: `spotify:track:${id(n)}`, name: `Song ${n}`, artists: [{ name: "Band" }], album: { name: "LP", images: [] }, duration_ms: 1000 });
const session = async () => ({ apiBaseUrl: "https://community.example", accessToken: "token", deviceId: "11111111-1111-4111-8111-111111111111" });

function reader(liked: SpotifyTrack[], playlists: Record<string, SpotifyTrack[]>, failOn?: string): LibraryReader {
  return {
    getTaggingQueuePage: async (_playlist, offset = 0) => ({ tracks: liked.slice(offset, offset + 50), nextOffset: offset + 50 < liked.length ? offset + 50 : null }),
    getAllUserPlaylistReferencesStrict: async () => Object.keys(playlists).map((playlistId) => ({ playlistId, playlistName: `List ${playlistId.slice(-3)}` })),
    readPlaylistTracks: async (playlistId) => {
      if (playlistId === failOn) throw Object.assign(new Error("Spotify needs a short break."), { status: 429 });
      return playlists[playlistId];
    },
  };
}

/** A Community that answers like the real routes and records what it got. */
function community(options: { known?: Array<{ id: string; fingerprint: string }>; missing?: string[]; startStatus?: number; cancelAfterPuts?: number; failPut?: number; selection?: unknown } = {}) {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  let puts = 0;
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname, method = String(init.method), body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ method, path, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path.endsWith("/device-features")) return json({ features: body.features });
    if (path.endsWith("/send") && method === "POST") return options.startStatus ? new Response("<html>", { status: options.startStatus }) : json({ status: "started", sendId: "33333333-3333-4333-8333-333333333333", lists: options.known ?? [], ...(options.selection !== undefined ? { selection: options.selection } : {}) });
    if (path.endsWith("/send") && method === "PATCH") return json({ status: options.cancelAfterPuts !== undefined && puts >= options.cancelAfterPuts ? "cancelled" : body.failure ? "failed" : "active" });
    if (method === "PUT") {
      puts += 1;
      if (options.failPut === puts) return json({ error: { code: "spotify_lists_daily_limit", message: "Try again tomorrow." } }, 429);
      if (options.cancelAfterPuts !== undefined && puts > options.cancelAfterPuts) return json({ status: "cancelled" });
      const lists = body.lists as Array<Record<string, unknown>> | undefined;
      const missing = (lists ?? []).filter((list) => list.keep && options.missing?.includes(String(list.id))).map((list) => list.id);
      return json({ status: "active", stored: (lists ?? []).filter((list) => !list.keep).length, kept: (lists ?? []).filter((list) => list.keep).length - missing.length, missing });
    }
    if (method === "POST") return json(body.sendId ? { status: "done", lists: 3, songs: 7 } : { lists: 3, songs: 7 });
    return json({}, 404);
  });
  return { calls, request: request as unknown as typeof fetch };
}

beforeEach(() => { vi.useRealTimers(); });
/** Records each wait instead of waiting. */
const waits = () => { const slept: number[] = []; return { slept, sleep: async (ms: number) => { slept.push(ms); } }; };
/** Tagify giving up on a read Spotify took too long to answer (RateLimiter's stalled transport). */
const tooSlow = () => Object.assign(new Error("Spotify is taking too long to respond. Your edits are saved. Wait for it to recover, or restart Spotify if updates remain paused."), { spotifyRequestStopped: true, recoveryRequired: true });
afterEach(() => { vi.unstubAllGlobals(); });

describe("sending Spotify lists as a send the member watches", () => {
  it("sends list by list, several small lists per request, with progress", async () => {
    const server = community();
    const seen: unknown[] = [];
    const listen = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(SPOTIFY_LIBRARY_SEND_EVENT, listen);
    const outcome = await runSpotifyLibrarySend(session, reader([track(1), track(2)], { [id(900)]: [track(3)], [id(901)]: [track(4), track(5)] }), { request: server.request });
    window.removeEventListener(SPOTIFY_LIBRARY_SEND_EVENT, listen);

    expect(outcome).toEqual({ status: "done", lists: 3, songs: 7, unchanged: 0, skipped: [] });
    const puts = server.calls.filter((call) => call.method === "PUT");
    expect(puts).toHaveLength(1);
    expect((puts[0].body.lists as Array<{ id: string }>).map((list) => list.id)).toEqual(["liked", id(900), id(901)]);
    expect((puts[0].body.lists as Array<{ fingerprint: string }>).every((list) => /^[a-f0-9]{32}$/.test(list.fingerprint))).toBe(true);
    const progress = server.calls.filter((call) => call.method === "PATCH").map((call) => call.body);
    expect(progress[0]).toMatchObject({ listsTotal: 3, listsDone: 0 });
    expect(progress.at(-1)).toMatchObject({ listsTotal: 3, listsDone: 3, songsSent: 5 });
    expect(server.calls.at(-1)).toMatchObject({ method: "POST", body: { sendId: "33333333-3333-4333-8333-333333333333" } });
    expect(new Set(server.calls.filter((call) => call.body.revision).map((call) => call.body.revision)).size).toBe(1);
    expect(seen.at(-1)).toBeNull();
    expect(seen.some((snapshot) => (snapshot as { phase?: string } | null)?.phase === "sending")).toBe(true);
    expect(currentSpotifyLibrarySend()).toBeNull();
  });

  it("keeps lists Community already has unchanged, and sends one it lost in full", async () => {
    const liked = [track(1), track(2)], gym = [track(3)];
    const likedPrint = await listFingerprint({ kind: "liked", songs: [id(2), id(1)], names: [["Song 2", "Band", "LP", null], ["Song 1", "Band", "LP", null]] });
    const gymPrint = await listFingerprint({ kind: "playlist", songs: [id(3)], names: [["Song 3", "Band", "LP", null]] });
    const server = community({ known: [{ id: "liked", fingerprint: likedPrint }, { id: id(900), fingerprint: gymPrint }], missing: [id(900)] });
    const outcome = await runSpotifyLibrarySend(session, reader(liked, { [id(900)]: gym }), { request: server.request });

    expect(outcome).toMatchObject({ status: "done", unchanged: 1 });
    const puts = server.calls.filter((call) => call.method === "PUT").map((call) => call.body.lists as Array<{ id: string; keep?: boolean; songs?: string[] }>);
    expect(puts[0]).toEqual([expect.objectContaining({ id: "liked", keep: true }), expect.objectContaining({ id: id(900), keep: true })]);
    // Community lost the playlist: it goes again in full.
    expect(puts[1]).toEqual([expect.objectContaining({ id: id(900), songs: [id(3)] })]);
  });

  it("sends each list's folders, and moves an unchanged list without its songs", async () => {
    const gym = [track(3)], road = [track(4)];
    const gymPrint = await listFingerprint({ kind: "playlist", songs: [id(3)], names: [["Song 3", "Band", "LP", null]] });
    const server = community({ known: [{ id: id(900), fingerprint: gymPrint }], missing: [] });
    const source = reader([track(1)], { [id(900)]: gym, [id(901)]: road });
    source.getAllUserPlaylistReferencesStrict = async () => [
      { playlistId: id(900), playlistName: "Gym", folders: [{ id: "f1", name: "Workout" }] },
      { playlistId: id(901), playlistName: "Road", folders: [{ id: "f1", name: "Workout" }, { id: "f2", name: "Trips" }] },
    ];
    expect(await runSpotifyLibrarySend(session, source, { request: server.request })).toMatchObject({ status: "done", unchanged: 1 });
    const sent = server.calls.filter((call) => call.method === "PUT").flatMap((call) => call.body.lists as Array<Record<string, unknown>>);
    expect(sent.find((list) => list.id === "liked")).toMatchObject({ folders: [] });
    // Gym moved into Workout in Spotify: Community keeps its songs and learns where it sits.
    expect(sent.find((list) => list.id === id(900))).toEqual({ id: id(900), keep: true, fingerprint: gymPrint, name: "Gym", position: 1, folders: [{ id: "f1", name: "Workout" }] });
    expect(sent.find((list) => list.id === id(901))).toMatchObject({ songs: [id(4)], folders: [{ id: "f1", name: "Workout" }, { id: "f2", name: "Trips" }] });
  });

  it("sends a kept list Community lost in full, in its folders", async () => {
    const gym = [track(3)];
    const gymPrint = await listFingerprint({ kind: "playlist", songs: [id(3)], names: [["Song 3", "Band", "LP", null]] });
    const server = community({ known: [{ id: id(900), fingerprint: gymPrint }], missing: [id(900)] });
    const source = reader([], { [id(900)]: gym });
    source.getAllUserPlaylistReferencesStrict = async () => [{ playlistId: id(900), playlistName: "Gym", folders: [{ id: "f1", name: "Workout" }] }];
    await runSpotifyLibrarySend(session, source, { request: server.request });
    const puts = server.calls.filter((call) => call.method === "PUT").map((call) => call.body.lists as Array<Record<string, unknown>>);
    expect(puts[1]).toEqual([expect.objectContaining({ id: id(900), songs: [id(3)], folders: [{ id: "f1", name: "Workout" }] })]);
  });

  it("stops when the member cancels, without finishing", async () => {
    const server = community({ cancelAfterPuts: 0 });
    const outcome = await runSpotifyLibrarySend(session, reader([track(1)], { [id(900)]: [track(2)] }), { request: server.request });
    expect(outcome).toEqual({ status: "cancelled" });
    expect(server.calls.some((call) => call.method === "POST" && !call.path.endsWith("/send"))).toBe(false);
  });

  it("waits as long as Spotify asks, then stops and says so when Spotify keeps asking", async () => {
    const server = community();
    const { slept, sleep } = waits();
    const outcome = await runSpotifyLibrarySend(session, reader([track(1)], { [id(900)]: [track(2)] }, id(900)), { request: server.request, sleep });
    expect(outcome).toEqual({ status: "failed", failure: "spotify_busy" });
    // Six one-minute waits (a 429 without Retry-After), each in one-second steps.
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(6 * 61_000);
    expect(server.calls.at(-1)).toMatchObject({ method: "PATCH", body: { failure: "spotify_busy" } });
    // Liked Songs, read before Spotify asked, still reached Community.
    expect(server.calls.filter((call) => call.method === "PUT").flatMap((call) => (call.body.lists as Array<{ id: string }>).map((list) => list.id))).toEqual(["liked"]);
  });

  it("reads each playlist in pages with a longer limit per page", async () => {
    const server = community();
    const asked: unknown[] = [];
    const source = reader([], { [id(900)]: [track(2)] });
    source.readPlaylistTracks = async (_playlist, options) => { asked.push(options); return [track(2)]; };
    await runSpotifyLibrarySend(session, source, { request: server.request });
    expect(asked).toEqual([{ pageSize: 100, timeoutMs: 60_000 }]);
  });

  it("tries a slow playlist again after a pause instead of stopping", async () => {
    const server = community();
    const { slept, sleep } = waits();
    let tries = 0;
    const source = reader([track(1)], { [id(900)]: [track(2)], [id(901)]: [track(3)] });
    source.readPlaylistTracks = async (playlistId) => { if (playlistId === id(900) && tries++ < 2) throw tooSlow(); return playlistId === id(900) ? [track(2)] : [track(3)]; };
    const outcome = await runSpotifyLibrarySend(session, source, { request: server.request, sleep });
    expect(outcome).toEqual({ status: "done", lists: 3, songs: 7, unchanged: 0, skipped: [] });
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(5_000 + 20_000);
  });

  it("waits out Spotify's Retry-After and carries on", async () => {
    const server = community();
    const { slept, sleep } = waits();
    let asked = false;
    const source = reader([track(1)], { [id(900)]: [track(2)] });
    source.readPlaylistTracks = async () => { if (!asked) { asked = true; throw spotifyLocalPause(30, { kind: "rate-limit", dispatched: true, status: 429, retryAfterSeconds: 30 }); } return [track(2)]; };
    expect(await runSpotifyLibrarySend(session, source, { request: server.request, sleep })).toMatchObject({ status: "done", skipped: [] });
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(31_000);
  });

  it("stops at once when Spotify asks for longer than a send can wait", async () => {
    const server = community();
    const { slept, sleep } = waits();
    const source = reader([track(1)], { [id(900)]: [track(2)] });
    source.readPlaylistTracks = async () => { throw spotifyLocalPause(3600, { kind: "quota-exceeded", dispatched: true, status: 429 }); };
    expect(await runSpotifyLibrarySend(session, source, { request: server.request, sleep })).toEqual({ status: "failed", failure: "spotify_busy" });
    expect(slept).toEqual([]);
  });

  it("skips and names a playlist Spotify can't read, keeping Community's copy, and sends the rest", async () => {
    const gymPrint = await listFingerprint({ kind: "playlist", songs: [id(3)], names: [["Song 3", "Band", "LP", null]] });
    const server = community({ known: [{ id: id(900), fingerprint: gymPrint }] });
    const { sleep } = waits();
    const source = reader([track(1)], { [id(900)]: [track(3)], [id(901)]: [track(4)], [id(902)]: [track(5)] });
    source.getAllUserPlaylistReferencesStrict = async () => [
      { playlistId: id(900), playlistName: "Gym", folders: [{ id: "f1", name: "Workout" }] },
      { playlistId: id(901), playlistName: "Broken mix" },
      { playlistId: id(902), playlistName: "Road" },
    ];
    source.readPlaylistTracks = async (playlistId) => { if (playlistId !== id(902)) throw tooSlow(); return [track(5)]; };
    const outcome = await runSpotifyLibrarySend(session, source, { request: server.request, sleep });
    expect(outcome).toMatchObject({ status: "done", skipped: ["Gym", "Broken mix"] });
    const sent = server.calls.filter((call) => call.method === "PUT").flatMap((call) => call.body.lists as Array<Record<string, unknown>>);
    expect(sent.find((list) => list.id === id(900))).toEqual({ id: id(900), keep: true, fingerprint: gymPrint, name: "Gym", position: 1, folders: [{ id: "f1", name: "Workout" }] });
    expect(sent.some((list) => list.id === id(901))).toBe(false);
    expect(sent.find((list) => list.id === id(902))).toMatchObject({ songs: [id(5)] });
    expect(server.calls.at(-1)).toMatchObject({ method: "POST", body: { sendId: "33333333-3333-4333-8333-333333333333" } });
  });

  it("stops when Spotify stops answering altogether, after sending what it read", async () => {
    const server = community();
    const { sleep } = waits();
    const playlists = Object.fromEntries(Array.from({ length: 8 }, (_, n) => [id(900 + n), [track(10 + n)]]));
    const source = reader([track(1)], playlists);
    source.readPlaylistTracks = async (playlistId) => { if (playlistId >= id(902)) throw tooSlow(); return playlists[playlistId]; };
    expect(await runSpotifyLibrarySend(session, source, { request: server.request, sleep })).toEqual({ status: "failed", failure: "spotify_unavailable" });
    const sent = server.calls.filter((call) => call.method === "PUT").flatMap((call) => (call.body.lists as Array<{ id: string }>).map((list) => list.id));
    expect(sent).toEqual(["liked", id(900), id(901)]);
    expect(server.calls.at(-1)).toMatchObject({ method: "PATCH", body: { failure: "spotify_unavailable" } });
  });

  it("sends only the lists the member chose, in their Spotify places", async () => {
    const server = community({ selection: { liked: false, playlistIds: [id(902), id(900)], includeFollowed: false } });
    const read: string[] = [];
    const source = reader([track(1)], { [id(900)]: [track(2)], [id(901)]: [track(3)], [id(902)]: [track(4)] });
    const readTracks = source.readPlaylistTracks;
    source.readPlaylistTracks = async (playlistId, options) => { read.push(playlistId); return readTracks(playlistId, options); };
    source.getTaggingQueuePage = async () => { throw new Error("Liked Songs weren't chosen"); };
    expect(await runSpotifyLibrarySend(session, source, { request: server.request })).toMatchObject({ status: "done", skipped: [] });
    expect(read).toEqual([id(900), id(902)]);
    const sent = server.calls.filter((call) => call.method === "PUT").flatMap((call) => call.body.lists as Array<{ id: string; position: number }>);
    expect(sent.map((list) => [list.id, list.position])).toEqual([[id(900), 1], [id(902), 3]]);
    expect(server.calls.filter((call) => call.method === "PATCH")[0].body).toMatchObject({ listsTotal: 2 });
  });

  it("includes Liked Songs when chosen", async () => {
    const server = community({ selection: { liked: true, playlistIds: [], includeFollowed: false } });
    await runSpotifyLibrarySend(session, reader([track(1)], { [id(900)]: [track(2)] }), { request: server.request });
    const sent = server.calls.filter((call) => call.method === "PUT").flatMap((call) => (call.body.lists as Array<{ id: string }>).map((list) => list.id));
    expect(sent).toEqual(["liked"]);
  });

  it("stops on a choice it can't read, without reading Spotify", async () => {
    const server = community({ selection: { liked: false, playlistIds: [], includeFollowed: false } });
    const source = reader([track(1)], {});
    source.getAllUserPlaylistReferencesStrict = async () => { throw new Error("should not read"); };
    expect(await runSpotifyLibrarySend(session, source, { request: server.request })).toEqual({ status: "failed", failure: "unknown" });
  });

  it("reports Community's daily limit", async () => {
    const server = community({ failPut: 1 });
    expect(await runSpotifyLibrarySend(session, reader([track(1)], {}), { request: server.request })).toEqual({ status: "failed", failure: "daily_limit" });
    expect(server.calls.at(-1)).toMatchObject({ method: "PATCH", body: { failure: "daily_limit" } });
  });

  it("sends the one-shot way to a Community without sends", async () => {
    const server = community({ startStatus: 404 });
    expect(await runSpotifyLibrarySend(session, reader([track(1)], { [id(900)]: [track(2)] }), { request: server.request })).toEqual({ status: "sent", lists: 3, songs: 7 });
    const sends = server.calls.filter((call) => !call.path.endsWith("/send"));
    expect(sends.map((call) => call.method)).toEqual(["PUT", "PUT", "POST"]);
    expect(sends[0].body.list).toMatchObject({ id: "liked" });
  });

  it("checks in while a long read keeps it busy", async () => {
    const server = community();
    let release!: () => void;
    const slow: LibraryReader = { ...reader([], {}), getTaggingQueuePage: () => new Promise((resolve) => { release = () => resolve({ tracks: [], nextOffset: null }); }) };
    const running = runSpotifyLibrarySend(session, slow, { request: server.request, heartbeatMs: 20 });
    await vi.waitFor(() => expect(server.calls.filter((call) => call.method === "PATCH").length).toBeGreaterThanOrEqual(3));
    release();
    expect(await running).toMatchObject({ status: "done" });
  });

  it("skips a list Spotify never finishes reading", async () => {
    const server = community();
    const stuck: LibraryReader = { ...reader([], { [id(900)]: [] }), readPlaylistTracks: () => new Promise(() => {}) };
    expect(await runSpotifyLibrarySend(session, stuck, { request: server.request, listTimeoutMs: 30, sleep: waits().sleep })).toMatchObject({ status: "done", skipped: ["List 900"] });
  });

  it("stops when Spotify never finishes reading Liked Songs", async () => {
    const server = community();
    const stuck: LibraryReader = { ...reader([], {}), getTaggingQueuePage: () => new Promise(() => {}) };
    expect(await runSpotifyLibrarySend(session, stuck, { request: server.request, listTimeoutMs: 30, sleep: waits().sleep })).toEqual({ status: "failed", failure: "spotify_unavailable" });
  });
});

describe("what Tagify tells Community and the member", () => {
  it("reports what it can do, and treats an older Community as unable to listen", async () => {
    const server = community();
    expect(await reportDesktopFeatures(session, server.request, ["spotifyLists"])).toBe(true);
    expect(server.calls[0]).toMatchObject({ method: "PUT", path: "/api/v2/sync/device-features", body: { features: ["spotifyLists"], deviceId: "11111111-1111-4111-8111-111111111111" } });
    expect(await reportDesktopFeatures(session, (async () => new Response("", { status: 404 })) as unknown as typeof fetch, ["spotifyLists"])).toBe(false);
    expect(await reportDesktopFeatures(session, (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch, ["spotifyLists"])).toBe(false);
  });

  it("offers sending only when this Spotify has the desktop APIs it reads", () => {
    const api = () => ({ getContents: () => null });
    expect(canReadSpotifyLibrary({ RootlistAPI: api(), LibraryAPI: { getTracks: () => null }, PlaylistAPI: api() })).toBe(true);
    expect(canReadSpotifyLibrary({ RootlistAPI: api(), PlaylistAPI: api() })).toBe(false);
    expect(canReadSpotifyLibrary(undefined)).toBe(false);
  });

  it("calls Spotify busy only when Spotify asked Tagify to wait", () => {
    expect(isSpotifyBusy(Object.assign(new Error("Spotify needs a short break."), { status: 429 }))).toBe(true);
    expect(isSpotifyBusy(spotifyLocalPause(30))).toBe(true);
    expect(isSpotifyBusy(new Error("Spotify needs a short break. Wait a moment, then check more tracks."))).toBe(true);
    // Tagify giving up on a slow read, or its own queue, is not Spotify asking for anything.
    expect(isSpotifyBusy(tooSlow())).toBe(false);
    expect(isSpotifyBusy(Object.assign(new Error("Spotify request expired while waiting"), { spotifyRequestStopped: true }))).toBe(false);
    expect(isSpotifyBusy(new Error("Spotify couldn't read the library"))).toBe(false);
  });

  it("names each failure the way Community explains it", () => {
    expect(sendFailure(new SpotifyReadFailure(true))).toBe("spotify_busy");
    expect(sendFailure(new SpotifyReadFailure(false))).toBe("spotify_unavailable");
    expect(sendFailure(new SpotifyLibrarySendError("x", 413, "spotify_lists_too_large"))).toBe("too_large");
    expect(sendFailure(new SpotifyLibrarySendError("x", 429, "spotify_lists_daily_limit"))).toBe("daily_limit");
    expect(sendFailure(new SpotifyLibrarySendError("x", 503, "spotify_lists_paused"))).toBe("paused");
    expect(sendFailure(new SpotifyLibrarySendError("x", 401, "authentication_required"))).toBe("signed_out");
    expect(sendFailure(new SpotifyLibrarySendError("x", 502, null))).toBe("network");
    expect(sendFailure(new TypeError("Failed to fetch"))).toBe("network");
    expect(sendFailure(new Error("?"))).toBe("unknown");
  });

  it("keeps each request well under Community's size limit", () => {
    const songs = Array.from({ length: 20_000 }, (_, index) => id(index));
    expect(partSongs({ songs, names: songs.map(() => ["t", "a", "b", null]) })).toBe(10_000);
    const long = "x".repeat(290);
    expect(partSongs({ songs, names: songs.map(() => [long, long, long, `https://${long}`]) })).toBe(1_000);
  });

  it("tells the member in Spotify how it ended", () => {
    expect(spotifySendNotice({ status: "done", lists: 3, songs: 1234, unchanged: 1, skipped: [] })).toEqual({ text: "Sent 1,234 songs in 3 lists to Tagify Community.", error: false });
    expect(spotifySendNotice({ status: "done", lists: 3, songs: 12, unchanged: 0, skipped: ["Gym"] })?.text)
      .toBe("Sent 12 songs in 3 lists to Tagify Community. Spotify couldn't open one playlist (“Gym”). Ask for your lists again on Community later to add it.");
    expect(spotifySendNotice({ status: "done", lists: 9, songs: 12, unchanged: 0, skipped: ["A", "B", "C", "D", "E"] })?.text)
      .toContain("Spotify couldn't open 5 playlists (“A”, “B”, “C” and 2 more). Ask for your lists again on Community later to add them.");
    expect(spotifySendNotice({ status: "failed", failure: "spotify_busy" })?.error).toBe(true);
    expect(spotifySendNotice({ status: "taken" })).toBeNull();
    expect(spotifySendNotice({ status: "none" })).toBeNull();
  });
});
