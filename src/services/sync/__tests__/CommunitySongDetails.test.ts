import { assertSongDetailsReport, type SongDetailsReportItemV1 } from "@tagify/sync-contracts";
import { describe, expect, it, vi } from "vitest";
import { runSongDetailReports, songDetailsItem, type SavedSongDetails, type SongDetailSources } from "../CommunitySongDetails";

const deviceId = "22222222-2222-4222-8222-222222222222";
const id = (index: number) => `track${String(index).padStart(17, "0")}`;
const track = (index: number) => ({ provider: "spotify" as const, kind: "track" as const, providerId: id(index) });
const uri = (index: number) => `spotify:track:${id(index)}`;
const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId });

/**
 * Community as the route answers: newest first, a song listed until it has both a length and a
 * release date from this desktop, paged by offset.
 */
function community(songs: number, pageSize = 500) {
  const stored = new Map<string, { durationMs: number | null; releaseDate: string | null }>();
  const posts: SongDetailsReportItemV1[][] = [];
  const pages: number[] = [];
  const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as unknown;
      assertSongDetailsReport(body);
      expect(body.deviceId).toBe(deviceId);
      posts.push(body.items);
      for (const item of body.items) {
        const before = stored.get(item.entity.providerId);
        stored.set(item.entity.providerId, { durationMs: item.durationMs ?? before?.durationMs ?? null, releaseDate: item.releaseDate ?? before?.releaseDate ?? null });
      }
      return Response.json({ accepted: body.items.length, ignored: 0 });
    }
    const query = new URL(String(url)).searchParams;
    expect(query.get("deviceId")).toBe(deviceId);
    const offset = Number(query.get("offset"));
    pages.push(offset);
    const limit = Math.min(Number(query.get("limit")), pageSize);
    const needed = Array.from({ length: songs }, (_, index) => songs - index)
      .filter((index) => { const saved = stored.get(id(index)); return !saved?.durationMs || !saved.releaseDate; });
    return Response.json({ items: needed.slice(offset, offset + limit).map(track), hasMore: needed.length > offset + limit });
  });
  return { request: request as unknown as typeof fetch, stored, posts, pages, calls: request };
}

const library = (entries: Array<[number, SavedSongDetails]>): SongDetailSources => {
  const saved = new Map(entries.map(([index, details]) => [uri(index), details]));
  return { savedSongs: vi.fn(async (uris: string[]) => new Map(uris.flatMap((key) => saved.has(key) ? [[key, saved.get(key)!] as const] : []))) };
};

describe("song lengths and release dates as Tagify sends them to Community", () => {
  it("sends only plausible values, and nothing for songs Tagify knows neither for", () => {
    expect(songDetailsItem(track(1), { durationMs: 185_000, releaseDate: "2001-03-12" })).toEqual({ entity: track(1), durationMs: 185_000, releaseDate: "2001-03-12" });
    expect(songDetailsItem(track(1), { durationMs: 185_000 })).toEqual({ entity: track(1), durationMs: 185_000, releaseDate: null });
    expect(songDetailsItem(track(1), { releaseDate: "1997" })).toEqual({ entity: track(1), durationMs: null, releaseDate: "1997" });
    expect(songDetailsItem(track(1), { durationMs: 0, releaseDate: "soon" })).toBeNull();
    expect(songDetailsItem(track(1), { durationMs: 185_000.5, releaseDate: "2001-3-12" })).toBeNull();
    expect(songDetailsItem(track(1), undefined)).toBeNull();
  });

  it("sends the whole library page by page, 200 per request, and skips past songs it doesn't know yet", async () => {
    const server = community(1_300);
    // Every third song isn't filled in yet; every fifth has only its length so far.
    const sources = library(Array.from({ length: 1_300 }, (_, index) => index + 1).filter((index) => index % 3 !== 0)
      .map((index) => [index, index % 5 === 0 ? { durationMs: 200_000 + index } : { durationMs: 200_000 + index, releaseDate: "2020-05" }]));

    const run = await runSongDetailReports(session, sources, { request: server.request });

    const known = Array.from({ length: 1_300 }, (_, index) => index + 1).filter((index) => index % 3 !== 0);
    expect(run).toEqual({ sent: known.length });
    expect(new Set(server.posts.flat().map((item) => item.entity.providerId))).toEqual(new Set(known.map(id)));
    expect(server.posts.flat()).toHaveLength(known.length);
    expect(Math.max(...server.posts.map((items) => items.length))).toBeLessThanOrEqual(200);
    expect(server.stored.get(id(5))).toEqual({ durationMs: 200_005, releaseDate: null });
    expect(server.stored.has(id(3))).toBe(false);
  });

  it("sends nothing and stops when no song is known yet", async () => {
    const server = community(1_200);
    const run = await runSongDetailReports(session, library([]), { request: server.request });
    expect(run).toEqual({ sent: 0 });
    expect(server.posts).toEqual([]);
    expect(server.pages).toEqual([0, 500, 1_000]);
  });

  it("never sends a song twice in one run, even when Community keeps it in place", async () => {
    let gets = 0;
    const posted: string[] = [];
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { posted.push(...JSON.parse(String(init.body)).items.map((item: SongDetailsReportItemV1) => item.entity.providerId)); return Response.json({ accepted: 0, ignored: 1 }); }
      gets += 1;
      return Response.json({ items: [track(1), track(2)], hasMore: gets < 3 });
    });
    const run = await runSongDetailReports(session, library([[1, { durationMs: 1_000, releaseDate: "2000" }]]), { request: request as typeof fetch });
    expect(posted).toEqual([id(1)]);
    expect(run.sent).toBe(1);
  });

  it("stops quietly on a Community without the route, a paused one, a signed-out device or no connection", async () => {
    for (const [status, stopped] of [[404, "unsupported"], [503, "paused"], [401, "signed_out"], [403, "signed_out"], [500, "network"]] as const) {
      const run = await runSongDetailReports(session, library([]), { request: vi.fn(async () => new Response(null, { status })) as typeof fetch });
      expect(run).toEqual({ sent: 0, stopped });
    }
    const switchedOff = library([[1, { durationMs: 1_000 }]]);
    const paused = await runSongDetailReports(session, switchedOff, { request: vi.fn(async () => Response.json({ items: [], hasMore: false, paused: true })) as typeof fetch });
    expect(paused).toEqual({ sent: 0, stopped: "paused" });
    expect(switchedOff.savedSongs).not.toHaveBeenCalled();
    const offline = await runSongDetailReports(session, library([]), { request: vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch });
    expect(offline).toEqual({ sent: 0, stopped: "network" });
  });

  it("stops when Community pauses while songs are being sent", async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ accepted: 0, ignored: 1, paused: true })
      : Response.json({ items: [track(1)], hasMore: true }));
    const run = await runSongDetailReports(session, library([[1, { durationMs: 1_000 }]]), { request: request as typeof fetch });
    expect(run.stopped).toBe("paused");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("ignores an answer that isn't a song details list", async () => {
    const run = await runSongDetailReports(session, library([]), { request: vi.fn(async () => Response.json({ items: [{ provider: "spotify", kind: "album", providerId: id(1) }], hasMore: false })) as typeof fetch });
    expect(run).toEqual({ sent: 0, stopped: "network" });
  });
});
