import { assertSongReleaseReport } from "@tagify/sync-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  coverImage, releaseDate, resolveSongReleases, runSongReleaseReports, songReleaseAlbum,
  type SongReleaseSources, type SpotifyAlbumRelease,
} from "../CommunitySongReleases";

const id = (prefix: string, index: number) => `${prefix}${String(index).padStart(22 - prefix.length, "0")}`;
const track = (index: number) => ({ provider: "spotify" as const, kind: "track" as const, providerId: id("track", index) });
const trackUri = (index: number) => `spotify:track:${id("track", index)}`;
const albumUri = (index: number) => `spotify:album:${id("album", index)}`;
const cover = (width: number) => ({ url: `https://i.scdn.co/image/ab67616d0000${width}`, width, height: width });
const release = (overrides: Partial<SpotifyAlbumRelease> = {}): SpotifyAlbumRelease => ({
  name: "Discovery", type: "ALBUM", date: { isoString: "2001-03-12T00:00:00Z", precision: "DAY" },
  coverSources: [cover(64), cover(300), cover(640)], ...overrides,
});

function sources(overrides: Partial<SongReleaseSources> = {}, budget = Number.POSITIVE_INFINITY): SongReleaseSources {
  let left = budget;
  return {
    knownSongs: vi.fn(async () => new Map()),
    trackRelease: vi.fn(async () => ({ isrc: "GBDUW0000059", albumUri: albumUri(1) })),
    albumRelease: vi.fn(async () => release()),
    reserve: vi.fn(() => left-- > 0),
    ...overrides,
  };
}

describe("a song's release as Tagify sends it to Community", () => {
  it("keeps the release date only as precise as Spotify knows it", () => {
    expect(releaseDate({ isoString: "2001-03-12T00:00:00Z", precision: "DAY" })).toBe("2001-03-12");
    expect(releaseDate({ isoString: "2001-03-01T00:00:00Z", precision: "MONTH" })).toBe("2001-03");
    expect(releaseDate({ isoString: "2001-01-01T00:00:00Z", precision: "YEAR" })).toBe("2001");
    expect(releaseDate({ isoString: "2001-01-01T00:00:00Z" })).toBe("2001");
    expect(releaseDate({ year: 1997 })).toBe("1997");
    expect(releaseDate({ isoString: "soon" })).toBeNull();
    expect(releaseDate(null)).toBeNull();
  });

  it("picks Spotify's 300 px cover, else the largest up to 640 px, and only Spotify's image hosts", () => {
    expect(coverImage([cover(64), cover(300), cover(640)])).toBe(cover(300).url);
    expect(coverImage([cover(64), cover(640), cover(1000)])).toBe(cover(640).url);
    expect(coverImage([{ url: "https://example.com/cover.jpg", width: 300 }, cover(64)])).toBe(cover(64).url);
    expect(coverImage([{ url: "http://i.scdn.co/image/x", width: 300 }])).toBeNull();
    expect(coverImage(undefined)).toBeNull();
  });

  it("files an EP as a single and refuses releases it can't name accurately", () => {
    expect(songReleaseAlbum(albumUri(1), release({ type: "EP", name: "  Homework\n(Remixes) " }))).toEqual({
      providerId: id("album", 1), name: "Homework (Remixes)", albumType: "single", releaseDate: "2001-03-12", imageUrl: cover(300).url,
    });
    expect(songReleaseAlbum(albumUri(1), release({ type: "COMPILATION" }))?.albumType).toBe("compilation");
    expect(songReleaseAlbum(albumUri(1), release({ type: "AUDIOBOOK" }))).toBeNull();
    expect(songReleaseAlbum(albumUri(1), release({ type: undefined }))).toBeNull();
    expect(songReleaseAlbum(albumUri(1), release({ name: "   " }))).toBeNull();
    expect(songReleaseAlbum("spotify:album:short", release())).toBeNull();
    expect(songReleaseAlbum(albumUri(1), null)).toBeNull();
  });
});

describe("reading songs' releases", () => {
  it("uses the ISRC and album Tagify saved for free, reads each album once, and reads unknown songs one at a time", async () => {
    const source = sources({
      knownSongs: vi.fn(async () => new Map([
        [trackUri(1), { isrc: "GBDUW0000059", albumUri: albumUri(1) }],
        [trackUri(2), { isrc: "GBDUW0000060", albumUri: albumUri(1) }],
        [trackUri(3), { isrc: null, albumUri: albumUri(2) }],
      ])),
      trackRelease: vi.fn(async () => ({ isrc: "usdu-w00-00061", albumUri: albumUri(2) })),
      albumRelease: vi.fn(async (uri: string) => uri === albumUri(2) ? release({ name: "One More Time", type: "SINGLE" }) : release()),
    });

    const result = await resolveSongReleases([track(1), track(2), track(3)], source, new Map());

    expect(result.halted).toBeNull();
    expect(result.reads).toBe(3);
    expect(source.trackRelease).toHaveBeenCalledTimes(1);
    expect(source.trackRelease).toHaveBeenCalledWith(trackUri(3));
    expect(source.albumRelease).toHaveBeenCalledTimes(2);
    expect(result.found.map((item) => [item.entity.providerId, item.isrc, item.album.name, item.album.albumType])).toEqual([
      [id("track", 1), "GBDUW0000059", "Discovery", "album"],
      [id("track", 2), "GBDUW0000060", "Discovery", "album"],
      [id("track", 3), "USDUW0000061", "One More Time", "single"],
    ]);
    expect(() => assertSongReleaseReport({ protocolVersion: 1, deviceId: "41900000-0000-4000-8000-000000000011", items: result.found })).not.toThrow();
  });

  it("sends a song Spotify lists no ISRC for with none, and prefers the album Spotify names now", async () => {
    const source = sources({
      knownSongs: vi.fn(async () => new Map([[trackUri(1), { albumUri: albumUri(9) }]])),
      trackRelease: vi.fn(async () => ({ isrc: null, albumUri: albumUri(1) })),
    });
    const result = await resolveSongReleases([track(1)], source, new Map());
    expect(result.found).toEqual([expect.objectContaining({ isrc: null, album: expect.objectContaining({ providerId: id("album", 1) }) })]);
    expect(source.albumRelease).toHaveBeenCalledWith(albumUri(1));
  });

  it("skips songs Spotify can't place on a release for a week", async () => {
    const source = sources({
      trackRelease: vi.fn(async (uri: string) => uri === trackUri(1) ? undefined : uri === trackUri(2) ? { isrc: "GBDUW0000059", albumUri: null } : { isrc: "GBDUW0000060", albumUri: albumUri(1) }),
      albumRelease: vi.fn(async () => release({ type: "AUDIOBOOK" })),
    });
    const unavailable = new Map<string, number>();
    const first = await resolveSongReleases([track(1), track(2), track(3)], source, unavailable, new Map(), 1_000);
    expect(first.found).toEqual([]);
    expect([...unavailable.keys()]).toEqual([trackUri(1), trackUri(2), trackUri(3)]);
    expect(unavailable.get(trackUri(1))).toBe(1_000 + 7 * 24 * 60 * 60_000);

    await resolveSongReleases([track(1), track(2), track(3)], source, unavailable, new Map(), 2_000);
    expect(source.trackRelease).toHaveBeenCalledTimes(3);
  });

  it("stops at the hour's limit or Spotify's first refusal and keeps what it found", async () => {
    const limited = await resolveSongReleases([track(1), track(2), track(3)], sources({}, 3), new Map());
    // One album read, then one read per song while the hour allows.
    expect(limited).toMatchObject({ reads: 3, halted: "budget" });
    expect(limited.found).toHaveLength(2);

    const trackRelease = vi.fn()
      .mockResolvedValueOnce({ isrc: "GBDUW0000059", albumUri: albumUri(1) })
      .mockRejectedValueOnce(Object.assign(new Error("429"), { status: 429 }));
    const refused = await resolveSongReleases([track(1), track(2), track(3)], sources({ trackRelease }), new Map());
    expect(refused).toMatchObject({ reads: 3, halted: "spotify" });
    expect(refused.found).toHaveLength(1);
    expect(trackRelease).toHaveBeenCalledTimes(2);

    const albumRelease = vi.fn().mockRejectedValueOnce(new Error("Spotify paused"));
    const albumRefused = await resolveSongReleases([track(1)], sources({ albumRelease }), new Map());
    expect(albumRefused).toMatchObject({ reads: 2, halted: "spotify", found: [] });
  });
});

describe("sending song releases", () => {
  const deviceId = "41900000-0000-4000-8000-000000000011";
  const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId });
  const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };

  it("pages past songs it can't answer and sends what it found", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === "POST") return Response.json({ accepted: 1, ignored: 0 });
      return String(url).includes("offset=0")
        ? Response.json({ items: [track(1), track(2)], hasMore: true })
        : Response.json({ items: [track(3)], hasMore: false });
    });
    const source = sources({ trackRelease: vi.fn(async (uri: string) => uri === trackUri(2) ? undefined : { isrc: "GBDUW0000059", albumUri: albumUri(1) }) });

    const run = await runSongReleaseReports(session, source, { request: request as typeof fetch, storage: memory() });

    // Three songs, one album read shared by both found songs.
    expect(run).toEqual({ sent: 2, reads: 4 });
    expect(source.albumRelease).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => `${call.method ?? "GET"} ${call.url}`)).toEqual([
      `GET https://community.test/api/v2/sync/song-releases?deviceId=${deviceId}&limit=500&offset=0`,
      "POST https://community.test/api/v2/sync/song-releases",
      `GET https://community.test/api/v2/sync/song-releases?deviceId=${deviceId}&limit=500&offset=1`,
      "POST https://community.test/api/v2/sync/song-releases",
    ]);
    expect(calls[1].body).toEqual({
      protocolVersion: 1, deviceId,
      items: [{ entity: track(1), isrc: "GBDUW0000059", album: { providerId: id("album", 1), name: "Discovery", albumType: "album", releaseDate: "2001-03-12", imageUrl: cover(300).url } }],
    });
    expect(() => assertSongReleaseReport(calls[1].body)).not.toThrow();
  });

  it("sends at most 200 songs per request", async () => {
    const items = Array.from({ length: 450 }, (_, index) => track(index + 1));
    const posted: number[] = [];
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { posted.push(JSON.parse(String(init.body)).items.length); return Response.json({ accepted: 1, ignored: 0 }); }
      return Response.json({ items, hasMore: false });
    });
    const known = new Map(items.map((item) => [`spotify:track:${item.providerId}`, { isrc: "GBDUW0000059", albumUri: albumUri(1) }]));
    const run = await runSongReleaseReports(session, sources({ knownSongs: vi.fn(async () => known) }), { request: request as typeof fetch, storage: memory() });
    expect(posted).toEqual([200, 200, 50]);
    expect(run).toEqual({ sent: 450, reads: 1 });
  });

  it("leaves Community alone when it doesn't have the feature or paused it, and never throws", async () => {
    for (const [status, stopped] of [[404, "unsupported"], [503, "paused"], [401, "signed_out"]] as const) {
      const source = sources();
      const run = await runSongReleaseReports(session, source, { request: vi.fn(async () => new Response(null, { status })) as typeof fetch, storage: memory() });
      expect(run).toEqual({ sent: 0, reads: 0, stopped });
      expect(source.trackRelease).not.toHaveBeenCalled();
    }
    const switchedOff = sources();
    const paused = await runSongReleaseReports(session, switchedOff, { request: vi.fn(async () => Response.json({ items: [], hasMore: false, paused: true })) as typeof fetch, storage: memory() });
    expect(paused).toEqual({ sent: 0, reads: 0, stopped: "paused" });
    expect(switchedOff.knownSongs).not.toHaveBeenCalled();

    const offline = await runSongReleaseReports(session, sources(), { request: vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch, storage: memory() });
    expect(offline.stopped).toBe("network");
  });

  it("stops when Community pauses the feature after a report", async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ accepted: 0, ignored: 1, paused: true })
      : Response.json({ items: [track(1)], hasMore: true }));
    const run = await runSongReleaseReports(session, sources(), { request: request as typeof fetch, storage: memory() });
    expect(run).toEqual({ sent: 0, reads: 2, stopped: "paused" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("sends what it found before Spotify stopped answering, then stops", async () => {
    const posted: unknown[] = [];
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { posted.push(JSON.parse(String(init.body))); return Response.json({ accepted: 1, ignored: 0 }); }
      return Response.json({ items: [track(1), track(2)], hasMore: true });
    });
    const trackRelease = vi.fn().mockResolvedValueOnce({ isrc: "GBDUW0000059", albumUri: albumUri(1) }).mockRejectedValueOnce(new Error("Spotify paused"));
    const run = await runSongReleaseReports(session, sources({ trackRelease }), { request: request as typeof fetch, storage: memory() });
    expect(run).toEqual({ sent: 1, reads: 3, stopped: "spotify" });
    expect(posted).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
