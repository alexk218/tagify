import { assertNowPlayingLookupAnswers } from "@tagify/sync-contracts";
import { describe, expect, it, vi } from "vitest";
import type { SpotifyTrackSearchResult } from "@/services/SpotifyTrackSearch";
import {
  NOT_A_FILLER_RECHECK_MS, NOW_PLAYING_LOOKUP_DAILY_SEARCHES, NOW_PLAYING_LOOKUP_POLL_MS, NowPlayingLookupScheduler, newNowPlayingLookupMemory,
  runNowPlayingLookups, withinLookupDailyCap, type NowPlayingLookupRun, type NowPlayingLookupSources,
} from "../CommunityNowPlayingLookups";

const deviceId = "11111111-1111-4111-8111-111111111111";
const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId });
const REMIX = "1ArFwgEU2iQMq9dU43sGZ9";
const ORIGINAL = "1fLhGF1JfGQYj6EZLndD86";
const results: SpotifyTrackSearchResult[] = [
  { id: REMIX, name: "Baby - Tony Romera Remix", artists: ["Four Tet", "Tony Romera"], album: "Baby Love Cry", playable: true },
  { id: ORIGINAL, name: "Baby (feat. MARINA & Luis Fonsi)", artists: ["Clean Bandit", "MARINA", "Luis Fonsi"], album: null, playable: true },
];
const lookup = (n: number, extra: Record<string, unknown> = {}) => ({ requestId: `req-${n}`, title: "Baby", version: null, artists: ["Clean Bandit"], album: null, ...extra });

/** Community's lookups route: one answer per GET, then the posted answers. */
function community(answers: unknown[], options: { status?: number; postStatus?: number; retryAfter?: string } = {}) {
  const posts: Array<{ requestId: string; spotifyTrackId: string | null }> = [];
  const urls: string[] = [];
  let get = 0;
  const request = vi.fn(async (url: string, init: RequestInit = {}) => {
    urls.push(`${init.method ?? "GET"} ${url}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
    if (init.method === "POST") {
      if (options.postStatus) return new Response("{}", { status: options.postStatus });
      const body = JSON.parse(String(init.body));
      assertNowPlayingLookupAnswers(body);
      posts.push(...body.answers);
      return new Response(JSON.stringify({ accepted: body.answers.length }));
    }
    if (options.status) return new Response("{}", { status: options.status, headers: options.retryAfter ? { "retry-after": options.retryAfter } : {} });
    return new Response(JSON.stringify(answers[get++] ?? { filler: true, lookups: [] }));
  }) as unknown as typeof fetch;
  return { request, posts, urls };
}

function sources(overrides: Partial<NowPlayingLookupSources> = {}, budget = Infinity) {
  let left = budget;
  const searched: string[] = [];
  const value: NowPlayingLookupSources = {
    search: vi.fn(async (term: string) => { searched.push(term); return results; }),
    reserve: vi.fn(() => left-- > 0),
    pausedUntil: () => 0,
    pace: vi.fn(async () => undefined),
    ...overrides,
  };
  return { value, searched };
}

describe("Now playing lookups", () => {
  it("searches each lookup once and answers with the same song or null", async () => {
    const { request, posts, urls } = community([{ filler: true, lookups: [
      lookup(1), lookup(2, { version: "Tony Romera Remix", artists: ["Four Tet"] }), lookup(3, { artists: ["Nobody"] }),
    ] }]);
    const { value, searched } = sources();
    const run = await runNowPlayingLookups(session, value, { request });
    expect(run).toEqual({ filler: true, lookups: 3, answered: 3, searches: 3 });
    expect(searched).toEqual(["Baby Clean Bandit", "Baby Tony Romera Remix Four Tet", "Baby Nobody"]);
    expect(posts).toEqual([
      { requestId: "req-1", spotifyTrackId: ORIGINAL }, { requestId: "req-2", spotifyTrackId: REMIX }, { requestId: "req-3", spotifyTrackId: null },
    ]);
    expect(urls[0]).toBe(`GET https://community.test/api/v2/sync/now-playing-lookups?deviceId=${deviceId}`);
    expect(value.pace).toHaveBeenCalledTimes(2);
  });

  it("reads nothing on a desktop that isn't a filler", async () => {
    const { request, posts } = community([{ filler: false, lookups: [lookup(1)] }]);
    const { value } = sources();
    expect(await runNowPlayingLookups(session, value, { request })).toEqual({ filler: false, lookups: 0, answered: 0, searches: 0 });
    expect(value.search).not.toHaveBeenCalled();
    expect(value.reserve).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it("stops at the allowance and sends what it found", async () => {
    const { request, posts } = community([{ filler: true, lookups: [lookup(1), lookup(2)] }]);
    const { value } = sources({}, 1);
    const run = await runNowPlayingLookups(session, value, { request });
    expect(run).toMatchObject({ stopped: "budget", searches: 1, answered: 1 });
    expect(posts).toEqual([{ requestId: "req-1", spotifyTrackId: ORIGINAL }]);
  });

  it("stops at Spotify's first 429 without answering, and never searches while Spotify asks Tagify to wait", async () => {
    const throttled = Object.assign(new Error("Too Many Requests"), { status: 429, retryAfterSeconds: 30 });
    const { request, posts } = community([{ filler: true, lookups: [lookup(1), lookup(2)] }, { filler: true, lookups: [lookup(1)] }]);
    const search = vi.fn(async () => { throw throttled; });
    const { value } = sources({ search });
    expect(await runNowPlayingLookups(session, value, { request })).toMatchObject({ stopped: "spotify_paused", retryAfterSeconds: 30, searches: 1, answered: 0 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(posts).toEqual([]);

    const paused = sources({ pausedUntil: () => Date.now() + 60_000 });
    expect(await runNowPlayingLookups(session, paused.value, { request })).toMatchObject({ stopped: "spotify_paused", searches: 0 });
    expect(paused.value.reserve).not.toHaveBeenCalled();
  });

  it("leaves a lookup whose search failed for Community to expire, and stops", async () => {
    const memory = newNowPlayingLookupMemory();
    const { request, posts } = community([{ filler: true, lookups: [lookup(1), lookup(2)] }, { filler: true, lookups: [lookup(1), lookup(2)] }]);
    const search = vi.fn(async (): Promise<SpotifyTrackSearchResult[]> => { throw new Error("GraphQL error"); });
    const { value } = sources({ search });
    expect(await runNowPlayingLookups(session, value, { request, memory })).toMatchObject({ stopped: "spotify", searches: 1 });
    search.mockResolvedValue(results);
    expect(await runNowPlayingLookups(session, value, { request, memory })).toMatchObject({ searches: 1, answered: 1 });
    expect(posts).toEqual([{ requestId: "req-2", spotifyTrackId: ORIGINAL }]);
  });

  it("answers again without searching when Community couldn't take an answer", async () => {
    const memory = newNowPlayingLookupMemory();
    const failing = community([{ filler: true, lookups: [lookup(1)] }], { postStatus: 500 });
    const { value } = sources();
    expect(await runNowPlayingLookups(session, value, { request: failing.request, memory })).toMatchObject({ stopped: "network", searches: 1, answered: 0 });
    const working = community([{ filler: true, lookups: [lookup(1)] }]);
    expect(await runNowPlayingLookups(session, value, { request: working.request, memory })).toMatchObject({ searches: 0, answered: 1 });
    expect(working.posts).toEqual([{ requestId: "req-1", spotifyTrackId: ORIGINAL }]);
    expect(memory.answers.size).toBe(0);
  });

  it("doesn't answer when this Spotify has no song search", async () => {
    const { request, posts } = community([{ filler: true, lookups: [lookup(1)] }]);
    const { value } = sources({ search: async () => null });
    expect(await runNowPlayingLookups(session, value, { request })).toMatchObject({ stopped: "search_unavailable" });
    expect(posts).toEqual([]);
  });

  it.each([
    [404, "unsupported"], [405, "unsupported"], [401, "signed_out"], [503, "paused"], [500, "network"], [429, "throttled"],
  ] as const)("a %i from Community stops quietly as %s", async (status, stopped) => {
    const { request } = community([], { status, retryAfter: "120" });
    const { value } = sources();
    const run = await runNowPlayingLookups(session, value, { request });
    expect(run.stopped).toBe(stopped);
    expect(value.search).not.toHaveBeenCalled();
  });

  it("caps searches a day on this computer, apart from the hour", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    let now = Date.parse("2026-10-28T10:00:00Z");
    let hourLeft = 2;
    const reserve = withinLookupDailyCap(() => hourLeft-- > 0, { storage, now: () => now, dailySearches: 3 });
    expect([reserve("a"), reserve("b"), reserve("c")]).toEqual([true, true, false]);
    hourLeft = 5;
    expect([reserve("d"), reserve("e")]).toEqual([true, false]);
    now = Date.parse("2026-10-29T00:00:01Z");
    expect(reserve("f")).toBe(true);
    expect(NOW_PLAYING_LOOKUP_DAILY_SEARCHES).toBeGreaterThan(300);
  });
});

describe("Now playing lookup scheduling", () => {
  function scheduler(runs: Array<Partial<NowPlayingLookupRun>>) {
    const waits: number[] = [];
    let timer: (() => void) | null = null;
    const run = vi.fn(async () => ({ filler: true, lookups: 0, answered: 0, searches: 0, ...runs.shift() }));
    const value = new NowPlayingLookupScheduler({
      run, setTimer: (callback, ms) => { timer = callback; waits.push(ms); return ms; }, clearTimer: () => { timer = null; },
    });
    const next = async () => { const fire = timer!; timer = null; fire(); await value.pending; };
    return { value, run, waits, next };
  }

  it("asks every 15 seconds as a filler and every few hours otherwise", async () => {
    const { value, run, waits, next } = scheduler([{}, { filler: false }]);
    value.poll();
    await value.pending;
    value.poll();
    expect(run).toHaveBeenCalledTimes(1);
    await next();
    expect(waits).toEqual([NOW_PLAYING_LOOKUP_POLL_MS, NOT_A_FILLER_RECHECK_MS]);
  });

  it("backs off quietly, growing, while Community has no route or fails, and starts over after an answer", async () => {
    const { value, waits, next } = scheduler([
      { stopped: "unsupported" }, { stopped: "unsupported" }, { stopped: "network" }, { stopped: "network" }, { stopped: "throttled", retryAfterSeconds: 600 }, {},
    ]);
    value.poll();
    await value.pending;
    for (let i = 0; i < 5; i++) await next();
    expect(waits).toEqual([3_600_000, 7_200_000, 60_000, 120_000, 600_000, NOW_PLAYING_LOOKUP_POLL_MS]);
  });

  it("waits out Spotify's pause, the allowance and a missing search", async () => {
    const { value, waits, next } = scheduler([
      { stopped: "spotify_paused", retryAfterSeconds: 90 }, { stopped: "spotify_paused" }, { stopped: "budget" }, { stopped: "search_unavailable" }, { stopped: "spotify" }, { stopped: "spotify" },
    ]);
    value.poll();
    await value.pending;
    for (let i = 0; i < 5; i++) await next();
    expect(waits).toEqual([90_000, NOW_PLAYING_LOOKUP_POLL_MS, 300_000, 600_000, 120_000, 240_000]);
  });

  it("asks nothing after sync stops", async () => {
    const { value, run, waits } = scheduler([{}]);
    value.poll();
    value.stop();
    await value.pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});
