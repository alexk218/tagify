import { assertArtistCreditReport, assertSongReleaseReport } from "@tagify/sync-contracts";
import { describe, expect, it, vi } from "vitest";
import { runArtistCreditReports, type ArtistCreditSources } from "../CommunityArtistCredits";
import {
  CATALOG_FILL_DAILY_READS, CATALOG_FILL_MAX_SLOWDOWN, CATALOG_FILL_RECOVERY_READS, catalogFillBackoff, catalogFillPace, DEFAULT_CATALOG_FILL_PACE,
  saveCatalogFillPace, splitOutsideLibrary, withinDailyCap, type CatalogFillAllowance,
} from "../CommunityCatalogFill";
import { runSongReleaseReports, type SongReleaseSources } from "../CommunitySongReleases";

const id = (prefix: string, index: number) => `${prefix}${String(index).padStart(22 - prefix.length, "0")}`;
const track = (index: number) => ({ provider: "spotify" as const, kind: "track" as const, providerId: id("track", index) });
const album = (index: number) => ({ provider: "spotify" as const, kind: "album" as const, providerId: id("album", index) });
const artist = (index: number) => ({ uri: `spotify:artist:${id("artist", index)}`, name: `Artist ${index}` });
const uri = (entity: { kind: string; providerId: string }) => `spotify:${entity.kind}:${entity.providerId}`;
const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId: "11111111-1111-4111-8111-111111111111" });
const throttled = () => Object.assign(new Error("Spotify asked Tagify to wait"), { status: 429 });

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

/** A Spotify double that logs every read and fails if two are ever in flight together. */
function spotifyLog() {
  const log: string[] = [];
  let inFlight = 0;
  const read = <T>(name: string, answer: (uri: string) => T | Promise<T>) => vi.fn(async (value: string) => {
    inFlight += 1;
    if (inFlight > 1) throw new Error("concurrent Spotify reads");
    log.push(`${name} ${value}`);
    await Promise.resolve();
    try { return await answer(value); } finally { inFlight -= 1; }
  });
  return { log, read };
}

/** The filler's allowance: `library` lists the songs in this library; every read is logged. */
function allowance(log: string[], library: string[], reserve: (identity: string) => boolean = () => true) {
  return {
    libraryTracks: vi.fn(async (uris: string[]) => new Set(uris.filter((value) => library.includes(value)))),
    reserve: vi.fn(reserve),
    pace: vi.fn(async () => { log.push("filler pace"); }),
  } satisfies CatalogFillAllowance;
}

function community(path: "artist-credits" | "song-releases", pages: Array<{ items: unknown[]; hasMore?: boolean }>) {
  const posts: Array<{ items: Array<{ entity: { providerId: string } }> }> = [];
  const gets: string[] = [];
  const request = vi.fn(async (url: string, init: RequestInit = {}) => {
    expect(new URL(url).pathname).toBe(`/api/v2/sync/${path}`);
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return new Response(JSON.stringify({ accepted: body.items.length, ignored: 0 }));
    }
    gets.push(url);
    const page = pages.shift() ?? { items: [] };
    return new Response(JSON.stringify({ items: page.items, hasMore: page.hasMore ?? false }));
  });
  return { request: request as unknown as typeof fetch, posts, gets };
}

function artistSources(spotify: ReturnType<typeof spotifyLog>, overrides: Partial<ArtistCreditSources> = {}): ArtistCreditSources {
  return {
    knownTrackArtists: vi.fn(() => null),
    trackAlbums: vi.fn(async () => new Map<string, string>()),
    albumTrackArtists: spotify.read("getAlbumTracks", async () => null),
    trackArtists: spotify.read("getTrack", () => [artist(1)]),
    albumArtists: spotify.read("getAlbum", () => [artist(2)]),
    reserve: vi.fn(() => true),
    pace: vi.fn(async () => { spotify.log.push("library pace"); }),
    ...overrides,
  };
}

function releaseSources(spotify: ReturnType<typeof spotifyLog>, overrides: Partial<SongReleaseSources> = {}): SongReleaseSources {
  return {
    knownSongs: vi.fn(async () => new Map()),
    trackRelease: spotify.read("metadata", () => ({ isrc: "GBDUW0000059", albumUri: `spotify:album:${id("album", 9)}` })),
    albumRelease: spotify.read("getAlbum", () => ({ name: "Discovery", type: "ALBUM", date: { year: 2001 }, coverSources: [] })),
    reserve: vi.fn(() => true),
    pace: vi.fn(async () => { spotify.log.push("library pace"); }),
    ...overrides,
  };
}

describe("a catalog filler desktop reading songs from anywhere on Community", () => {
  it("leaves every item on the library path when nothing is outside this library, or without the allowance", async () => {
    const items = [track(1), album(1)];
    const fill = allowance([], [uri(track(1))]);
    expect(await splitOutsideLibrary(items, fill)).toEqual({ library: items, outside: [] });
    expect(await splitOutsideLibrary(items, undefined)).toEqual({ library: items, outside: [] });
    // Albums always stay on the library path; Community only hands out songs from elsewhere.
    expect(await splitOutsideLibrary([album(1), track(2)], fill)).toEqual({ library: [album(1)], outside: [track(2)] });
  });

  it("reads the library first, then songs from elsewhere one at a time with getTrack only, waiting before each", async () => {
    const spotify = spotifyLog();
    const fill = allowance(spotify.log, [uri(track(1))]);
    const sources = artistSources(spotify, {
      outsideLibrary: fill,
      // Album listings would answer several songs at once; songs from elsewhere never use them.
      trackAlbums: vi.fn(async (uris: string[]) => new Map(uris.map((value) => [value, `spotify:album:${id("album", 7)}`] as const))),
    });
    const server = community("artist-credits", [{ items: [track(1), track(2), track(3)] }]);

    const run = await runArtistCreditReports(session, sources, { request: server.request, storage: memoryStorage() });

    expect(spotify.log).toEqual([
      "library pace", `getTrack ${uri(track(1))}`,
      "filler pace", `getTrack ${uri(track(2))}`,
      "filler pace", `getTrack ${uri(track(3))}`,
    ]);
    expect(fill.reserve.mock.calls.map(([identity]) => identity)).toEqual([uri(track(2)), uri(track(3))]);
    expect(sources.reserve).toHaveBeenCalledTimes(1);
    expect(sources.trackAlbums).toHaveBeenCalledTimes(1);
    expect(run).toEqual({ sent: 3, reads: 3 });
    expect(server.posts).toHaveLength(1);
    expect(() => assertArtistCreditReport(server.posts[0])).not.toThrow();
  });

  it("stops at Spotify's first 429 on a song from elsewhere, sends what it found and reads nothing more", async () => {
    const spotify = spotifyLog();
    let calls = 0;
    const sources = artistSources(spotify, {
      outsideLibrary: allowance(spotify.log, []),
      trackArtists: spotify.read("getTrack", () => { calls += 1; if (calls === 2) throw throttled(); return [artist(1)]; }),
    });
    const server = community("artist-credits", [{ items: [track(1), track(2), track(3)], hasMore: true }]);

    const run = await runArtistCreditReports(session, sources, { request: server.request, storage: memoryStorage() });

    expect(run).toEqual({ sent: 1, reads: 2, stopped: "spotify", cause: { kind: "server-429", status: 429 } });
    expect(calls).toBe(2);
    expect(server.gets).toHaveLength(1);
    expect(server.posts.map((post) => post.items.map((item) => item.entity.providerId))).toEqual([[id("track", 1)]]);
  });

  it("reads nothing from elsewhere when the filler's allowance is spent or Spotify asked Tagify to wait", async () => {
    const spotify = spotifyLog();
    const sources = artistSources(spotify, { outsideLibrary: allowance(spotify.log, [uri(track(1))], () => false) });
    const server = community("artist-credits", [{ items: [track(1), track(2)], hasMore: true }]);

    const run = await runArtistCreditReports(session, sources, { request: server.request, storage: memoryStorage() });

    expect(spotify.log).toEqual(["library pace", `getTrack ${uri(track(1))}`]);
    expect(run).toEqual({ sent: 1, reads: 1, stopped: "budget" });
  });

  it("reads a song from elsewhere's ISRC and release with the metadata read and getAlbum, one at a time", async () => {
    const spotify = spotifyLog();
    const fill = allowance(spotify.log, []);
    const sources = releaseSources(spotify, { outsideLibrary: fill });
    const server = community("song-releases", [{ items: [track(1), track(2)] }]);

    const run = await runSongReleaseReports(session, sources, { request: server.request, storage: memoryStorage() });

    expect(spotify.log).toEqual([
      "filler pace", `metadata ${uri(track(1))}`, "filler pace", `getAlbum spotify:album:${id("album", 9)}`,
      "filler pace", `metadata ${uri(track(2))}`,
    ]);
    expect(sources.reserve).not.toHaveBeenCalled();
    expect(run).toEqual({ sent: 2, reads: 3 });
    expect(() => assertSongReleaseReport(server.posts[0])).not.toThrow();
  });

  it("stops the release run at a 429 on a song from elsewhere", async () => {
    const spotify = spotifyLog();
    const sources = releaseSources(spotify, {
      outsideLibrary: allowance(spotify.log, []),
      trackRelease: spotify.read("metadata", () => { throw throttled(); }),
    });
    const server = community("song-releases", [{ items: [track(1), track(2)], hasMore: true }]);

    const run = await runSongReleaseReports(session, sources, { request: server.request, storage: memoryStorage() });

    expect(run).toEqual({ sent: 0, reads: 1, stopped: "spotify", cause: { kind: "server-429", status: 429 } });
    expect(spotify.log).toEqual(["filler pace", `metadata ${uri(track(1))}`]);
    expect(server.posts).toEqual([]);
  });
});

describe("the filler's daily cap", () => {
  it("allows a fixed number of reads a UTC day across runs, and starts again the next day", () => {
    let now = Date.UTC(2026, 9, 28, 12);
    const storage = memoryStorage();
    const hourly = vi.fn(() => true);
    const first = withinDailyCap(hourly, { storage, now: () => now });
    for (let read = 0; read < CATALOG_FILL_DAILY_READS; read++) expect(first(`song ${read}`)).toBe(true);
    expect(first("one more")).toBe(false);

    // A later run (the release run, or after a restart) shares the same count.
    expect(withinDailyCap(hourly, { storage, now: () => now })("another")).toBe(false);
    expect(hourly).toHaveBeenCalledTimes(CATALOG_FILL_DAILY_READS);

    now += 24 * 60 * 60_000;
    expect(withinDailyCap(hourly, { storage, now: () => now })("tomorrow")).toBe(true);
  });

  it("doesn't count a read the hour refused against the day", () => {
    const storage = memoryStorage();
    const now = () => Date.UTC(2026, 9, 28, 12);
    expect(withinDailyCap(() => false, { storage, now })("song")).toBe(false);
    expect(storage.values.size).toBe(0);
    expect(withinDailyCap(() => true, { storage, now })("song")).toBe(true);
    expect(JSON.parse(storage.values.get("tagify:community-catalog-fill:day:v1")!)).toEqual({ day: "2026-10-28", reads: 1 });
  });
});

describe("the pace Community advertises", () => {
  const fast = { preset: "fast" as const, readIntervalMs: 1_000, hourlyReads: 3_600, dailyReads: 86_400 };

  it("keeps the conservative constants until Community says otherwise (older Communities never do)", () => {
    expect(catalogFillPace({ storage: memoryStorage() })).toEqual(DEFAULT_CATALOG_FILL_PACE);
    expect(DEFAULT_CATALOG_FILL_PACE).toEqual({ preset: "conservative", readIntervalMs: 4_000, hourlyReads: 60, dailyReads: 300 });
  });

  it("follows the advertised pace for a day, and forgets it when Community says this isn't a filler", () => {
    let now = Date.UTC(2026, 9, 28, 12);
    const storage = { ...memoryStorage(), removeItem(key: string) { this.values.delete(key); } };
    saveCatalogFillPace(fast, { storage, now: () => now });
    expect(catalogFillPace({ storage, now: () => now })).toEqual(fast);
    now += 24 * 60 * 60_000;
    expect(catalogFillPace({ storage, now: () => now })).toEqual(DEFAULT_CATALOG_FILL_PACE);
    saveCatalogFillPace(fast, { storage, now: () => now });
    saveCatalogFillPace(null, { storage, now: () => now });
    expect(catalogFillPace({ storage, now: () => now })).toEqual(DEFAULT_CATALOG_FILL_PACE);
  });

  it("ignores a saved pace it can't trust", () => {
    const storage = memoryStorage();
    const now = () => Date.UTC(2026, 9, 28, 12);
    storage.setItem("tagify:community-catalog-fill:pace:v1", JSON.stringify({ pace: { ...fast, readIntervalMs: 0 }, savedAt: now() }));
    expect(catalogFillPace({ storage, now })).toEqual(DEFAULT_CATALOG_FILL_PACE);
    storage.setItem("tagify:community-catalog-fill:pace:v1", "{not json");
    expect(catalogFillPace({ storage, now })).toEqual(DEFAULT_CATALOG_FILL_PACE);
  });

  it("caps the day at the advertised number of reads", () => {
    const storage = memoryStorage();
    const reserve = withinDailyCap(() => true, { storage, now: () => Date.UTC(2026, 9, 28, 12), dailyReads: () => 2 });
    expect([reserve("a"), reserve("b"), reserve("c")]).toEqual([true, true, false]);
  });
});

describe("the filler's backoff", () => {
  it("halves its speed at each new Spotify pause and recovers after a run of reads without one", () => {
    const storage = memoryStorage();
    let now = 1_000_000;
    let pauseUntil = 0;
    const backoff = catalogFillBackoff(() => pauseUntil, { storage, now: () => now });
    backoff.note();
    expect(backoff.slowdown()).toBe(1);

    pauseUntil = now + 60_000; // A 429 with Retry-After 60 s.
    backoff.note();
    expect(backoff.slowdown()).toBe(2);
    backoff.note(); // The same pause again is not a new refusal.
    expect(backoff.slowdown()).toBe(2);
    pauseUntil = now + 120_000;
    backoff.note();
    expect(backoff.slowdown()).toBe(4);

    now += 200_000; // The pause is over.
    for (let read = 1; read < CATALOG_FILL_RECOVERY_READS; read++) backoff.note();
    expect(backoff.slowdown()).toBe(4);
    backoff.note();
    expect(backoff.slowdown()).toBe(2);
    // Kept across restarts.
    expect(catalogFillBackoff(() => 0, { storage, now: () => now }).slowdown()).toBe(2);
  });

  it("never slows down past its limit", () => {
    const storage = memoryStorage();
    let pauseUntil = 10;
    const backoff = catalogFillBackoff(() => pauseUntil, { storage, now: () => 0 });
    for (let refusal = 0; refusal < 20; refusal++) { pauseUntil += 10; backoff.note(); }
    expect(backoff.slowdown()).toBe(CATALOG_FILL_MAX_SLOWDOWN);
  });
});
