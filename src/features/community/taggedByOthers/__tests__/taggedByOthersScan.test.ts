import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { RootlistCatalogPlaylist } from "@/services/SpotifyApiService";
import {
  LIKED_PAGE_SONGS,
  LOOKUP_CONCURRENCY, LOOKUP_MAX_SONGS, PLAYLISTS_PER_CHECK, PLAYLIST_SONGS_PER_CHECK, TaggedByOthersLookupError, planPlaylists, playlistReads, lookupTaggedByOthers, savedLookupLimit, scanTaggedByOthers,
  type TaggedByOthersItem,
} from "../taggedByOthersScan";
import { capabilitiesCacheKey } from "@/services/sync/SyncRuntime";

const idOf = (index: number) => `song${String(index).padStart(18, "0")}`;
const track = (index: number): SpotifyTrack => ({
  uri: `spotify:track:${idOf(index)}`,
  name: `Song ${index}`,
  artists: [{ name: "Artist" }],
  album: { name: "Album", images: [{ url: "https://i.scdn.co/image/cover" }] },
  duration_ms: 1,
});

const playlistId = (index: number) => `list${String(index).padStart(18, "0")}`;

/** Liked Songs as Spotify pages them, 50 at a time, and the member's playlists in library order. */
function library(tracks: SpotifyTrack[], failAtOffset?: number, failure: unknown = new Error("Spotify couldn't check those tracks."), playlists: (SpotifyTrack[] | Error)[] = []) {
  const getTaggingQueuePage = vi.fn(async (_playlistId: string | null, offset = 0, _signal?: AbortSignal, _pageSize?: number) => {
    if (offset === failAtOffset) throw failure;
    const page = tracks.slice(offset, offset + 50);
    return { tracks: page, nextOffset: offset + 50 < tracks.length ? offset + 50 : null };
  });
  const getAllUserPlaylistReferencesStrict = vi.fn(async () => playlists.map((_, index) => ({ playlistId: playlistId(index), playlistName: `Playlist ${index}` })));
  const readPlaylistTracks = vi.fn(async (id: string) => {
    const songs = playlists[Number(id.slice(4))];
    if (songs instanceof Error) throw songs;
    return songs;
  });
  // The playlists as a playlist check is given them, in library order.
  const chosen = playlists.map((_, index) => ({ playlistId: playlistId(index) }));
  return { getTaggingQueuePage, getAllUserPlaylistReferencesStrict, readPlaylistTracks, chosen };
}
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => track(from + index));

const tagged = (index: number, label = "Chill"): TaggedByOthersItem => ({ providerId: idOf(index), people: 2, peopleCapped: false, sample: ["ana"], tags: [{ label, paths: [`Mood / ${label}`], people: 2 }] });
const noSleep = async () => {};
/** Liked Songs, then (unless that stopped) every playlist, as "Also check my playlists" carries on from it. */
async function likedThenPlaylists(pages: ReturnType<typeof library>, options: Omit<Parameters<typeof scanTaggedByOthers>[0], "library">) {
  const liked = await scanTaggedByOthers({ library: pages, ...options });
  return liked.stopped ? liked : scanTaggedByOthers({ library: pages, playlists: pages.chosen, continueFrom: liked, ...options });
}
const session = () => ({ apiBaseUrl: "https://community.tagify.fm", accessToken: "token-a", deviceId: "device-a" });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("checking Liked Songs for other members' tags", () => {
  it("asks Community about 500 songs a request and keeps Liked Songs order", async () => {
    // Community answers in its own order, and only for songs it was asked about.
    const lookup = vi.fn(async (songs: string[]) => [700, 3, 1].filter((index) => songs.includes(idOf(index))).map((index) => tagged(index)));
    const progress: number[] = [];
    const outcome = await scanTaggedByOthers({
      library: library(Array.from({ length: 1_120 }, (_, index) => track(index))),
      lookup, sleep: noSleep, pausedUntil: () => 0, onProgress: ({ checked }) => progress.push(checked),
    });

    expect(lookup.mock.calls.map(([songs]) => songs.length)).toEqual([500, 500, 120]);
    expect(outcome.stopped).toBeNull();
    expect(outcome.checked).toBe(1_120);
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 1", "Song 3", "Song 700"]);
    expect(outcome.matches[0].tags).toEqual([{ label: "Chill", paths: ["Mood / Chill"], people: 2 }]);
    expect(progress[progress.length - 1]).toBe(1_120);
  });

  it("reads Liked Songs 500 songs a page, each page one read against the allowance", async () => {
    const reader = library(range(0, 120));
    const take = vi.fn(() => true);
    await scanTaggedByOthers({ library: reader, lookup: async () => [], sleep: noSleep, pausedUntil: () => 0, allowance: { take } });
    expect(reader.getTaggingQueuePage.mock.calls.every((call) => call[3] === LIKED_PAGE_SONGS)).toBe(true);
    expect(take).toHaveBeenCalledTimes(reader.getTaggingQueuePage.mock.calls.length);
  });

  it("waits out Tagify's own hold on desktop reads, without counting or sending more, then finishes", async () => {
    const stall = Object.assign(new Error("Spotify is taking too long to respond."), { spotifyRequestStopped: true, recoveryRequired: true });
    const reader = library(range(0, 120));
    const read = reader.getTaggingQueuePage.getMockImplementation()!;
    let holds = 3;
    reader.getTaggingQueuePage.mockImplementation(async (...args) => { if (holds-- > 0) throw stall; return read(...args); });
    const take = vi.fn(() => true);
    const sleep = vi.fn(async () => {});
    const outcome = await scanTaggedByOthers({ library: reader, lookup: async () => [], sleep, pausedUntil: () => 0, allowance: { take } });

    expect(outcome).toMatchObject({ stopped: null, checked: 120 });
    expect(sleep).toHaveBeenCalledWith(2_000);
    // The held page counts once.
    expect(take).toHaveBeenCalledTimes(reader.getTaggingQueuePage.mock.calls.length - 3);
  });

  it("stops when the hold lasts over a minute, and never waits out Spotify asking it to slow down", async () => {
    const stall = Object.assign(new Error("Spotify is taking too long to respond."), { spotifyRequestStopped: true, recoveryRequired: true });
    const held = library(range(0, 120));
    held.getTaggingQueuePage.mockRejectedValue(stall);
    const waits: number[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcome = await scanTaggedByOthers({ library: held, lookup: async () => [], sleep: async (ms) => { waits.push(ms); }, pausedUntil: () => 0 });
    expect(outcome.stopped).toBe("spotify");
    expect(waits.filter((ms) => ms === 2_000)).toHaveLength(30);

    const busy = library(range(0, 120), 0, Object.assign(new Error("Too many requests"), { status: 429, headers: { "retry-after": "30" } }));
    const sleep = vi.fn(async () => {});
    expect((await scanTaggedByOthers({ library: busy, lookup: async () => [], sleep, pausedUntil: () => 0 })).stopped).toBe("spotify");
    expect(busy.getTaggingQueuePage).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("continues a Liked Songs check from the songs it already checked", async () => {
    const lookup = vi.fn(async (songs: string[]) => songs.includes(idOf(4)) ? [tagged(4)] : []);
    const earlier = { scope: "liked" as const, checked: 3, matches: [], playlistsRead: 0, playlists: null, stopped: null, skippedPlaylists: 0, capped: false,
      songIds: [idOf(0), idOf(1), idOf(2)], playlistIds: [], playlistsLeft: null };
    const outcome = await scanTaggedByOthers({ library: library(range(0, 6)), continueFrom: earlier, lookup, sleep: noSleep, pausedUntil: () => 0 });
    expect(lookup.mock.calls.map(([songs]) => songs)).toEqual([[idOf(3), idOf(4), idOf(5)]]);
    expect(outcome).toMatchObject({ checked: 6, stopped: null });
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 4"]);
  });

  it("asks about a song once, however often it appears, and skips local files", async () => {
    const local: SpotifyTrack = { ...track(9), uri: "spotify:local:Artist:Album:Song:120" };
    const lookup = vi.fn(async (_songs: string[]) => [] as TaggedByOthersItem[]);
    const outcome = await scanTaggedByOthers({
      library: library([track(1), track(2), track(1), local, track(2), track(3)]),
      lookup, sleep: noSleep, pausedUntil: () => 0,
    });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0]).toEqual([idOf(1), idOf(2), idOf(3)]);
    expect(outcome.checked).toBe(3);
  });

  it("never has more than two requests waiting on Community", async () => {
    let waiting = 0;
    let most = 0;
    const lookup = vi.fn(async () => {
      most = Math.max(most, ++waiting);
      await new Promise((resolve) => setTimeout(resolve, 5));
      waiting -= 1;
      return [] as TaggedByOthersItem[];
    });
    await scanTaggedByOthers({
      library: library(Array.from({ length: 400 }, (_, index) => track(index))),
      lookup, batchSize: 50, sleep: noSleep, pausedUntil: () => 0,
    });

    expect(lookup).toHaveBeenCalledTimes(8);
    expect(most).toBe(LOOKUP_CONCURRENCY);
  });

  it("stops at a page Spotify can't read, keeps what it read, and doesn't read again", async () => {
    const busy = Object.assign(new Error("Spotify needs a short break. Wait a moment, then check more tracks."), { status: 429 });
    const pages = library(Array.from({ length: 300 }, (_, index) => track(index)), 100, busy);
    const lookup = vi.fn(async () => [tagged(4)]);
    const outcome = await scanTaggedByOthers({ library: pages, lookup, sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome.stopped).toBe("spotify");
    expect(outcome.checked).toBe(100);
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 4"]);
    // Pages 0, 50 and the failing 100: nothing after it, and no second try.
    expect(pages.getTaggingQueuePage.mock.calls.map(([, offset]) => offset)).toEqual([0, 50, 100]);
  });

  it("reads nothing while Spotify's requested pause holds", async () => {
    const pages = library([track(1)]);
    const lookup = vi.fn(async () => [] as TaggedByOthersItem[]);
    const outcome = await scanTaggedByOthers({ library: pages, lookup, sleep: noSleep, pausedUntil: () => Date.now() + 60_000 });

    expect(outcome).toMatchObject({ checked: 0, matches: [], stopped: "spotify" });
    expect(pages.getTaggingQueuePage).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    ["not-available", "a Community without the lookup"],
    ["paused", "a paused lookup"],
    ["busy", "a Community that asked to wait"],
    ["unreachable", "a Community that can't be reached"],
  ] as const)("stops reading Spotify after %s (%s) and keeps earlier results", async (reason, _what) => {
    const pages = library(Array.from({ length: 2_000 }, (_, index) => track(index)));
    let asked = 0;
    const lookup = vi.fn(async () => {
      asked += 1;
      if (asked === 1) return [tagged(7)];
      throw new TaggedByOthersLookupError(reason);
    });
    const outcome = await scanTaggedByOthers({ library: pages, lookup, batchSize: 100, sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome.stopped).toBe(reason);
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 7"]);
    expect(pages.getTaggingQueuePage.mock.calls.length).toBeLessThan(10);
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(1 + LOOKUP_CONCURRENCY);
  });

  it("reads only Liked Songs by default: never the playlist list or a playlist", async () => {
    const pages = library(range(0, 60), undefined, undefined, [range(40, 100), range(90, 130)]);
    const lookup = vi.fn(async (songs: string[]) => [5, 95].filter((index) => songs.includes(idOf(index))).map((index) => tagged(index)));
    const outcome = await scanTaggedByOthers({ library: pages, lookup, sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome).toMatchObject({ scope: "liked", checked: 60, stopped: null, playlistsRead: 0, playlists: null, skippedPlaylists: 0 });
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 5"]);
    expect(pages.getTaggingQueuePage).toHaveBeenCalledTimes(2);
    expect(pages.getAllUserPlaylistReferencesStrict).not.toHaveBeenCalled();
    expect(pages.readPlaylistTracks).not.toHaveBeenCalled();
  });

  it("carries on into playlists from a Liked Songs check, asking about a song once, however many lists hold it", async () => {
    const pages = library(range(0, 60), undefined, undefined, [range(40, 100), range(0, 60), range(90, 130)]);
    const lookup = vi.fn(async (songs: string[]) => [5, 95, 120].filter((index) => songs.includes(idOf(index))).map((index) => tagged(index)));
    const liked = await scanTaggedByOthers({ library: pages, lookup, sleep: noSleep, pausedUntil: () => 0 });
    expect(liked).toMatchObject({ scope: "liked", checked: 60, playlistIds: [], playlistsLeft: null });
    expect(liked.songIds).toHaveLength(60);

    const seen: { playlistsRead: number; playlists: number | null }[] = [];
    const outcome = await scanTaggedByOthers({
      library: pages, playlists: pages.chosen, continueFrom: liked, lookup, sleep: noSleep, pausedUntil: () => 0,
      onProgress: ({ playlistsRead, playlists }) => seen.push({ playlistsRead, playlists }),
    });

    const asked = lookup.mock.calls.flatMap(([songs]) => songs);
    expect(asked).toHaveLength(130);
    expect(new Set(asked).size).toBe(130);
    expect(outcome).toMatchObject({ scope: "liked+playlists", checked: 130, stopped: null, playlistsRead: 3, playlists: 3 });
    expect(outcome.playlistIds).toEqual(pages.chosen.map((playlist) => playlist.playlistId));
    expect(outcome.songIds).toHaveLength(130);
    // Liked Songs first, then songs only playlists hold, in the order they were read.
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 5", "Song 95", "Song 120"]);
    // Liked Songs isn't read again, and nor is the playlist list: the check was given its playlists.
    expect(pages.getTaggingQueuePage).toHaveBeenCalledTimes(2);
    expect(pages.getAllUserPlaylistReferencesStrict).not.toHaveBeenCalled();
    expect(pages.readPlaylistTracks).toHaveBeenCalledTimes(3);
    expect(seen[seen.length - 1]).toEqual({ playlistsRead: 3, playlists: 3 });
  });

  it("stops when the read limit is reached, keeps what it found, and reads nothing more", async () => {
    const pages = library(range(0, 300));
    let left = 3;
    const allowance = { take: vi.fn((reads: number) => (left -= reads) >= 0) };
    const lookup = vi.fn(async (songs: string[]) => [7, 120].filter((index) => songs.includes(idOf(index))).map((index) => tagged(index)));
    const outcome = await scanTaggedByOthers({ library: pages, lookup, allowance, sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome).toMatchObject({ stopped: "allowance", checked: 150 });
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 7", "Song 120"]);
    // Three pages were allowed; the fourth was never asked of Spotify.
    expect(pages.getTaggingQueuePage).toHaveBeenCalledTimes(3);
  });

  it("counts a playlist read by its size, and stops before a playlist it has no allowance for", async () => {
    const pages = library([], undefined, undefined, [range(0, 10), range(10, 20)]);
    const allowance = { take: vi.fn((reads: number) => reads <= 3) };
    const outcome = await scanTaggedByOthers({
      library: pages, playlists: [{ playlistId: playlistId(0), songCount: 250 }, { playlistId: playlistId(1), songCount: 900 }],
      lookup: vi.fn(async () => []), allowance, sleep: noSleep, pausedUntil: () => 0,
    });

    expect(allowance.take.mock.calls.map(([reads]) => reads)).toEqual([3, 9]);
    expect(outcome).toMatchObject({ stopped: "allowance", checked: 10, playlistIds: [playlistId(0)] });
    expect(pages.readPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it("passes over a playlist Spotify can't read, says so, and finishes the rest", async () => {
    const broken = new Error("Spotify returned incomplete playlist occurrences");
    const pages = library(range(0, 10), undefined, undefined, [range(10, 20), broken, range(20, 30)]);
    const lookup = vi.fn(async (songs: string[]) => [3, 15, 25].filter((index) => songs.includes(idOf(index))).map((index) => tagged(index)));
    const outcome = await likedThenPlaylists(pages, { lookup, sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome).toMatchObject({ checked: 30, stopped: null, playlistsRead: 3, playlists: 3, skippedPlaylists: 1, capped: false });
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 3", "Song 15", "Song 25"]);
    // Each playlist is read once: the unreadable one is not tried again.
    expect(pages.readPlaylistTracks).toHaveBeenCalledTimes(3);
  });

  it("stops when playlist after playlist can't be read", async () => {
    const broken = new Error("Spotify couldn't be reached");
    const pages = library(range(0, 10), undefined, undefined, Array.from({ length: 12 }, () => broken));
    const outcome = await likedThenPlaylists(pages, { lookup: vi.fn(async () => [tagged(3)]), sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome).toMatchObject({ checked: 10, stopped: "spotify" });
    expect(pages.readPlaylistTracks).toHaveBeenCalledTimes(5);
  });

  it("says when the library holds more songs than one check covers", async () => {
    const pages = library(range(0, 120), undefined, undefined, [range(120, 200), range(200, 260)]);
    const lookup = vi.fn(async (_songs: string[]) => [] as TaggedByOthersItem[]);
    const outcome = await likedThenPlaylists(pages, { lookup, maxSongs: 150, sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome).toMatchObject({ checked: 150, stopped: null, capped: true });
    expect(lookup.mock.calls.flatMap(([songs]) => songs)).toHaveLength(150);
    // The second playlist is never read.
    expect(pages.readPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it("keeps a member's name and count with each song", async () => {
    const lookup = vi.fn(async (): Promise<TaggedByOthersItem[]> => [{ ...tagged(2), people: 7, peopleCapped: true, sample: ["ana", "sam"] }]);
    const outcome = await scanTaggedByOthers({ library: library(range(0, 5)), lookup, sleep: noSleep, pausedUntil: () => 0 });
    expect(outcome.matches[0]).toMatchObject({ people: 7, peopleCapped: true, sample: ["ana", "sam"], position: 2 });
  });

  it("stops at a playlist read Spotify answers with a slow-down, keeps what it found, and reads no further", async () => {
    const busy = Object.assign(new Error("Spotify asked Tagify to pause requests."), { status: 429 });
    const pages = library(range(0, 10), undefined, undefined, [range(10, 20), busy, range(20, 30)]);
    const lookup = vi.fn(async (songs: string[]) => [3, 15, 25].filter((index) => songs.includes(idOf(index))).map((index) => tagged(index)));
    const outcome = await likedThenPlaylists(pages, { lookup, sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome).toMatchObject({ checked: 20, stopped: "spotify", playlistsRead: 1, playlists: 3 });
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 3", "Song 15"]);
    // The first playlist, then the one Spotify refused: no second try and no third playlist.
    expect(pages.readPlaylistTracks).toHaveBeenCalledTimes(2);
  });

  it("keeps what it found when Community has checked as much as it will, and reads no more playlists", async () => {
    const pages = library(range(0, 200), undefined, undefined, Array.from({ length: 30 }, (_, index) => range(1_000 + index * 200, 1_200 + index * 200)));
    let asked = 0;
    const lookup = vi.fn(async () => {
      asked += 1;
      if (asked === 1) return [tagged(7)];
      throw new TaggedByOthersLookupError("busy");
    });
    const outcome = await likedThenPlaylists(pages, { lookup, sleep: noSleep, pausedUntil: () => 0 });

    expect(outcome.stopped).toBe("busy");
    expect(outcome.matches.map((match) => match.track.name)).toEqual(["Song 7"]);
    expect(pages.readPlaylistTracks.mock.calls.length).toBeLessThan(6);
    expect(lookup.mock.calls.length).toBeLessThanOrEqual(1 + LOOKUP_CONCURRENCY);
  });

  it("stops quietly when the view closes", async () => {
    const controller = new AbortController();
    const pages = library(Array.from({ length: 600 }, (_, index) => track(index)));
    const lookup = vi.fn(async () => { controller.abort(); return [tagged(1)]; });
    const onProgress = vi.fn();
    const outcome = await scanTaggedByOthers({ library: pages, lookup, batchSize: 50, signal: controller.signal, onProgress, sleep: noSleep, pausedUntil: () => 0 });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
    expect(outcome.stopped).toBeNull();
  });
});

describe("asking Community", () => {
  const answer = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));

  it("sends this device's session and the songs, and reads members' tags with their place", async () => {
    const request = answer(200, { items: [
      { providerId: idOf(1), entityId: "entity-1", others: { people: 3, peopleCapped: false, sample: ["ana"], tags: [
        { label: "Chill", key: "chill", people: 3, path: "Mood / Chill" },
        { label: "Late night", key: "late night", people: 1, path: null },
        { label: " ", key: "", people: 1, path: null },
      ] } },
      { providerId: idOf(2), entityId: "entity-2", others: { people: 1, peopleCapped: false, sample: [], tags: [] } },
    ] });
    const items = await lookupTaggedByOthers([idOf(1), idOf(2)], { request: request as unknown as typeof fetch, session });

    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://community.tagify.fm/api/v2/sync/tagged-by-others");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-a");
    expect(JSON.parse(String(init.body))).toEqual({ deviceId: "device-a", songs: [idOf(1), idOf(2)] });
    expect(items).toEqual([{ providerId: idOf(1), people: 3, peopleCapped: false, sample: ["ana"], tags: [
      { label: "Chill", paths: ["Mood / Chill"], people: 3 },
      { label: "Late night", paths: ["Late night"], people: 1 },
    ] }]);
  });

  it.each([
    [404, { error: "not_found" }, "not-available"],
    [503, { error: "tagged_by_others_paused" }, "paused"],
    [429, { error: "tagged_by_others_limited" }, "busy"],
    [500, {}, "unreachable"],
    [401, {}, "unreachable"],
  ] as const)("reads a %i as %s (%s) and asks once", async (status, body, reason) => {
    const request = answer(status, body, status === 429 ? { "retry-after": "30" } : {});
    await expect(lookupTaggedByOthers([idOf(1)], { request: request as unknown as typeof fetch, session })).rejects.toMatchObject({ reason });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("calls a failed connection unreachable", async () => {
    const request = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(lookupTaggedByOthers([idOf(1)], { request: request as unknown as typeof fetch, session })).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("sends nothing while the session waits to be refreshed", async () => {
    const request = answer(200, { items: [] });
    await expect(lookupTaggedByOthers([idOf(1)], { request: request as unknown as typeof fetch, session: () => null })).rejects.toMatchObject({ reason: "unreachable" });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("what Community last said about the lookup", () => {
  const base = "https://community.tagify.fm";
  const save = (value: unknown) => localStorage.setItem(capabilitiesCacheKey(base), JSON.stringify({ cachedAt: Date.now(), value }));

  it("is unknown without a saved list, missing when the list has no lookup, and capped at 500 songs", () => {
    expect(savedLookupLimit(base)).toBeUndefined();
    save({ supportedProtocolVersions: [2] });
    expect(savedLookupLimit(base)).toBeNull();
    save({ taggedByOthersLookup: { maxSongs: 200 } });
    expect(savedLookupLimit(base)).toBe(200);
    save({ taggedByOthersLookup: { maxSongs: 5_000 } });
    expect(savedLookupLimit(base)).toBe(LOOKUP_MAX_SONGS);
  });
});

describe("which playlists a press of \"Also check my playlists\" reads", () => {
  const listed = (index: number, extra: Partial<RootlistCatalogPlaylist> = {}): RootlistCatalogPlaylist => ({
    playlistId: playlistId(index), playlistName: `Playlist ${index}`, folders: [], owned: false, ownerName: null, songCount: 40, ...extra,
  });

  it("reads only playlists the member made, never followed ones, Spotify's mixes, empty ones or ones already checked", () => {
    const catalog = [listed(0), listed(1, { owned: true }), listed(2, { spotifyMade: true, owned: true }), listed(3, { songCount: 0, owned: true }), listed(4, { owned: true }), listed(5, { owned: true }), listed(6, { songCount: null, owned: true })];
    const { left, next } = planPlaylists(catalog, [playlistId(5)]);
    expect(left.map((playlist) => playlist.playlistName)).toEqual(["Playlist 1", "Playlist 4", "Playlist 6"]);
    expect(next).toEqual(left);
  });

  it("reads only the playlists the member chose, and never a followed one even when it was chosen", () => {
    const catalog = [listed(0), listed(1, { owned: true }), listed(4, { owned: true })];
    expect(planPlaylists(catalog, [], [playlistId(0), playlistId(4)]).next.map((playlist) => playlist.playlistName)).toEqual(["Playlist 4"]);
    expect(planPlaylists(catalog, [], []).next).toEqual([]);
  });

  it("stops at 100 playlists or about 20,000 songs a press, and always reads at least one", () => {
    expect(planPlaylists(Array.from({ length: 250 }, (_, index) => listed(index, { owned: true })), []).next).toHaveLength(PLAYLISTS_PER_CHECK);
    const big = planPlaylists(Array.from({ length: 10 }, (_, index) => listed(index, { songCount: 6_000, owned: true })), []);
    expect(big.next).toHaveLength(Math.floor(PLAYLIST_SONGS_PER_CHECK / 6_000));
    expect(big.left).toHaveLength(10);
    expect(planPlaylists([listed(0, { songCount: 90_000, owned: true })], []).next).toHaveLength(1);
  });

  it("costs a read per 100 songs", () => {
    expect([playlistReads(null), playlistReads(0), playlistReads(100), playlistReads(101), playlistReads(2_500)]).toEqual([1, 1, 1, 2, 25]);
  });
});
