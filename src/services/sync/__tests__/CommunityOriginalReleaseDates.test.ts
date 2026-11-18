import { IDBFactory } from "fake-indexeddb";
import type { OriginalReleaseDateItemV1 } from "@tagify/sync-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { normalizeTagDataStructure } from "@/features/tag-data/utils/tagData.schema";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { MAX_ORIGINAL_RELEASE_DATE_PAGES, runOriginalReleaseDates, withOriginalReleaseDate, type OriginalReleaseDateSources } from "../CommunityOriginalReleaseDates";
import { communityOriginalReleaseDateSources } from "../CommunityOriginalReleaseDateSources";
import { getTagifyDatabaseName } from "../SyncLocalState";

const deviceId = "22222222-2222-4222-8222-222222222222";
const id = (index: number) => `track${String(index).padStart(17, "0")}`;
const uri = (index: number) => `spotify:track:${id(index)}`;
const item = (index: number, releaseDate: string): OriginalReleaseDateItemV1 => ({ entity: { provider: "spotify", kind: "track", providerId: id(index) }, releaseDate });
const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId });

/** Community's route: every date it knows for this library, `pageSize` at a time. */
function community(items: OriginalReleaseDateItemV1[], pageSize = 500) {
  const offsets: number[] = [];
  const request = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/v2/sync/original-release-dates");
    expect(init?.method ?? "GET").toBe("GET");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token");
    expect(parsed.searchParams.get("deviceId")).toBe(deviceId);
    expect((init?.headers as Record<string, string>)["x-tagify-sync-protocol"]).toBeTruthy();
    const offset = Number(parsed.searchParams.get("offset"));
    offsets.push(offset);
    const next = offset + pageSize;
    // Community leaves out songs it no longer has a date for, so a page can be short and still have more after it.
    return Response.json({ protocolVersion: 1, items: items.slice(offset, next).filter((entry) => entry.releaseDate !== "skip"), nextOffset: next < items.length ? next : null });
  });
  return { request: request as unknown as typeof fetch, offsets };
}

const collecting = () => {
  const saved = new Map<string, string>();
  const sources: OriginalReleaseDateSources = { save: vi.fn(async (dates: Map<string, string>) => { dates.forEach((date, key) => saved.set(key, date)); return dates.size; }) };
  return { saved, sources };
};

describe("original release dates from Community", () => {
  it("reads every page and saves each song's date", async () => {
    const server = community(Array.from({ length: 1_203 }, (_, index) => item(index, "1977-06")));
    const { saved, sources } = collecting();

    expect(await runOriginalReleaseDates(session, sources, { request: server.request })).toEqual({ pages: 3, saved: 1_203 });
    expect(server.offsets).toEqual([0, 500, 1_000]);
    expect(saved.get(uri(0))).toBe("1977-06");
    expect(saved.size).toBe(1_203);
  });

  it("keeps reading past a short page until Community says it was the last", async () => {
    // The whole first page and half the second are left out: 0 then 250 songs, then the last 3.
    const server = community(Array.from({ length: 1_003 }, (_, index) => item(index, index < 750 ? "skip" : "2001")));
    const { saved, sources } = collecting();
    expect(await runOriginalReleaseDates(session, sources, { request: server.request })).toEqual({ pages: 3, saved: 253 });
    expect(server.offsets).toEqual([0, 500, 1_000]);
    expect(saved.has(uri(0))).toBe(false);
    expect(saved.get(uri(1_002))).toBe("2001");
  });

  it("stops after 200 pages at most", async () => {
    const server = community(Array.from({ length: 300 }, (_, index) => item(index, "1990")), 1);
    const { sources } = collecting();
    const run = await runOriginalReleaseDates(session, sources, { request: server.request });
    expect(run.pages).toBe(MAX_ORIGINAL_RELEASE_DATE_PAGES);
    expect(server.offsets).toHaveLength(200);
  });

  it.each([
    [404, "unsupported"], [503, "paused"], [401, "signed_out"], [403, "signed_out"], [500, "network"],
  ] as const)("stops quietly when Community answers %i", async (status, stopped) => {
    const { sources } = collecting();
    const request = vi.fn(async () => new Response("", { status })) as unknown as typeof fetch;
    expect(await runOriginalReleaseDates(session, sources, { request })).toEqual({ pages: 0, saved: 0, stopped });
    expect(sources.save).not.toHaveBeenCalled();
  });

  it("stops when Community is paused, unreachable or answers something it can't check", async () => {
    const { sources } = collecting();
    const paused = vi.fn(async () => Response.json({ protocolVersion: 1, items: [], nextOffset: null, paused: true })) as unknown as typeof fetch;
    expect((await runOriginalReleaseDates(session, sources, { request: paused })).stopped).toBe("paused");
    const offline = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect((await runOriginalReleaseDates(session, sources, { request: offline })).stopped).toBe("network");
    const invalid = vi.fn(async () => Response.json({ protocolVersion: 1, items: [item(1, "1977-13")], nextOffset: null })) as unknown as typeof fetch;
    expect((await runOriginalReleaseDates(session, sources, { request: invalid })).stopped).toBe("invalid");
    const backwards = vi.fn(async () => Response.json({ protocolVersion: 1, items: [], nextOffset: 0 })) as unknown as typeof fetch;
    expect((await runOriginalReleaseDates(session, sources, { request: backwards })).stopped).toBe("invalid");
    expect(sources.save).not.toHaveBeenCalled();
  });

  it("changes a song only when its date is new", () => {
    const song: TrackData = { rating: 4, energy: 0, bpm: null, tagIds: ["tag_a"], releaseDate: "2011", dateModified: 10 };
    expect(withOriginalReleaseDate(song, "1977")).toEqual({ ...song, originalReleaseDate: "1977" });
    expect(withOriginalReleaseDate({ ...song, originalReleaseDate: "1977" }, "1977")).toBeUndefined();
    expect(withOriginalReleaseDate(song, "someday")).toBeUndefined();
  });
});

describe("saving original release dates in this library", () => {
  const tagged: TrackData = { name: "Song", artists: "Artist", rating: 3, energy: 5, bpm: 120, tagIds: ["tag_a"], releaseDate: "2011-03-01", dateCreated: 5, dateModified: 1_700_000_000_123 };
  const other: TrackData = { ...tagged, releaseDate: "1999", originalReleaseDate: "1977", dateModified: 42 };

  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await indexedDBStorage.init()).toBe(true);
    expect(await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { [uri(1)]: tagged, [uri(2)]: other } } as TagDataStructure)).toBe(true);
  });
  afterEach(() => { indexedDBStorage.resetConnection(); vi.unstubAllGlobals(); });

  it("saves only the date: Last Updated, tags and ratings stay exactly as they were, and no song is added", async () => {
    const sources = communityOriginalReleaseDateSources(getTagifyDatabaseName());
    const changed = await sources.save(new Map([[uri(1), "1977-06-01"], [uri(2), "1977"], [uri(3), "1980"]]));

    expect(changed).toBe(1);
    const { tracks } = await indexedDBStorage.loadAllStrict();
    expect(tracks[uri(1)]).toEqual({ ...tagged, originalReleaseDate: "1977-06-01" });
    expect(tracks[uri(1)].dateModified).toBe(1_700_000_000_123);
    expect(tracks[uri(2)]).toEqual(other);
    expect(tracks[uri(3)]).toBeUndefined();

    // A newer date replaces the saved one, still without touching Last Updated.
    expect(await sources.save(new Map([[uri(2), "1975"]]))).toBe(1);
    expect((await indexedDBStorage.loadAllStrict()).tracks[uri(2)]).toEqual({ ...other, originalReleaseDate: "1975" });
  });

  it("keeps the date through a backup and restore", () => {
    const restored = normalizeTagDataStructure({ ...defaultTagData, tracks: { [uri(1)]: { ...tagged, originalReleaseDate: "1977" }, [uri(2)]: { ...tagged, originalReleaseDate: "77" } } });
    expect(restored.tracks[uri(1)].originalReleaseDate).toBe("1977");
    expect(restored.tracks[uri(2)].originalReleaseDate).toBeUndefined();
  });

  it("writes nothing into another account's library", async () => {
    const sources = communityOriginalReleaseDateSources("another-account");
    await expect(sources.save(new Map([[uri(1), "1977"]]))).rejects.toThrow();
    expect((await indexedDBStorage.loadAllStrict()).tracks[uri(1)]).toEqual(tagged);
  });
});
