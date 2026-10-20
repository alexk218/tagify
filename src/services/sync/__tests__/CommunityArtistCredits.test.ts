import { describe, expect, it, vi } from "vitest";
import { artistCredits, resolveArtistCredits, runArtistCreditReports, type ArtistCreditSources, type SpotifyArtist } from "../CommunityArtistCredits";

const id = (prefix: string, index: number) => `${prefix}${String(index).padStart(22 - prefix.length, "0")}`;
const track = (index: number) => ({ provider: "spotify" as const, kind: "track" as const, providerId: id("track", index) });
const album = (index: number) => ({ provider: "spotify" as const, kind: "album" as const, providerId: id("album", index) });
const artist = (index: number, name = `Artist ${index}`): SpotifyArtist => ({ uri: `spotify:artist:${id("artist", index)}`, name });

function sources(overrides: Partial<ArtistCreditSources> = {}, budget = Number.POSITIVE_INFINITY): ArtistCreditSources {
  let left = budget;
  return {
    knownTrackArtists: vi.fn(() => null),
    trackAlbums: vi.fn(async () => new Map<string, string>()),
    albumTrackArtists: vi.fn(async () => null),
    trackArtists: vi.fn(async () => [artist(1)]),
    albumArtists: vi.fn(async () => [artist(2)]),
    reserve: vi.fn(() => left-- > 0),
    ...overrides,
  };
}

describe("artist credits Tagify sends Community", () => {
  it("keeps real Spotify artists with one-line names, in Spotify's order, without repeats", () => {
    expect(artistCredits([
      artist(1, "  Daft\nPunk "), artist(1, "Again"), { uri: "spotify:track:abc", name: "Not an artist" },
      artist(2, "   "), artist(3, "Pharrell Williams"),
    ])).toEqual([
      { providerId: id("artist", 1), name: "Daft Punk" },
      { providerId: id("artist", 3), name: "Pharrell Williams" },
    ]);
    expect(artistCredits(Array.from({ length: 25 }, (_, index) => artist(index)))).toHaveLength(20);
  });

  it("reads what Tagify already knows for free, songs sharing an album once, and the rest one at a time", async () => {
    const source = sources({
      knownTrackArtists: vi.fn((uri: string) => uri.endsWith(id("track", 1)) ? [artist(9)] : null),
      trackAlbums: vi.fn(async () => new Map([[`spotify:track:${id("track", 2)}`, "spotify:album:shared"], [`spotify:track:${id("track", 3)}`, "spotify:album:shared"]])),
      albumTrackArtists: vi.fn(async () => new Map([[`spotify:track:${id("track", 2)}`, [artist(5)]], [`spotify:track:${id("track", 3)}`, [artist(6)]]])),
    });
    const result = await resolveArtistCredits([track(1), track(2), track(3), track(4), album(1)], source, new Map());

    expect(result.found.map((item) => [item.entity.providerId, item.artists[0].providerId])).toEqual([
      [id("track", 1), id("artist", 9)], [id("track", 2), id("artist", 5)], [id("track", 3), id("artist", 6)],
      [id("track", 4), id("artist", 1)], [id("album", 1), id("artist", 2)],
    ]);
    expect(result.reads).toBe(3);
    expect(source.albumTrackArtists).toHaveBeenCalledTimes(1);
    expect(source.trackArtists).toHaveBeenCalledWith(`spotify:track:${id("track", 4)}`);
    expect(source.albumArtists).toHaveBeenCalledWith(`spotify:album:${id("album", 1)}`);
  });

  it("remembers music Spotify lists no artists for and doesn't read it again for a week", async () => {
    const source = sources({ trackArtists: vi.fn(async () => []) });
    const unavailable = new Map<string, number>();
    await resolveArtistCredits([track(1)], source, unavailable, 1_000);
    expect(unavailable.get(`spotify:track:${id("track", 1)}`)).toBe(1_000 + 7 * 24 * 60 * 60_000);
    await resolveArtistCredits([track(1)], source, unavailable, 2_000);
    expect(source.trackArtists).toHaveBeenCalledTimes(1);
  });

  it("stops at the hour's limit or Spotify's first refusal and keeps what it found", async () => {
    const limited = await resolveArtistCredits([track(1), track(2), track(3)], sources({}, 2), new Map());
    expect(limited).toMatchObject({ reads: 2, halted: "budget" });
    expect(limited.found).toHaveLength(2);

    const trackArtists = vi.fn().mockResolvedValueOnce([artist(1)]).mockRejectedValueOnce(Object.assign(new Error("429"), { status: 429 }));
    const refused = await resolveArtistCredits([track(1), track(2), track(3)], sources({ trackArtists }), new Map());
    expect(refused).toMatchObject({ reads: 2, halted: "spotify" });
    expect(refused.found).toHaveLength(1);
    expect(trackArtists).toHaveBeenCalledTimes(2);
  });
});

describe("sending artist credits", () => {
  const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId: "41900000-0000-4000-8000-000000000011" });
  const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };

  it("pages past music it can't answer and sends what it found", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === "POST") return Response.json({ accepted: 1, ignored: 0 });
      return String(url).includes("offset=0")
        ? Response.json({ items: [track(1), track(2)], hasMore: true })
        : Response.json({ items: [track(3)], hasMore: false });
    });
    const source = sources({ trackArtists: vi.fn(async (uri: string) => uri.endsWith(id("track", 2)) ? [] : [artist(1)]) });

    const run = await runArtistCreditReports(session, source, { request: request as typeof fetch, storage: memory() });

    expect(run).toEqual({ sent: 2, reads: 3 });
    expect(calls.map((call) => call.url)).toEqual([
      "https://community.test/api/v2/sync/artist-credits?deviceId=41900000-0000-4000-8000-000000000011&limit=500&offset=0",
      "https://community.test/api/v2/sync/artist-credits",
      "https://community.test/api/v2/sync/artist-credits?deviceId=41900000-0000-4000-8000-000000000011&limit=500&offset=1",
      "https://community.test/api/v2/sync/artist-credits",
    ]);
    expect(calls[1].body).toEqual({ protocolVersion: 1, deviceId: "41900000-0000-4000-8000-000000000011", items: [{ entity: track(1), artists: [{ providerId: id("artist", 1), name: "Artist 1" }] }] });
  });

  it("leaves Community alone when it doesn't have the feature or paused it, and never throws", async () => {
    for (const [status, stopped] of [[404, "unsupported"], [503, "paused"], [401, "signed_out"]] as const) {
      const source = sources();
      const run = await runArtistCreditReports(session, source, { request: vi.fn(async () => new Response(null, { status })) as typeof fetch, storage: memory() });
      expect(run).toEqual({ sent: 0, reads: 0, stopped });
      expect(source.trackArtists).not.toHaveBeenCalled();
    }
    const switchedOff = sources();
    const paused = await runArtistCreditReports(session, switchedOff, { request: vi.fn(async () => Response.json({ items: [], hasMore: false, paused: true })) as typeof fetch, storage: memory() });
    expect(paused).toEqual({ sent: 0, reads: 0, stopped: "paused" });
    expect(switchedOff.trackAlbums).not.toHaveBeenCalled();
    const offline = await runArtistCreditReports(session, sources(), { request: vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch, storage: memory() });
    expect(offline.stopped).toBe("network");
  });

  it("sends what it found before Spotify stopped answering, then stops", async () => {
    const posted: unknown[] = [];
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { posted.push(JSON.parse(String(init.body))); return Response.json({ accepted: 1, ignored: 0 }); }
      return Response.json({ items: [track(1), track(2)], hasMore: true });
    });
    const trackArtists = vi.fn().mockResolvedValueOnce([artist(1)]).mockRejectedValueOnce(new Error("Spotify paused"));
    const run = await runArtistCreditReports(session, sources({ trackArtists }), { request: request as typeof fetch, storage: memory() });
    expect(run).toEqual({ sent: 1, reads: 2, stopped: "spotify" });
    expect(posted).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
