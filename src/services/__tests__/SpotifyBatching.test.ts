import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { trackArtistIdentitiesStore } from "@/services/trackArtistIdentities";
import { graphqlRateLimiter } from "@/utils/RateLimiter";
import { spotifyService } from "@/services/SpotifyService";

describe("Spotify metadata request protection", () => {
  afterEach(() => { vi.useRealTimers(); });
  beforeEach(() => {
    graphqlRateLimiter.reset();
    spotifyService.clearCache();
    vi.restoreAllMocks();
    vi.mocked(Spicetify.GraphQL.Request).mockReset();
  });

  it("loads track metadata through paced GraphQL calls without the Web API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    Spicetify.GraphQL.Definitions.getTrack = { name: "getTrack" };
    vi.mocked(Spicetify.GraphQL.Request).mockImplementation(
      async (_definition, variables = {}) => ({
        data: {
          trackUnion: {
            uri: variables.uri,
            name: `Track ${variables.uri.split(":").pop()}`,
            duration: { totalMilliseconds: 180000 },
            albumOfTrack: {
              name: "Album",
              uri: "spotify:album:album",
              date: { isoString: "2026-01-01" },
              coverArt: {
                sources: [
                  { url: "https://example.com/album.jpg", width: 300, height: 300 },
                ],
              },
            },
            artists: {
              items: [
                { uri: "spotify:artist:artist", profile: { name: "Artist" } },
              ],
            },
          },
        },
      }),
    );

    const uris = ["spotify:track:graph-1", "spotify:track:graph-2"];
    const result = await spotifyService.getBatchTracks(uris);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(2);
    expect(trackArtistIdentitiesStore.getSnapshot()["spotify:track:graph-2"].artists).toEqual([{ uri: "spotify:artist:artist", name: "Artist" }]);
    await spotifyService.getTrackArtists("spotify:track:graph-2");
    expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(2);
    expect(result["spotify:track:graph-2"]).toMatchObject({
      albumUri: "spotify:album:album",
      albumImageUrl: "https://example.com/album.jpg",
      artists: "Artist",
    });
  });

  it("shares an in-flight track response across metadata and artist callers", async () => {
    Spicetify.GraphQL.Definitions.getTrack = { name: "getTrack" };
    let finish!: (value: unknown) => void;
    vi.mocked(Spicetify.GraphQL.Request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const uri = "spotify:track:shared-metadata";
    const track = spotifyService.getTrack(uri);
    const artistRead = spotifyService.getTrackArtists(uri);
    expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(1);
    finish({ data: { trackUnion: { uri, name: "Track", duration: { totalMilliseconds: 1000 }, artists: { items: [{ uri: "spotify:artist:shared", profile: { name: "Shared" } }] } } } });
    await Promise.all([track, artistRead]);
    expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(1);
    expect(trackArtistIdentitiesStore.getSnapshot()[uri].artists).toEqual([{ uri: "spotify:artist:shared", name: "Shared" }]);
  });

  it("does not launch a duplicate when an uncancellable lookup times out", async () => {
    vi.useFakeTimers();
    Spicetify.GraphQL.Definitions.getTrack = { name: "getTrack" };
    let finish!: (value: unknown) => void;
    vi.mocked(Spicetify.GraphQL.Request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const failed = expect(spotifyService.getTrackArtists("spotify:track:timeout-retry")).rejects.toThrow("taking too long");
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    await expect(spotifyService.getTrackArtists("spotify:track:timeout-retry")).rejects.toThrow("taking too long");
    expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(1);
    finish({}); await vi.advanceTimersByTimeAsync(0);
  });

  it("retains the current GraphQL fallback when the Web API is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    Spicetify.GraphQL.Definitions.getAlbum = { name: "getAlbum" };
    vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue({
      data: {
        albumUnion: {
          uri: "spotify:album:graphql-album",
          name: "GraphQL Album",
          artists: { items: [{ profile: { name: "Artist" } }] },
          coverArt: {
            sources: [
              { url: "https://example.com/graphql-album.jpg", width: 300, height: 300 },
            ],
          },
          tracks: { totalCount: 12 },
          date: { isoString: "2026-01-01" },
        },
      },
    });

    const metadata = await spotifyApiService.getPlaylistMetadata(
      "spotify:album:graphql-album",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(1);
    expect(metadata).toMatchObject({
      name: "GraphQL Album",
      imageUrl: "https://example.com/graphql-album.jpg",
      trackCount: 12,
    });
  });
});

it("reuses a completed response across track detail callers", async () => {
  spotifyService.clearCache();
  Spicetify.GraphQL.Definitions.getTrack = { name: "getTrack" };
  const request = vi.mocked(Spicetify.GraphQL.Request).mockReset().mockResolvedValue({ data: { trackUnion: {
    uri: "spotify:track:cached", name: "Cached", duration: { totalMilliseconds: 1000 }, artists: { items: [] },
  } } });
  await spotifyService.getTrack("spotify:track:cached");
  await spotifyService.getTrackMetadata("spotify:track:cached");
  await spotifyService.getAlbumCover("spotify:track:cached");
  expect(request).toHaveBeenCalledTimes(1);
});
