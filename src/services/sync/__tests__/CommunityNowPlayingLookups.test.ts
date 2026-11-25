import { assertNowPlayingLookupAnswers } from "@tagify/sync-contracts";
import { describe, expect, it, vi } from "vitest";
import type { SpotifyTrackSearchResult } from "@/services/SpotifyTrackSearch";
import {
  LOOKUP_NUDGE_MIN_GAP_MS, NOT_A_FILLER_RECHECK_MS, NOW_PLAYING_LOOKUP_DAILY_SEARCHES, NOW_PLAYING_LOOKUP_POLL_MS, NowPlayingLookupScheduler, newNowPlayingLookupMemory,
  runNowPlayingLookups, withinLookupDailyCap, type NowPlayingLookupRun, type NowPlayingLookupSources,
} from "../CommunityNowPlayingLookups";
import { LOOKUP_IDLE_POLL_CAP_MS } from "../CommunityLookupLane";

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

describe("Now playing lookup nudges", () => {
  // A scheduler on a hand-turned clock, whose runs finish only when the test says so.
  function nudged() {
    let clock = 1_000_000;
    let armed: { fire: () => void; at: number } | null = null;
    const waits: number[] = [];
    const finishes: Array<(run: Partial<NowPlayingLookupRun>) => void> = [];
    const run = vi.fn(() => new Promise<NowPlayingLookupRun>((resolve) => {
      finishes.push((result) => resolve({ filler: true, lookups: 0, answered: 0, searches: 0, ...result }));
    }));
    const value = new NowPlayingLookupScheduler({
      run, now: () => clock,
      setTimer: (fire, ms) => { armed = { fire, at: clock + ms }; waits.push(ms); return armed; },
      clearTimer: (timer) => { if (armed === timer) armed = null; },
    });
    const finish = async (result: Partial<NowPlayingLookupRun> = {}) => { finishes.shift()!(result); await value.pending; };
    /** Moves the clock on, firing the timer when it comes due. */
    const advance = async (ms: number) => {
      clock += ms;
      if (armed && armed.at <= clock) { const { fire } = armed; armed = null; fire(); }
      await Promise.resolve();
    };
    const armedIn = () => (armed ? armed.at - clock : null);
    return { value, run, waits, finish, advance, armedIn };
  }

  it("asks at once, instead of at the next poll, when a filler between polls hears of a request", async () => {
    const { value, run, waits, finish, advance, armedIn } = nudged();
    value.poll();
    await finish();
    expect(armedIn()).toBe(NOW_PLAYING_LOOKUP_POLL_MS);
    await advance(3_000);
    value.nudge();
    // The 15-second poll is replaced by a run right away.
    expect(armedIn()).toBe(0);
    await advance(0);
    expect(run).toHaveBeenCalledTimes(2);
    await finish();
    expect(waits).toEqual([NOW_PLAYING_LOOKUP_POLL_MS, 0, NOW_PLAYING_LOOKUP_POLL_MS]);
  });

  it("follows a run in progress with exactly one more, however many requests arrive during it", async () => {
    const { value, run, finish, advance, armedIn } = nudged();
    value.poll();
    await advance(1_500);
    value.nudge();
    value.nudge();
    value.nudge();
    expect(run).toHaveBeenCalledTimes(1);
    await finish();
    expect(armedIn()).toBe(0);
    await advance(0);
    expect(run).toHaveBeenCalledTimes(2);
    await finish();
    // Nothing more was announced, so the ordinary poll follows.
    expect(armedIn()).toBe(NOW_PLAYING_LOOKUP_POLL_MS);
  });

  it("starts a nudge's run at least a second after the previous run", async () => {
    const { value, run, finish, advance, armedIn } = nudged();
    value.poll();
    await finish();
    value.nudge();
    // The first run started just now: the nudge's run waits out the second.
    expect(armedIn()).toBe(LOOKUP_NUDGE_MIN_GAP_MS);
    await advance(400);
    value.nudge();
    expect(armedIn()).toBe(600);
    await advance(600);
    expect(run).toHaveBeenCalledTimes(2);
    // A nudge during that run, which finishes quickly, also waits out the second.
    value.nudge();
    await advance(100);
    await finish();
    expect(armedIn()).toBe(900);
  });

  it("leaves back-offs, Spotify's pauses, the allowance and non-filler desktops alone", async () => {
    const stops: Array<Partial<NowPlayingLookupRun>> = [
      { stopped: "spotify_paused", retryAfterSeconds: 90 }, { stopped: "spotify_paused" }, { stopped: "budget" }, { stopped: "network" },
      { stopped: "throttled" }, { stopped: "unsupported" }, { stopped: "signed_out" }, { stopped: "paused" }, { stopped: "spotify" },
      { stopped: "search_unavailable" }, { filler: false },
    ];
    for (const stop of stops) {
      const { value, run, finish, armedIn } = nudged();
      value.poll();
      // Heard during the run, and again after it.
      value.nudge();
      await finish(stop);
      const wait = armedIn();
      expect(wait).toBeGreaterThanOrEqual(NOW_PLAYING_LOOKUP_POLL_MS);
      value.nudge();
      expect(armedIn()).toBe(wait);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores nudges before sync starts and after it stops", async () => {
    const { value, run, finish, armedIn } = nudged();
    value.nudge();
    expect(run).not.toHaveBeenCalled();
    expect(armedIn()).toBeNull();
    value.poll();
    await finish();
    value.stop();
    value.nudge();
    expect(armedIn()).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("Now playing lookup idle polls", () => {
  function idle(options: { hears?: () => boolean } = {}) {
    let clock = 1_000_000;
    let armed: { fire: () => void; at: number } | null = null;
    const waits: number[] = [];
    const finishes: Array<(run: Partial<NowPlayingLookupRun>) => void> = [];
    const run = vi.fn(() => new Promise<NowPlayingLookupRun>((resolve) => {
      finishes.push((result) => resolve({ filler: true, lookups: 0, answered: 0, searches: 0, ...result }));
    }));
    const value = new NowPlayingLookupScheduler({
      run, now: () => clock, canHearNudges: options.hears ?? (() => true),
      setTimer: (fire, ms) => { armed = { fire, at: clock + ms }; waits.push(ms); return armed; },
      clearTimer: (timer) => { if (armed === timer) armed = null; },
    });
    const finish = async (result: Partial<NowPlayingLookupRun> = {}) => { finishes.shift()!(result); await value.pending; };
    const fire = async () => { const due = armed!; clock = due.at; armed = null; due.fire(); await Promise.resolve(); };
    const armedIn = () => (armed ? armed.at - clock : null);
    return { value, run, waits, finish, fire, armedIn };
  }
  const announced = { idlePollMaxMs: 90_000 };

  it("stretches empty polls up to what Community allows while it announces requests", async () => {
    const { value, waits, finish, fire } = idle();
    value.poll();
    await finish(announced);
    for (let i = 0; i < 4; i++) { await fire(); await finish(announced); }
    expect(waits).toEqual([30_000, 60_000, 90_000, 90_000, 90_000]);
  });

  it("never stretches past five minutes, whatever Community allows", async () => {
    const { value, waits, finish, fire } = idle();
    value.poll();
    await finish({ idlePollMaxMs: 30 * 60_000 });
    for (let i = 0; i < 5; i++) { await fire(); await finish({ idlePollMaxMs: 30 * 60_000 }); }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, LOOKUP_IDLE_POLL_CAP_MS, LOOKUP_IDLE_POLL_CAP_MS]);
  });

  it("starts over at 15 seconds after a poll that found requests", async () => {
    const { value, waits, finish, fire } = idle();
    value.poll();
    await finish(announced);
    await fire(); await finish(announced);
    await fire(); await finish({ ...announced, lookups: 2, searches: 2, answered: 2 });
    await fire(); await finish(announced);
    expect(waits).toEqual([30_000, 60_000, NOW_PLAYING_LOOKUP_POLL_MS, 30_000]);
  });

  it("answers a nudge at once during a stretched wait, then starts the stretch over", async () => {
    const { value, run, waits, finish, fire, armedIn } = idle();
    value.poll();
    await finish(announced);
    await fire(); await finish(announced);
    expect(armedIn()).toBe(60_000);
    value.nudge();
    // The last run started just now, so the nudge's run waits out the least gap, not the minute.
    expect(armedIn()).toBe(LOOKUP_NUDGE_MIN_GAP_MS);
    await fire();
    expect(run).toHaveBeenCalledTimes(3);
    await finish(announced);
    expect(waits).toEqual([30_000, 60_000, LOOKUP_NUDGE_MIN_GAP_MS, 30_000]);
  });

  it("keeps polling every 15 seconds when Community announces nothing or the desktop isn't listening", async () => {
    let listening = false;
    const { value, waits, finish, fire } = idle({ hears: () => listening });
    value.poll();
    await finish(announced);
    await fire(); await finish(announced);
    listening = true;
    await fire(); await finish({});
    await fire(); await finish(announced);
    listening = false;
    await fire(); await finish(announced);
    expect(waits).toEqual([NOW_PLAYING_LOOKUP_POLL_MS, NOW_PLAYING_LOOKUP_POLL_MS, NOW_PLAYING_LOOKUP_POLL_MS, 30_000, NOW_PLAYING_LOOKUP_POLL_MS]);
  });

  it("starts the stretch over after a back-off", async () => {
    const { value, waits, finish, fire } = idle();
    value.poll();
    await finish(announced);
    await fire(); await finish(announced);
    await fire(); await finish({ stopped: "network" });
    await fire(); await finish(announced);
    expect(waits).toEqual([30_000, 60_000, 60_000, 30_000]);
  });
});
