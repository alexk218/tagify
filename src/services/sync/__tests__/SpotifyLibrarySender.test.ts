import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { pullSideDocuments } from "../SyncRuntime";
import { communityFolders, communitySong, FOLDERS_MAX, imageUrl, isNewSpotifyLibraryRequest, listParts, LISTS_MAX_SONGS, markSpotifyLibraryRequestHandled, readSpotifyLibrary, sendSpotifyLibrary, SpotifyLibrarySendError, type LibraryReader } from "../SpotifyLibrarySender";
import type { DesktopSyncConfiguration } from "../SyncLocalState";

const id = (n: number) => `S${String(n).padStart(21, "0")}`;
const track = (n: number, extra: Partial<SpotifyTrack> = {}): SpotifyTrack => ({
  uri: `spotify:track:${id(n)}`, name: `Song ${n}`, artists: [{ name: "One" }, { name: "Two" }], album: { name: "Album", images: [{ url: "spotify:image:big" }, { url: "spotify:image:small" }] }, duration_ms: 1000, ...extra,
});
const configuration = { accountId: "account", libraryId: "library", deviceId: "11111111-1111-4111-8111-111111111111", apiBaseUrl: "https://community.example", accessToken: "token" } as DesktopSyncConfiguration;

function reader(liked: SpotifyTrack[], playlists: Record<string, SpotifyTrack[]>, names: Record<string, string> = {}): LibraryReader & { pages: number[] } {
  const pages: number[] = [];
  return {
    pages,
    getTaggingQueuePage: async (playlistId, offset = 0) => {
      expect(playlistId).toBeNull();
      pages.push(offset);
      const page = liked.slice(offset, offset + 50);
      return { tracks: page, nextOffset: offset + 50 < liked.length ? offset + 50 : null };
    },
    getAllUserPlaylistReferencesStrict: async () => Object.keys(playlists).map((playlistId) => ({ playlistId, playlistName: names[playlistId] ?? `List ${playlistId.slice(-2)}` })),
    readPlaylistTracks: async (playlistId) => playlists[playlistId],
  };
}

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe("sending Spotify lists to Community", () => {
  it("reads Liked Songs oldest first and every playlist, keeping each song once with its names", async () => {
    const liked = Array.from({ length: 120 }, (_, index) => track(index + 1));
    const source = reader(liked, {
      [id(900)]: [track(5), track(5), track(6, { uri: "spotify:local:a:b:c:1" }), track(7)],
      [id(901)]: [],
    }, { [id(900)]: "Gym\u0007" });
    const lists = await readSpotifyLibrary(source);
    expect(source.pages).toEqual([0, 50, 100]);
    expect(lists[0]).toMatchObject({ id: "liked", kind: "liked", name: "Liked Songs", position: 0, playlistId: null });
    expect(lists[0].songs[0]).toBe(id(120));
    expect(lists[0].songs.at(-1)).toBe(id(1));
    expect(lists[1]).toMatchObject({ id: id(900), kind: "playlist", name: "Gym", position: 1, playlistId: id(900), songs: [id(5), id(7)] });
    expect(lists[1].names[0]).toEqual(["Song 5", "One, Two", "Album", "https://i.scdn.co/image/small"]);
    expect(lists[2].songs).toEqual([]);
  });

  it("keeps each playlist's folders, and Liked Songs in none", async () => {
    const source = reader([track(1)], { [id(900)]: [track(2)], [id(901)]: [track(3)] });
    source.getAllUserPlaylistReferencesStrict = async () => [
      { playlistId: id(900), playlistName: "Tempo", folders: [{ id: "f1", name: "Workout" }, { id: "f2", name: " Running\u0007" }] },
      { playlistId: id(901), playlistName: "Loose" },
    ];
    const lists = await readSpotifyLibrary(source);
    expect(lists.map((list) => list.folders)).toEqual([[], [{ id: "f1", name: "Workout" }, { id: "f2", name: "Running" }], []]);
    expect(listParts(lists[1])[0]).toMatchObject({ folders: [{ id: "f1", name: "Workout" }, { id: "f2", name: "Running" }] });
  });

  it("keeps folders within what Community keeps: 8 levels and 2,000 folders", () => {
    const deep = Array.from({ length: 10 }, (_, level) => ({ id: `d${level}`, name: `Level ${level}` }));
    expect(communityFolders(deep, new Set()).map((folder) => folder.id)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
    const known = new Set(Array.from({ length: FOLDERS_MAX - 1 }, (_, index) => `k${index}`));
    // The member's 2,000th folder still fits; a list in a folder beyond it sits in the deepest one that does.
    expect(communityFolders([{ id: "k0", name: "Known" }, { id: "new1", name: "New" }, { id: "new2", name: "Newer" }], known).map((folder) => folder.id)).toEqual(["k0", "new1"]);
    expect(communityFolders([{ id: "new3", name: "Too many" }], known)).toEqual([]);
    expect(communityFolders([{ id: "ok", name: "" }, { id: "not ok", name: "Bad" }], new Set())).toEqual([{ id: "ok", name: "Untitled folder" }]);
    expect(communityFolders(undefined, new Set())).toEqual([]);
  });

  it("never cuts a name in the middle of an emoji", async () => {
    const name = `${"a".repeat(199)}😀 and more`;
    const source = reader([], { [id(900)]: [track(2)] }, { [id(900)]: name });
    const [, list] = await readSpotifyLibrary(source);
    expect(list.name).toBe(`${"a".repeat(199)}😀`);
    expect(Array.from(list.name)).toHaveLength(200);
    expect(JSON.stringify(list.name)).not.toMatch(/\\ud83d"/i);
  });

  it("stops adding songs at Community's limit across lists", async () => {
    const big = Array.from({ length: 50_000 }, (_, index) => track(index + 1));
    const lists = await readSpotifyLibrary(reader([], { [id(901)]: big, [id(902)]: big, [id(903)]: big, [id(904)]: big }));
    expect(lists.reduce((sum, list) => sum + list.songs.length, 0)).toBe(LISTS_MAX_SONGS);
  });

  it("splits a long list into parts of 10,000 songs from chunk boundaries", () => {
    const songs = Array.from({ length: 25_000 }, (_, index) => id(index));
    const parts = listParts({ id: "liked", kind: "liked", name: "Liked Songs", position: 0, playlistId: null, songs, names: songs.map(() => [null, null, null, null]), folders: [] });
    expect(parts.map((part) => [part.fromChunk, part.songs.length, part.last])).toEqual([[0, 10_000, false], [10, 10_000, false], [20, 5_000, true]]);
    expect(listParts({ id: "e", kind: "playlist", name: "Empty", position: 1, playlistId: null, songs: [], names: [], folders: [] })).toEqual([expect.objectContaining({ songCount: 0, fromChunk: 0, songs: [], last: true })]);
  });

  it("sends each part, then finishes, under one revision", async () => {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(init.method === "POST" ? { lists: 2, songs: 3 } : { complete: true }), { status: 200 });
    });
    const result = await sendSpotifyLibrary(configuration, [
      { id: "liked", kind: "liked", name: "Liked Songs", position: 0, playlistId: null, songs: [id(1), id(2)], names: [[null, null, null, null], [null, null, null, null]], folders: [] },
      { id: id(900), kind: "playlist", name: "Gym", position: 1, playlistId: id(900), songs: [id(3)], names: [[null, null, null, null]], folders: [] },
    ], request as unknown as typeof fetch);
    expect(result).toEqual({ lists: 2, songs: 3 });
    expect(calls.map((call) => call.method)).toEqual(["PUT", "PUT", "POST"]);
    expect(new Set(calls.map((call) => call.body.revision)).size).toBe(1);
    expect(calls[0].body).toMatchObject({ deviceId: configuration.deviceId, list: { id: "liked", songCount: 2, last: true } });
    expect(request.mock.calls[0][0]).toBe("https://community.example/api/v2/sync/spotify-library");
  });

  it("reports Community's refusal", async () => {
    const request = async () => new Response(JSON.stringify({ error: { code: "spotify_lists_daily_limit", message: "Try again tomorrow." } }), { status: 429 });
    await expect(sendSpotifyLibrary(configuration, [], request as unknown as typeof fetch)).rejects.toThrow(SpotifyLibrarySendError);
  });

  it("answers each website request once", () => {
    expect(isNewSpotifyLibraryRequest(configuration, null)).toBe(false);
    expect(isNewSpotifyLibraryRequest(configuration, "2026-10-19T12:00:00.123456+00:00")).toBe(true);
    markSpotifyLibraryRequestHandled(configuration, "2026-10-19T12:00:00.123456+00:00");
    expect(isNewSpotifyLibraryRequest(configuration, "2026-10-19T12:00:00.123456+00:00")).toBe(false);
    expect(isNewSpotifyLibraryRequest(configuration, "2026-10-19T12:05:00Z")).toBe(true);
  });

  it("reads the website's request from a pull and keeps covers on Spotify's image host", () => {
    expect(pullSideDocuments({ sideDocuments: { localFilesRevision: 2, privateNotesCursor: 5, spotifyLibraryRequestedAt: "2026-10-19T12:00:00Z" } }))
      .toEqual({ localFilesRevision: 2, privateNotesCursor: 5, spotifyLibraryRequestedAt: "2026-10-19T12:00:00Z" });
    expect(imageUrl(track(1, { album: { name: "A", images: [{ url: "http://insecure.example/x.jpg" }] } }))).toBeNull();
    expect(communitySong(track(1, { uri: "spotify:episode:x" }))).toBeNull();
  });
});
