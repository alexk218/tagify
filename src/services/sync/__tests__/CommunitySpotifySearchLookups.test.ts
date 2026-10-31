import { assertSpotifySearchLookupAnswers, type SpotifySearchLookupItemV1 } from "@tagify/sync-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  SPOTIFY_SEARCH_LOOKUP_DAILY_SEARCHES, SpotifySearchLookupScheduler, newSpotifySearchLookupMemory, runSpotifySearchLookups,
  withinSpotifySearchDailyCap, type SpotifySearchLookupSources,
} from "../CommunitySpotifySearchLookups";
import { LOOKUP_POLL_MS } from "../CommunityLookupLane";

const deviceId = "11111111-1111-4111-8111-111111111111";
const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId });
const M83 = { providerId: "63MQldklfxkjYDoUE4Tppz", name: "M83" };
const item = (n: number): SpotifySearchLookupItemV1 => ({
  providerId: `1eyzqe2QqGZUmfcPZtrIy${n}`, name: `Midnight City ${n}`, imageUrl: "https://i.scdn.co/image/ab67616d0000b273", artists: [M83],
});
const page = Array.from({ length: 12 }, (_, n) => item(n % 10));
const search = (n: number, extra: Record<string, unknown> = {}) => ({ requestId: `req-${n}`, query: "midnight city m83", kind: "track", ...extra });

/** Community's searches route: one answer per GET, then the posted answers. */
function community(answers: unknown[], options: { status?: number; postStatus?: number } = {}) {
  const posts: Array<{ requestId: string; items: SpotifySearchLookupItemV1[] }> = [];
  const urls: string[] = [];
  let get = 0;
  const request = vi.fn(async (url: string, init: RequestInit = {}) => {
    urls.push(`${init.method ?? "GET"} ${url}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
    if (init.method === "POST") {
      if (options.postStatus) return new Response("{}", { status: options.postStatus });
      const body = JSON.parse(String(init.body));
      assertSpotifySearchLookupAnswers(body);
      posts.push(...body.answers);
      return new Response(JSON.stringify({ accepted: body.answers.length }));
    }
    if (options.status) return new Response("{}", { status: options.status });
    return new Response(JSON.stringify(answers[get++] ?? { filler: true, searches: [] }));
  }) as unknown as typeof fetch;
  return { request, posts, urls };
}

function sources(overrides: Partial<SpotifySearchLookupSources> = {}, budget = Infinity) {
  let left = budget;
  const track = vi.fn(async (query: string) => query === "nothing at all" ? [] : page);
  const value: SpotifySearchLookupSources = {
    searches: { track },
    reserve: vi.fn(() => left-- > 0),
    pausedUntil: () => 0,
    pace: vi.fn(async () => undefined),
    ...overrides,
  };
  return { value, track };
}

describe("Spotify search lookups", () => {
  it("runs each song search once and answers with one page, or an empty list when Spotify found nothing", async () => {
    const { request, posts, urls } = community([{ filler: true, searches: [search(1), search(2, { query: "nothing at all" })] }]);
    const { value, track } = sources();
    const run = await runSpotifySearchLookups(session, value, { request });
    expect(run).toEqual({ filler: true, lookups: 2, answered: 2, searches: 2 });
    expect(track.mock.calls).toEqual([["midnight city m83"], ["nothing at all"]]);
    expect(posts).toEqual([{ requestId: "req-1", items: page.slice(0, 10) }, { requestId: "req-2", items: [] }]);
    expect(urls[0]).toBe(`GET https://community.test/api/v2/sync/spotify-search-lookups?deviceId=${deviceId}`);
    expect(urls[1]).toBe("POST https://community.test/api/v2/sync/spotify-search-lookups");
    expect(value.pace).toHaveBeenCalledTimes(1);
  });

  it("skips kinds this Tagify can't search yet, without reserving or answering", async () => {
    const { request, posts } = community([{ filler: true, searches: [search(1, { kind: "album" }), search(2, { kind: "artist" }), search(3)] }]);
    const { value } = sources();
    const run = await runSpotifySearchLookups(session, value, { request });
    expect(run).toEqual({ filler: true, lookups: 3, answered: 1, searches: 1 });
    expect(value.reserve).toHaveBeenCalledTimes(1);
    expect(posts.map((answer) => answer.requestId)).toEqual(["req-3"]);
  });

  it("reads nothing on a desktop that isn't a filler", async () => {
    const { request, posts } = community([{ filler: false, searches: [search(1)] }]);
    const { value, track } = sources();
    expect(await runSpotifySearchLookups(session, value, { request })).toEqual({ filler: false, lookups: 0, answered: 0, searches: 0 });
    expect(track).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it("stops at the allowance and sends what it found", async () => {
    const { request, posts } = community([{ filler: true, searches: [search(1), search(2)] }]);
    const { value } = sources({}, 1);
    expect(await runSpotifySearchLookups(session, value, { request })).toMatchObject({ stopped: "budget", searches: 1, answered: 1 });
    expect(posts.map((answer) => answer.requestId)).toEqual(["req-1"]);
  });

  it("stops at Spotify's first 429 and never searches while Spotify asks Tagify to wait", async () => {
    const throttled = Object.assign(new Error("Too Many Requests"), { status: 429, retryAfterSeconds: 30 });
    const { request, posts } = community([{ filler: true, searches: [search(1), search(2)] }, { filler: true, searches: [search(1)] }]);
    const track = vi.fn(async () => { throw throttled; });
    const { value } = sources({ searches: { track } });
    expect(await runSpotifySearchLookups(session, value, { request })).toMatchObject({ stopped: "spotify_paused", retryAfterSeconds: 30, searches: 1, answered: 0 });
    expect(track).toHaveBeenCalledTimes(1);
    expect(posts).toEqual([]);

    const paused = sources({ pausedUntil: () => Date.now() + 60_000 });
    expect(await runSpotifySearchLookups(session, paused.value, { request })).toMatchObject({ stopped: "spotify_paused", searches: 0 });
    expect(paused.value.reserve).not.toHaveBeenCalled();
  });

  it("doesn't answer when this Spotify has no song search", async () => {
    const { request, posts } = community([{ filler: true, searches: [search(1)] }]);
    const { value } = sources({ searches: { track: async () => null } });
    expect(await runSpotifySearchLookups(session, value, { request })).toMatchObject({ stopped: "search_unavailable" });
    expect(posts).toEqual([]);
  });

  it("answers again without searching when Community couldn't take an answer", async () => {
    const memory = newSpotifySearchLookupMemory();
    const failing = community([{ filler: true, searches: [search(1)] }], { postStatus: 500 });
    const { value, track } = sources();
    expect(await runSpotifySearchLookups(session, value, { request: failing.request, memory })).toMatchObject({ stopped: "network", answered: 0 });
    const working = community([{ filler: true, searches: [search(1)] }]);
    expect(await runSpotifySearchLookups(session, value, { request: working.request, memory })).toMatchObject({ searches: 0, answered: 1 });
    expect(track).toHaveBeenCalledTimes(1);
    expect(memory.answers.size).toBe(0);
  });

  it("stops quietly while Community has no route yet", async () => {
    const { request } = community([], { status: 404 });
    const { value, track } = sources();
    expect((await runSpotifySearchLookups(session, value, { request })).stopped).toBe("unsupported");
    expect(track).not.toHaveBeenCalled();
  });

  it("caps searches a day on this computer, under its own key", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    const reserve = withinSpotifySearchDailyCap(() => true, { storage, now: () => Date.parse("2026-10-28T10:00:00Z"), dailySearches: 2 });
    expect([reserve("a"), reserve("b"), reserve("c")]).toEqual([true, true, false]);
    expect([...store.keys()]).toEqual(["tagify:community-spotify-search-lookups:day:v1"]);
    expect(SPOTIFY_SEARCH_LOOKUP_DAILY_SEARCHES).toBe(300);
  });

  it("is scheduled like the other lookup lanes, backing off while Community has no route", async () => {
    const waits: number[] = [];
    let timer: (() => void) | null = null;
    const runs = [{ stopped: "unsupported" as const }, {}];
    const scheduler = new SpotifySearchLookupScheduler({
      run: async () => ({ filler: true, lookups: 0, answered: 0, searches: 0, ...runs.shift() }),
      setTimer: (callback, ms) => { timer = callback; waits.push(ms); return ms; }, clearTimer: () => { timer = null; },
    });
    scheduler.poll();
    await scheduler.pending;
    const fire = timer!; fire();
    await scheduler.pending;
    expect(waits).toEqual([3_600_000, LOOKUP_POLL_MS]);
    scheduler.stop();
  });
});
