import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const spotify = () => new Proxy({}, { get: (_target, name) => { throw new Error(`Spotify was asked for ${String(name)}`); } });
  return {
    getTracks: vi.fn(), getPlaylist: vi.fn(), getArtist: vi.fn(),
    spotifyApiService: spotify(), spotifyService: spotify(), spotifyBackgroundPolicy: spotify(),
  };
});
vi.mock("@/services/storage/StorageService", () => ({ storageService: { getTracks: mocks.getTracks, getPlaylist: mocks.getPlaylist, getArtist: mocks.getArtist } }));
// Names come only from Tagify's saved library: touching any Spotify service fails the test.
vi.mock("@/services/SpotifyApiService", () => ({ spotifyApiService: mocks.spotifyApiService }));
vi.mock("@/services/SpotifyService", () => ({ spotifyService: mocks.spotifyService }));
vi.mock("@/services/SpotifyBackgroundPolicy", () => ({ spotifyBackgroundPolicy: mocks.spotifyBackgroundPolicy }));
import { resolveSongNames, runSongNameReports, songNameItem, type SongNameSources } from "../CommunitySongNames";
import { communitySongNameSources } from "../CommunitySongNameSources";

const id = (prefix: string, index: number) => `${prefix}${String(index).padStart(22 - prefix.length, "0")}`;
const track = (index: number) => ({ provider: "spotify" as const, kind: "track" as const, providerId: id("track", index) });
const album = (index: number) => ({ provider: "spotify" as const, kind: "album" as const, providerId: id("album", index) });
const artist = (index: number) => ({ provider: "spotify" as const, kind: "artist" as const, providerId: id("artist", index) });
const art = (index: number) => `https://i.scdn.co/image/ab67616d0000b273${String(index).padStart(24, "0")}`;

function sources(overrides: Partial<SongNameSources> = {}): SongNameSources {
  return {
    savedSongs: vi.fn(async (uris: string[]) => new Map(uris.map((uri, index) => [uri, { name: `Song ${index}`, imageUrl: art(index) }] as const))),
    savedAlbum: vi.fn(async () => null),
    savedArtist: vi.fn(async () => null),
    ...overrides,
  };
}

describe("song names Tagify sends Community", () => {
  beforeEach(() => { mocks.getTracks.mockReset(); mocks.getPlaylist.mockReset(); mocks.getArtist.mockReset(); });

  it("keeps one-line names and Spotify's artwork, and drops stand-in titles and other image hosts", () => {
    expect(songNameItem(track(1), { name: "  Get\nLucky ", imageUrl: art(1) })).toEqual({ entity: track(1), title: "Get Lucky", thumbnailUrl: art(1) });
    expect(songNameItem(track(1), { name: "Get Lucky", imageUrl: "https://example.com/cover.jpg" })).toEqual({ entity: track(1), title: "Get Lucky", thumbnailUrl: null });
    expect(songNameItem(track(1), { name: `Spotify track · ${id("track", 1)}`, imageUrl: art(1) })).toBeNull();
    expect(songNameItem(track(1), { name: "   " }, null, undefined)).toBeNull();
    // A later source fills what an earlier one lacks.
    expect(songNameItem(album(1), { name: "Discovery", imageUrl: null }, { name: "Other", imageUrl: art(2) })).toEqual({ entity: album(1), title: "Discovery", thumbnailUrl: art(2) });
  });

  it("names songs, albums and artists from what Tagify saved, and skips what it never saved", async () => {
    mocks.getTracks.mockResolvedValue(new Map([
      [`spotify:track:${id("track", 1)}`, { name: "One More Time", albumImageUrl: art(1), albumUri: `spotify:album:${id("album", 2)}`, albumName: "Discovery", rating: 0, energy: 0, bpm: null, tagIds: [] }],
      [`spotify:track:${id("track", 2)}`, { rating: 3, energy: 0, bpm: null, tagIds: [] }],
    ]));
    mocks.getPlaylist.mockImplementation(async (uri: string) => uri.endsWith(id("album", 1)) ? { name: "Homework", imageUrl: art(3), rating: 0, energy: 0, tagIds: [] } : null);
    mocks.getArtist.mockImplementation(async (uri: string) => uri.endsWith(id("artist", 1)) ? { name: "Daft Punk", imageUrl: art(4), rating: 0, energy: 0, tagIds: [] } : null);

    const found = await resolveSongNames([track(1), track(2), track(3), album(1), album(2), album(3), artist(1), artist(2)], communitySongNameSources());

    expect(found).toEqual([
      { entity: track(1), title: "One More Time", thumbnailUrl: art(1) },
      { entity: album(1), title: "Homework", thumbnailUrl: art(3) },
      // An album Tagify keeps no record for takes the name its song on this page was saved with.
      { entity: album(2), title: "Discovery", thumbnailUrl: art(1) },
      { entity: artist(1), title: "Daft Punk", thumbnailUrl: art(4) },
    ]);
    expect(mocks.getTracks).toHaveBeenCalledTimes(1);
    expect(mocks.getTracks).toHaveBeenCalledWith([`spotify:track:${id("track", 1)}`, `spotify:track:${id("track", 2)}`, `spotify:track:${id("track", 3)}`]);
  });
});

describe("sending song names", () => {
  const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId: "41900000-0000-4000-8000-000000000011" });

  it("sends what Tagify saved in reports of at most 200 and pages past music it can't name", async () => {
    const calls: Array<{ url: string; body?: { items: Array<{ entity: { providerId: string } }> } }> = [];
    const firstPage = Array.from({ length: 450 }, (_, index) => track(index));
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === "POST") return Response.json({ accepted: 1, ignored: 0 });
      return String(url).includes("offset=0") ? Response.json({ items: firstPage, hasMore: true }) : Response.json({ items: [track(1_000)], hasMore: false });
    });
    // Every tenth song was never saved with a name.
    const source = sources({
      savedSongs: vi.fn(async (uris: string[]) => new Map(uris.flatMap((uri, index) => index % 10 ? [[uri, { name: `Song ${index}`, imageUrl: art(index) }] as const] : []))),
    });

    const run = await runSongNameReports(session, source, { request: request as typeof fetch });

    expect(run).toEqual({ sent: 405 });
    expect(calls.map((call) => [call.url, call.body?.items.length])).toEqual([
      ["https://community.test/api/v2/sync/song-names?deviceId=41900000-0000-4000-8000-000000000011&limit=500&offset=0", undefined],
      ["https://community.test/api/v2/sync/song-names", 200],
      ["https://community.test/api/v2/sync/song-names", 200],
      ["https://community.test/api/v2/sync/song-names", 5],
      ["https://community.test/api/v2/sync/song-names?deviceId=41900000-0000-4000-8000-000000000011&limit=500&offset=45", undefined],
    ]);
    expect(calls[1].body).toMatchObject({ protocolVersion: 1, deviceId: "41900000-0000-4000-8000-000000000011" });
    expect(calls[1].body?.items[0]).toEqual({ entity: track(1), title: "Song 1", thumbnailUrl: art(1) });
    const headers = new Headers((request.mock.calls[1][1] as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("stops after a bounded number of pages even if Community keeps asking", async () => {
    const request = vi.fn(async () => Response.json({ items: [track(1)], hasMore: true }));
    const run = await runSongNameReports(session, sources({ savedSongs: vi.fn(async () => new Map()) }), { request: request as typeof fetch });
    expect(run).toEqual({ sent: 0 });
    expect(request).toHaveBeenCalledTimes(20);
  });

  it("leaves Community alone when it doesn't have the feature, paused it or signed this computer out, and never throws", async () => {
    for (const [status, stopped] of [[404, "unsupported"], [503, "paused"], [401, "signed_out"], [403, "signed_out"]] as const) {
      const source = sources();
      const run = await runSongNameReports(session, source, { request: vi.fn(async () => new Response(null, { status })) as typeof fetch });
      expect(run).toEqual({ sent: 0, stopped });
      expect(source.savedSongs).not.toHaveBeenCalled();
    }
    const switchedOff = sources();
    const paused = await runSongNameReports(session, switchedOff, { request: vi.fn(async () => Response.json({ items: [track(1)], hasMore: false, paused: true })) as typeof fetch });
    expect(paused).toEqual({ sent: 0, stopped: "paused" });
    expect(switchedOff.savedSongs).not.toHaveBeenCalled();

    const pausedOnSend = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ accepted: 0, ignored: 0, paused: true })
      : Response.json({ items: [track(1)], hasMore: true }));
    expect(await runSongNameReports(session, sources(), { request: pausedOnSend as typeof fetch })).toEqual({ sent: 0, stopped: "paused" });
    expect(pausedOnSend).toHaveBeenCalledTimes(2);

    const offline = await runSongNameReports(session, sources(), { request: vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch });
    expect(offline.stopped).toBe("network");
    const unexpected = await runSongNameReports(session, sources(), { request: vi.fn(async () => Response.json({ items: "nope" })) as typeof fetch });
    expect(unexpected.stopped).toBe("network");
  });
});
