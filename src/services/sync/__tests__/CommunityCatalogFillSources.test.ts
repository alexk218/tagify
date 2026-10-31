import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTracks: vi.fn() }));
vi.mock("@/services/storage/StorageService", () => ({ storageService: { getTracks: mocks.getTracks } }));

import { runArtistCreditReports } from "../CommunityArtistCredits";
import { communityArtistCreditSources } from "../CommunityArtistCreditSources";
import { CATALOG_FILL_READ_INTERVAL_MS } from "../CommunityCatalogFill";
import { communityCatalogFillAllowance } from "../CommunityCatalogFillSources";
import { communityCatalogFillJobSources } from "../CommunityCatalogFillJobSources";
import { saveCatalogFillPace } from "../CommunityCatalogFill";
import { runSongReleaseReports } from "../CommunitySongReleases";
import { communitySongReleaseSources } from "../CommunitySongReleaseSources";

// A song pasted on Community by link: in nobody's Tagify library here.
const trackId = "4uLU6hMCjMI75M1A2tKUQC";
const otherTrackId = "7ouMYWpwJ422jRcDASZB7P";
const albumId = "6dVIqQ8qmQ5GBnJ9shOYGE";
const hex = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const otherHex = "b1b2c3d4e5f60718293a4b5c6d7e8f90";
const albumHex = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const originalFetch = globalThis.fetch;
const platform = Spicetify.Platform as any;
const originalAuthorization = platform.AuthorizationAPI;
const originalUri = (Spicetify as any).URI;
const session = async () => ({ apiBaseUrl: "https://community.test", accessToken: "token", deviceId: "11111111-1111-4111-8111-111111111111" });

function community(items: unknown[]) {
  return vi.fn(async (_url: string, init: RequestInit = {}) => new Response(JSON.stringify(init.method === "POST"
    ? { accepted: 1, ignored: 0 }
    : { items, hasMore: false }))) as unknown as typeof fetch;
}

const quick = <T extends { pace?: () => Promise<void>; outsideLibrary?: { pace: () => Promise<void> } }>(sources: T) => {
  sources.pace = async () => {};
  if (sources.outsideLibrary) sources.outsideLibrary.pace = async () => {};
  return sources;
};

beforeEach(() => {
  localStorage.clear?.();
  mocks.getTracks.mockReset().mockResolvedValue(new Map());
  platform.AuthorizationAPI = { getState: () => ({ token: { accessToken: "desktop-token" } }) };
  (Spicetify as any).URI = { ...originalUri,
    idToHex: (id: string) => id === trackId ? hex : id === otherTrackId ? otherHex : albumHex,
    hexToId: (value: string) => value === albumHex ? albumId : value === otherHex ? otherTrackId : trackId };
  (Spicetify.GraphQL.Definitions as any).getTrack = { name: "getTrack" };
  (Spicetify.GraphQL.Definitions as any).getAlbum = { name: "getAlbum" };
  vi.mocked(Spicetify.GraphQL.Request).mockReset().mockImplementation((async (definition: { name: string }) => definition.name === "getTrack"
    ? { data: { trackUnion: { __typename: "Track", uri: `spotify:track:${trackId}`, name: "Song",
      firstArtist: { items: [{ uri: "spotify:artist:0OdUWJ0sBjDrqHygGUXeCF", profile: { name: "Band" } }] }, otherArtists: { items: [] } } } }
    : { data: { albumUnion: { __typename: "Album", uri: `spotify:album:${albumId}`, name: "Record", type: "ALBUM",
      date: { isoString: "2001-03-12T00:00:00Z", precision: "DAY" }, coverArt: { sources: [] } } } }) as never);
  globalThis.fetch = vi.fn(async (url: string | URL) => String(url).includes(`/metadata/4/track/${hex}`)
    ? new Response(JSON.stringify({ gid: hex, external_id: [{ type: "isrc", id: "GBDUW0000059" }], album: { gid: albumHex } }), { status: 200 })
    : new Response("{}", { status: 404 })) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  platform.AuthorizationAPI = originalAuthorization;
  (Spicetify as any).URI = originalUri;
  vi.useRealTimers();
});

it("fills a song from elsewhere through Spotify's desktop reads only, never a Web API request", async () => {
  const item = { provider: "spotify", kind: "track", providerId: trackId };

  const artists = await runArtistCreditReports(session, quick(communityArtistCreditSources()), { request: community([item]), storage: null });
  const releases = await runSongReleaseReports(session, quick(communitySongReleaseSources()), { request: community([item]), storage: null });

  const spotifyUrls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
  expect(spotifyUrls.every((url) => !url.includes("api.spotify.com"))).toBe(true);
  expect(spotifyUrls).toEqual([`https://spclient.wg.spotify.com/metadata/4/track/${hex}`]);
  expect(vi.mocked(Spicetify.GraphQL.Request).mock.calls.map(([definition]) => (definition as { name: string }).name)).toEqual(["getTrack", "getAlbum"]);
  expect(artists).toEqual({ sent: 1, reads: 1 });
  expect(releases).toEqual({ sent: 1, reads: 2 });
  // The reads went to the filler's own hourly reservations, not the library runs'.
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? "");
  const policy = JSON.parse(localStorage.getItem(keys.find((key) => key.startsWith("tagify:background-work:v1:"))!)!);
  expect(Object.keys(policy.attempts)).toEqual(["community-catalog-fill"]);
  expect(policy.attempts["community-catalog-fill"]).toHaveLength(3);
  expect(JSON.parse(localStorage.getItem("tagify:community-catalog-fill:day:v1")!)).toMatchObject({ reads: 3 });
});

it("stops at Spotify's 429 and asks Spotify nothing on the next run while the shared pause holds", async () => {
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "120" } })) as typeof fetch;
  const items = [
    { provider: "spotify", kind: "track", providerId: trackId },
    { provider: "spotify", kind: "track", providerId: otherTrackId },
  ];
  const fill = () => runSongReleaseReports(session, quick(communitySongReleaseSources()), { request: community(items), storage: null });

  expect((await fill()).stopped).toBe("spotify");
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect((await fill()).stopped).toBe("budget");
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

it("waits a few seconds before each read for a song from elsewhere", async () => {
  vi.useFakeTimers();
  let waited = false;
  void communityCatalogFillAllowance().pace().then(() => { waited = true; });
  await vi.advanceTimersByTimeAsync(CATALOG_FILL_READ_INTERVAL_MS - 1);
  expect(waited).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(waited).toBe(true);
  expect(CATALOG_FILL_READ_INTERVAL_MS).toBeGreaterThanOrEqual(3_000);
});

it("treats songs Tagify saved as this library's, and only those", async () => {
  mocks.getTracks.mockResolvedValue(new Map([[`spotify:track:${trackId}`, { uri: `spotify:track:${trackId}` }]]));
  const library = await communityCatalogFillAllowance().libraryTracks([`spotify:track:${trackId}`, `spotify:track:${otherTrackId}`]);
  expect([...library]).toEqual([`spotify:track:${trackId}`]);
});

it("reads an artist's releases through GraphQL queryArtistDiscographyAll, page by page, never a partial list", async () => {
  const artistUri = "spotify:artist:0OdUWJ0sBjDrqHygGUXeCF";
  (Spicetify.GraphQL.Definitions as any).queryArtistDiscographyAll = { name: "queryArtistDiscographyAll" };
  const page = (offset: number, count: number, totalCount: number) => ({ data: { artistUnion: { uri: artistUri, discography: { all: { totalCount,
    items: Array.from({ length: count }, (_, index) => ({ releases: { items: [{ uri: `spotify:album:${String(offset + index).padStart(22, "a")}`, name: `R${offset + index}`, type: "SINGLE", date: { year: 2020 } }] } })) } } } } });
  vi.mocked(Spicetify.GraphQL.Request).mockReset().mockImplementation((async (_definition: unknown, variables: { offset: number }) =>
    page(variables.offset, variables.offset === 0 ? 100 : 20, 120)) as never);
  const beforePage = vi.fn(async () => true);
  const releases = await communityCatalogFillJobSources().artistReleases(artistUri, beforePage);
  expect(releases).toHaveLength(120);
  expect(releases![0]).toEqual({ uri: `spotify:album:${"0".padStart(22, "a")}`, name: "R0", type: "SINGLE", date: { year: 2020 } });
  expect(beforePage).toHaveBeenCalledTimes(2);
  expect(vi.mocked(Spicetify.GraphQL.Request).mock.calls.map((call) => call[1])).toEqual([
    { uri: artistUri, offset: 0, limit: 100, order: "DATE_DESC" }, { uri: artistUri, offset: 100, limit: 100, order: "DATE_DESC" },
  ]);

  // The allowance ran out after the first page: nothing, so Community isn't sent half a discography.
  let pages = 0;
  expect(await communityCatalogFillJobSources().artistReleases(artistUri, async () => pages++ === 0)).toBeNull();
  // An answer about another artist is never used.
  vi.mocked(Spicetify.GraphQL.Request).mockImplementation((async () => ({ data: { artistUnion: { uri: "spotify:artist:1111111111111111111111", discography: { all: { items: [] } } } } })) as never);
  expect(await communityCatalogFillJobSources().artistReleases(artistUri, async () => true)).toBeNull();
});

it("follows the pace Community advertised", async () => {
  vi.useFakeTimers();
  saveCatalogFillPace({ preset: "fast", readIntervalMs: 1_000, hourlyReads: 3_600, dailyReads: 86_400 });
  let waited = false;
  void communityCatalogFillAllowance().pace().then(() => { waited = true; });
  await vi.advanceTimersByTimeAsync(999);
  expect(waited).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(waited).toBe(true);
});
