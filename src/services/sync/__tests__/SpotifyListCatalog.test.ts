import { afterEach, describe, expect, it, vi } from "vitest";
import { rootlistCatalog } from "@/services/SpotifyApiService";
import { pullSideDocuments } from "../SyncRuntime";
import { isNewCatalogRequest, markCatalogRequestHandled, sendSpotifyListCatalog, spotifyListCatalog } from "../SpotifyListCatalog";

const id = (n: number) => `P${String(n).padStart(21, "0")}`;
const session = async () => ({ apiBaseUrl: "https://community.example", accessToken: "token", deviceId: "11111111-1111-4111-8111-111111111111" });

// Shaped like Spotify 1.2.92's RootlistAPI.getContents() items (seen 2026-10-21).
const tree = [
  { type: "playlist", uri: `spotify:playlist:${id(1)}`, name: "Night drives", isOwnedBySelf: true, canEditItems: true, totalLength: 42, owner: { displayName: "Alex", username: "alex.k" } },
  { type: "folder", name: "Friends", hash: "a1b2c3d4e5f60718", items: [
    { type: "playlist", uri: `spotify:playlist:${id(2)}`, name: "Sam's indie", isOwnedBySelf: false, canEditItems: false, totalLength: 120, owner: { displayName: "Sam", username: "sam99" } },
    { type: "playlist", uri: `spotify:playlist:${id(3)}`, name: "Road trip", isOwnedBySelf: false, canEditItems: true, totalLength: 15, owner: { displayName: "Kim" } },
  ] },
  { type: "playlist", uri: `spotify:playlist:${id(4)}`, name: "Mystery" },
];

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("the playlist list Community's picker shows", () => {
  it("knows which playlists the member made, from Spotify's own flags", () => {
    expect(rootlistCatalog(tree)).toEqual([
      { playlistId: id(1), playlistName: "Night drives", folders: [], owned: true, ownerName: null, songCount: 42 },
      { playlistId: id(2), playlistName: "Sam's indie", folders: [{ id: "a1b2c3d4e5f60718", name: "Friends" }], owned: false, ownerName: "Sam", songCount: 120 },
      // A collaborative playlist the member can edit counts as theirs.
      { playlistId: id(3), playlistName: "Road trip", folders: [{ id: "a1b2c3d4e5f60718", name: "Friends" }], owned: true, ownerName: null, songCount: 15 },
      // Spotify didn't say: not counted as the member's.
      { playlistId: id(4), playlistName: "Mystery", folders: [], owned: false, ownerName: null, songCount: null },
    ]);
  });

  it("builds the catalog in Spotify's order, without account names", () => {
    const catalog = spotifyListCatalog({ likedCount: 900, playlists: rootlistCatalog(tree) });
    expect(catalog.likedCount).toBe(900);
    expect(catalog.playlists.map((playlist) => [playlist.position, playlist.name, playlist.owned])).toEqual([[1, "Night drives", true], [2, "Sam's indie", false], [3, "Road trip", true], [4, "Mystery", false]]);
    expect(JSON.stringify(catalog)).not.toMatch(/alex\.k|sam99/);
  });

  it("shortens long names with emoji to what Community takes", () => {
    // A real 359-character name with emoji made the whole catalog fail on 2026-10-23.
    const long = `${"🔥 Late night ".repeat(30)}end`;
    const catalog = spotifyListCatalog({ likedCount: null, playlists: [
      { playlistId: id(1), playlistName: long, folders: [{ id: "f1", name: long }], owned: false, ownerName: long, songCount: 1 },
    ] });
    const [playlist] = catalog.playlists;
    for (const name of [playlist.name, playlist.folders[0].name, playlist.ownerName!]) {
      expect(name.length).toBeLessThanOrEqual(200);
      expect(long.startsWith(name)).toBe(true);
      expect(name).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });

  it("keeps at most 2,000 playlists", () => {
    const many = Array.from({ length: 2_100 }, (_, n) => ({ playlistId: id(n), playlistName: `List ${n}`, folders: [], owned: true, ownerName: null, songCount: 1 }));
    expect(spotifyListCatalog({ likedCount: null, playlists: many }).playlists).toHaveLength(2_000);
  });

  it("sends the catalog to Community and answers each request once", async () => {
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    const reader = { readSpotifyListCatalog: async () => ({ likedCount: 3, playlists: rootlistCatalog(tree) }) };
    expect(await sendSpotifyListCatalog(session, reader, "2026-10-21T18:00:00Z", request as unknown as typeof fetch)).toBe("sent");
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://community.example/api/v2/sync/spotify-library/catalog");
    expect(JSON.parse(String(init.body))).toMatchObject({ deviceId: "11111111-1111-4111-8111-111111111111", requestedAt: "2026-10-21T18:00:00Z", catalog: { likedCount: 3 } });

    expect(isNewCatalogRequest("lib", "2026-10-21T18:00:00Z")).toBe(true);
    markCatalogRequestHandled("lib", "2026-10-21T18:00:00Z");
    expect(isNewCatalogRequest("lib", "2026-10-21T18:00:00Z")).toBe(false);
    expect(isNewCatalogRequest("lib", "2026-10-21T18:05:00Z")).toBe(true);
  });

  it("reports an older Community", async () => {
    const reader = { readSpotifyListCatalog: async () => ({ likedCount: 3, playlists: [] }) };
    const request = vi.fn(async () => new Response("", { status: 404 }));
    expect(await sendSpotifyListCatalog(session, reader, "2026-10-21T18:00:00Z", request as unknown as typeof fetch)).toBe("unsupported");
    expect(request).toHaveBeenCalledTimes(1);
  });

  // On 2026-10-23 a catalog Tagify couldn't make left the picker waiting with no word from Tagify.
  it("tells Community why the playlists couldn't be listed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const answers = async (reader: Parameters<typeof sendSpotifyListCatalog>[1], first = 200) => {
      const request = vi.fn(async (_url: string, init: RequestInit) => new Response("{}", { status: "catalog" in JSON.parse(String(init.body)) ? first : 200 }));
      expect(await sendSpotifyListCatalog(session, reader, "2026-10-21T18:00:00Z", request as unknown as typeof fetch)).toBe("failed");
      return request.mock.calls.map(([url, init]) => [url, JSON.parse(String(init.body))]);
    };
    const failure = (code: string) => ["https://community.example/api/v2/sync/spotify-library/catalog", { deviceId: "11111111-1111-4111-8111-111111111111", requestedAt: "2026-10-21T18:00:00Z", failure: code }];

    expect(await answers({ readSpotifyListCatalog: async () => { throw new Error("Spotify did not return your playlists"); } })).toEqual([failure("spotify")]);
    const unlistable = { likedCount: -1, playlists: [] };
    expect(await answers({ readSpotifyListCatalog: async () => unlistable })).toEqual([failure("invalid")]);
    const rejected = await answers({ readSpotifyListCatalog: async () => ({ likedCount: 3, playlists: rootlistCatalog(tree) }) }, 400);
    expect(rejected).toHaveLength(2);
    expect(rejected[0][1]).toHaveProperty("catalog");
    expect(rejected[1]).toEqual(failure("rejected"));
  });

  it("still fails quietly when Community can't hear the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { readSpotifyListCatalog: async () => { throw new Error("Spotify did not return your playlists"); } };
    // A Community from before failure reports refuses the body as an invalid catalog.
    expect(await sendSpotifyListCatalog(session, broken, "2026-10-21T18:00:00Z", (async () => new Response("", { status: 400 })) as unknown as typeof fetch)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await sendSpotifyListCatalog(session, broken, "2026-10-21T18:00:00Z", (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBe("failed");
  });

  it("hears about a catalog request on a pull", () => {
    expect(pullSideDocuments({ sideDocuments: { localFilesRevision: 1, privateNotesCursor: 2, spotifyLibraryCatalogRequestedAt: "2026-10-21T18:00:00Z" } }))
      .toMatchObject({ spotifyLibraryCatalogRequestedAt: "2026-10-21T18:00:00Z" });
  });
});
