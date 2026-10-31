import { assertCatalogFillReport } from "@tagify/sync-contracts";
import { describe, expect, it, vi } from "vitest";
import type { SpotifyAlbumTrack, SpotifyArtistRelease } from "@/services/SpotifyApiService";
import { catalogFillReleases, catalogFillTracks, runCatalogFillJobs, type CatalogFillJobSources } from "../CommunityCatalogFillJobs";

const id = (prefix: string, n: number) => `${prefix}${String(n).padStart(22 - prefix.length, "0")}`;
const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId: "11111111-1111-4111-8111-111111111111" });
const conservative = { preset: "conservative", readIntervalMs: 4_000, hourlyReads: 60, dailyReads: 300 };

const track = (n: number, extra: Partial<SpotifyAlbumTrack> = {}): SpotifyAlbumTrack => ({
  uri: `spotify:track:${id("t", n)}`, name: `Song ${n}`, artists: "Band", artistsData: [{ uri: `spotify:artist:${id("r", 1)}`, name: "Band" }],
  discNumber: 1, trackNumber: n, durationMs: 180_000 + n, ...extra,
});
const release = (n: number, type = "ALBUM"): SpotifyArtistRelease => ({
  uri: `spotify:album:${id("a", n)}`, name: `Release ${n}`, type, date: { isoString: "2024-06-01T00:00:00Z", precision: "DAY" },
});

/** Community's catalog fill route: pages of jobs, then the posted reports. */
function community(pages: unknown[], status = 200) {
  const posts: unknown[] = [];
  let page = 0;
  const request = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (status !== 200) return new Response("{}", { status });
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      assertCatalogFillReport(body);
      posts.push(...body.items);
      return new Response(JSON.stringify({ accepted: body.items.length, ignored: 0 }));
    }
    expect(url).toBe("https://community.test/api/v2/sync/catalog-fill?deviceId=11111111-1111-4111-8111-111111111111&limit=20");
    return new Response(JSON.stringify(pages[page++] ?? { filler: true, pace: conservative, items: [], hasMore: false }));
  }) as unknown as typeof fetch;
  return { request, posts };
}

function sources(overrides: Partial<CatalogFillJobSources> = {}, budget = Infinity) {
  const log: string[] = [];
  let left = budget;
  const savePace = vi.fn();
  const value: CatalogFillJobSources = {
    albumTracks: vi.fn(async (uri: string) => { log.push(`album ${uri}`); return [track(1), track(2)]; }),
    artistReleases: vi.fn(async (uri: string, beforePage: () => Promise<boolean>) => {
      if (!await beforePage()) return null;
      log.push(`artist ${uri}`);
      return [release(1), release(2, "EP"), release(3, "PODCAST")];
    }),
    allowance: {
      libraryTracks: async () => new Set(),
      reserve: (identity) => { if (left <= 0) return false; left -= 1; log.push(`reserve ${identity}`); return true; },
      pace: async () => { log.push("pace"); },
    },
    savePace,
    ...overrides,
  };
  return { value, log, savePace };
}

describe("catalog fill jobs", () => {
  it("reads nothing against a Community without the route (today's production) and asks again only after a start", async () => {
    const server = community([], 404);
    const spotify = sources();
    expect(await runCatalogFillJobs(session, spotify.value, { request: server.request })).toEqual({ sent: 0, reads: 0, stopped: "unsupported", cause: { kind: "community-http", status: 404, endpoint: "Community catalog-fill" } });
    expect(spotify.log).toEqual([]);
    expect(spotify.savePace).not.toHaveBeenCalled();
  });

  it("reads nothing on a desktop that isn't a filler, and forgets any pace", async () => {
    const server = community([{ filler: false, pace: null, items: [], hasMore: false }]);
    const spotify = sources();
    expect(await runCatalogFillJobs(session, spotify.value, { request: server.request })).toEqual({ sent: 0, reads: 0, filler: false });
    expect(spotify.log).toEqual([]);
    expect(spotify.savePace).toHaveBeenCalledWith(null);
  });

  it("reads each job once, at the pace, keeps the advertised pace and sends what Spotify said", async () => {
    const server = community([{ filler: true, pace: conservative, hasMore: false, items: [
      { kind: "artistDiscography", providerId: id("r", 1) }, { kind: "albumTracks", providerId: id("a", 9) },
      { kind: "somethingNewer", providerId: id("x", 1) },
    ] }]);
    const spotify = sources();
    expect(await runCatalogFillJobs(session, spotify.value, { request: server.request })).toEqual({ sent: 2, reads: 2, filler: true });
    expect(spotify.savePace).toHaveBeenCalledWith(conservative);
    expect(spotify.log).toEqual([
      `reserve catalog-fill:spotify:artist:${id("r", 1)}:0`, "pace", `artist spotify:artist:${id("r", 1)}`,
      `reserve catalog-fill:spotify:album:${id("a", 9)}`, "pace", `album spotify:album:${id("a", 9)}`,
    ]);
    expect(server.posts).toEqual([
      { kind: "artistDiscography", providerId: id("r", 1), outcome: "found", releases: [
        { providerId: id("a", 1), name: "Release 1", albumType: "album", releaseDate: "2024-06-01" },
        { providerId: id("a", 2), name: "Release 2", albumType: "ep", releaseDate: "2024-06-01" },
      ] },
      { kind: "albumTracks", providerId: id("a", 9), outcome: "found", tracks: [
        { disc: 1, position: 1, providerId: id("t", 1), name: "Song 1", artists: [{ providerId: id("r", 1), name: "Band" }], durationMs: 180_001 },
        { disc: 1, position: 2, providerId: id("t", 2), name: "Song 2", artists: [{ providerId: id("r", 1), name: "Band" }], durationMs: 180_002 },
      ] },
    ]);
  });

  it("says missing when Spotify has nothing usable", async () => {
    const server = community([{ filler: true, pace: conservative, hasMore: false, items: [
      { kind: "albumTracks", providerId: id("a", 9) }, { kind: "artistDiscography", providerId: id("r", 1) },
    ] }]);
    const spotify = sources({ albumTracks: vi.fn(async () => null), artistReleases: vi.fn(async (_uri, beforePage) => (await beforePage(), [release(1, "AUDIOBOOK")])) });
    await runCatalogFillJobs(session, spotify.value, { request: server.request });
    expect(server.posts).toEqual([
      { kind: "albumTracks", providerId: id("a", 9), outcome: "missing" }, { kind: "artistDiscography", providerId: id("r", 1), outcome: "missing" },
    ]);
  });

  it("stops when the allowance is used up, sending what it read and never a cut-short discography", async () => {
    const server = community([{ filler: true, pace: conservative, hasMore: true, items: [
      { kind: "albumTracks", providerId: id("a", 9) }, { kind: "artistDiscography", providerId: id("r", 1) }, { kind: "albumTracks", providerId: id("a", 8) },
    ] }]);
    const spotify = sources({}, 1);
    expect(await runCatalogFillJobs(session, spotify.value, { request: server.request })).toEqual({ sent: 1, reads: 1, filler: true, stopped: "budget" });
    expect(server.posts).toEqual([expect.objectContaining({ kind: "albumTracks", providerId: id("a", 9), outcome: "found" })]);
    expect(spotify.log.filter((line) => line.startsWith("album") || line.startsWith("artist"))).toEqual([`album spotify:album:${id("a", 9)}`]);
  });

  it("stops at Spotify's first refusal and never retries it", async () => {
    const server = community([{ filler: true, pace: conservative, hasMore: true, items: [
      { kind: "albumTracks", providerId: id("a", 9) }, { kind: "albumTracks", providerId: id("a", 8) },
    ] }]);
    const albumTracks = vi.fn(async () => { throw Object.assign(new Error("Spotify asked Tagify to pause requests."), { status: 429 }); });
    const spotify = sources({ albumTracks });
    expect(await runCatalogFillJobs(session, spotify.value, { request: server.request })).toEqual({ sent: 0, reads: 1, filler: true, stopped: "spotify", cause: { kind: "server-429", status: 429, endpoint: "GraphQL getAlbum" } });
    expect(albumTracks).toHaveBeenCalledTimes(1);
    expect(server.posts).toEqual([]);
  });

  it("skips one job Spotify fails to read with a 5xx, says why, and keeps going", async () => {
    const server = community([{ filler: true, pace: conservative, hasMore: false, items: [
      { kind: "artistDiscography", providerId: id("r", 9) }, { kind: "albumTracks", providerId: id("a", 1) },
    ] }]);
    const artistReleases = vi.fn(async (_uri: string, beforePage: () => Promise<boolean>) => {
      await beforePage();
      throw Object.assign(new Error("GraphQL request failed"), { status: 500 });
    });
    const spotify = sources({ artistReleases });
    expect(await runCatalogFillJobs(session, spotify.value, { request: server.request })).toEqual({
      sent: 1, reads: 2, filler: true, skipped: 1,
      lastSkip: { kind: "http-error", status: 500, endpoint: "GraphQL queryArtistDiscographyAll" },
    });
    expect(server.posts).toHaveLength(1);
  });

  it("stops when Spotify fails five reads in a row, with the cause", async () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => ({ kind: "albumTracks", providerId: id("a", n) }));
    const server = community([{ filler: true, pace: conservative, hasMore: true, items }]);
    const albumTracks = vi.fn(async () => { throw Object.assign(new Error("GraphQL request failed"), { status: 502 }); });
    const spotify = sources({ albumTracks });
    const failure = { kind: "http-error", status: 502, endpoint: "GraphQL getAlbum" };
    expect(await runCatalogFillJobs(session, spotify.value, { request: server.request })).toEqual({
      sent: 0, reads: 5, filler: true, stopped: "spotify", cause: failure, skipped: 4, lastSkip: failure,
    });
    expect(albumTracks).toHaveBeenCalledTimes(5);
  });

  it("asks for more pages while Community has them", async () => {
    const server = community([
      { filler: true, pace: conservative, hasMore: true, items: [{ kind: "albumTracks", providerId: id("a", 1) }] },
      { filler: true, pace: conservative, hasMore: false, items: [{ kind: "albumTracks", providerId: id("a", 2) }] },
    ]);
    const spotify = sources();
    expect(await runCatalogFillJobs(session, spotify.value, { request: server.request })).toEqual({ sent: 2, reads: 2, filler: true });
  });
});

describe("what the filler sends", () => {
  it("refuses a track list it can't vouch for", () => {
    expect(catalogFillTracks([track(1), track(1, { uri: `spotify:track:${id("t", 5)}` })])).toBeNull();
    expect(catalogFillTracks([track(1, { name: "  " })])).toBeNull();
    expect(catalogFillTracks([track(1, { uri: "spotify:local:x" })])).toBeNull();
    expect(catalogFillTracks([])).toBeNull();
  });

  it("keeps clean names, one entry per artist, and drops unknown lengths", () => {
    expect(catalogFillTracks([track(1, { name: " One\nTwo ", durationMs: undefined,
      artistsData: [{ uri: `spotify:artist:${id("r", 1)}`, name: "A" }, { uri: `spotify:artist:${id("r", 1)}`, name: "A" }, { uri: "bad", name: "B" }] })]))
      .toEqual([{ disc: 1, position: 1, providerId: id("t", 1), name: "One Two", artists: [{ providerId: id("r", 1), name: "A" }], durationMs: null }]);
  });

  it("keeps each release once, with the date at Spotify's precision", () => {
    expect(catalogFillReleases([
      { ...release(1), date: { isoString: "2024-01-01T00:00:00Z", precision: "YEAR" } }, release(1), { ...release(2), date: null },
    ])).toEqual([
      { providerId: id("a", 1), name: "Release 1", albumType: "album", releaseDate: "2024" },
      { providerId: id("a", 2), name: "Release 2", albumType: "album", releaseDate: null },
    ]);
    expect(catalogFillReleases([])).toBeNull();
  });
});
