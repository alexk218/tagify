import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spotifyApiService } from "@/services/SpotifyApiService";

describe("SpotifyApiService entity metadata", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.mocked(Spicetify.Platform.PlaylistAPI.getMetadata as any).mockReset();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("falls back to Spotify Web API when playlist metadata has no usable name", async () => {
    vi.mocked(Spicetify.Platform.PlaylistAPI.getMetadata as any).mockResolvedValue({
      name: "Unknown Playlist",
    });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "Recovered Playlist",
          owner: { display_name: "Alex" },
          images: [{ url: "https://example.com/playlist.jpg" }],
          tracks: { total: 42 },
          snapshot_id: "snapshot-1",
        }),
        { status: 200 },
      ),
    );

    await expect(
      spotifyApiService.getPlaylistMetadata("spotify:playlist:playlist-1"),
    ).resolves.toMatchObject({
      name: "Recovered Playlist",
      ownerName: "Alex",
      trackCount: 42,
    });
  });

  it("uses Spotify Web API for artist metadata before GraphQL", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "Recovered Artist",
          images: [{ url: "https://example.com/artist.jpg" }],
          followers: { total: 1234 },
          genres: ["house"],
        }),
        { status: 200 },
      ),
    );

    await expect(
      spotifyApiService.getArtistMetadata("spotify:artist:artist-1"),
    ).resolves.toEqual({
      uri: "spotify:artist:artist-1",
      name: "Recovered Artist",
      imageUrl: "https://example.com/artist.jpg",
      followerCount: 1234,
      genres: ["house"],
    });
    expect(Spicetify.GraphQL.Request).not.toHaveBeenCalled();
  });

  describe("album lengths", () => {
    const albumUnion = (overrides: Record<string, unknown> = {}) => ({
      data: {
        albumUnion: {
          __typename: "Album",
          uri: "spotify:album:album-2",
          name: "Quiet Machines",
          artists: { items: [{ profile: { name: "Low Orbit" } }] },
          coverArt: { sources: [{ url: "https://example.com/cover.jpg" }] },
          date: { isoString: "1992-02-12T00:00:00Z" },
          tracksV2: { totalCount: 12, items: [{ track: { uri: "spotify:track:one" } }] },
          ...overrides,
        },
      },
    });

    beforeEach(() => {
      (Spicetify.GraphQL.Definitions as any).getAlbum = { name: "getAlbum" };
      vi.mocked(Spicetify.GraphQL.Request).mockReset();
    });

    afterEach(() => {
      delete (Spicetify.GraphQL.Definitions as any).getAlbum;
    });

    it("reads the album length from Spotify's client API when the Web API is throttled", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 429 }));
      vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue(albumUnion() as any);

      await expect(
        spotifyApiService.getPlaylistMetadata("spotify:album:album-2"),
      ).resolves.toMatchObject({
        name: "Quiet Machines",
        ownerName: "Low Orbit",
        trackCount: 12,
        description: "Released 1992-02-12T00:00:00Z",
      });
    });

    it("asks only Spotify's client API for a length, one track per page", async () => {
      vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue(albumUnion() as any);

      await expect(
        spotifyApiService.getAlbumTrackTotal("spotify:album:album-2"),
      ).resolves.toBe(12);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(vi.mocked(Spicetify.GraphQL.Request).mock.calls[0][1]).toMatchObject({
        uri: "spotify:album:album-2",
        limit: 1,
      });
    });

    it("lists an album's tracks across pages from Spotify's client API", async () => {
      const trackItem = (number: number) => ({
        track: {
          uri: `spotify:track:t${number}`,
          name: `Track ${number}`,
          trackNumber: number,
          discNumber: number > 50 ? 2 : 1,
          artists: { items: [{ profile: { name: "Low Orbit" } }, { profile: { name: "Guest" } }] },
        },
      });
      vi.mocked(Spicetify.GraphQL.Request).mockImplementation(async (_definition, variables: any) =>
        albumUnion({
          tracksV2: {
            totalCount: 55,
            items: Array.from(
              { length: variables.offset === 0 ? 50 : 5 },
              (_, index) => trackItem(variables.offset + index + 1),
            ),
          },
        }) as any,
      );

      const tracks = await spotifyApiService.getAlbumTracks("spotify:album:album-4");

      expect(tracks).toHaveLength(55);
      expect(tracks?.[0]).toEqual({
        uri: "spotify:track:t1",
        name: "Track 1",
        artists: "Low Orbit, Guest",
        discNumber: 1,
        trackNumber: 1,
      });
      expect(tracks?.[54]).toMatchObject({ uri: "spotify:track:t55", discNumber: 2 });
      expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("falls back to the Web API for an album's tracks", async () => {
      delete (Spicetify.GraphQL.Definitions as any).getAlbum;
      (Spicetify.Platform as any).AuthorizationAPI = {
        getState: () => ({ token: { accessToken: "test-token" } }),
      };
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                uri: "spotify:track:web",
                name: "Web Track",
                artists: [{ name: "Low Orbit" }],
                disc_number: 1,
                track_number: 1,
              },
            ],
            next: null,
          }),
          { status: 200 },
        ),
      );

      await expect(spotifyApiService.getAlbumTracks("spotify:album:album-5")).resolves.toEqual([
        {
          uri: "spotify:track:web",
          name: "Web Track",
          artists: "Low Orbit",
          discNumber: 1,
          trackNumber: 1,
        },
      ]);
    });

    it("adds up disc lengths and never mistakes a full page of tracks for the length", async () => {
      vi.mocked(Spicetify.GraphQL.Request)
        .mockResolvedValueOnce(
          albumUnion({
            tracksV2: { items: [{ track: { uri: "spotify:track:one" } }] },
            discs: {
              items: [{ tracks: { totalCount: 8 } }, { tracks: { totalCount: 7 } }],
            },
          }) as any,
        )
        .mockResolvedValueOnce(
          albumUnion({ tracksV2: { items: [{ track: { uri: "spotify:track:one" } }] } }) as any,
        );

      await expect(
        spotifyApiService.getAlbumTrackTotal("spotify:album:album-2"),
      ).resolves.toBe(15);
      await expect(
        spotifyApiService.getAlbumTrackTotal("spotify:album:album-3"),
      ).resolves.toBeNull();
    });
  });

  it("returns null instead of persisting an unknown album placeholder", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      spotifyApiService.getPlaylistMetadata("spotify:album:album-1"),
    ).resolves.toBeNull();
  });

  it("lists current playlist IDs and names through nested rootlist folders", async () => {
    (Spicetify.Platform as any).RootlistAPI = {
      getContents: vi.fn().mockResolvedValue({
        items: [
          { type: "playlist", uri: "spotify:playlist:top" },
          {
            type: "folder",
            items: [
              { type: "playlist", uri: "spotify:playlist:nested" },
            ],
          },
        ],
      }),
    };
    vi.mocked(Spicetify.Platform.PlaylistAPI.getMetadata as any).mockImplementation(
      async (uri: string) => ({
        name: uri.endsWith(":top") ? "4★" : "4.5★",
      }),
    );

    await expect(
      spotifyApiService.getAllUserPlaylistReferencesStrict(),
    ).resolves.toEqual([
      { playlistId: "top", playlistName: "4★" },
      { playlistId: "nested", playlistName: "4.5★" },
    ]);
  });

  it("reads every playlist page when the Spotify desktop read fails", async () => {
    (Spicetify.Platform.PlaylistAPI as any).getContents = vi.fn().mockRejectedValue(new Error("desktop unavailable"));
    (Spicetify.Platform as any).AuthorizationAPI = {
      getState: () => ({ token: { accessToken: "test-token" } }),
    };
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ track: { uri: "spotify:track:first" } }],
        next: "https://api.spotify.com/v1/playlists/playlist-1/items?offset=1",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ track: { uri: "spotify:track:second" } }],
        next: null,
      }), { status: 200 }));

    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("playlist-1"))
      .resolves.toEqual(["spotify:track:first", "spotify:track:second"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("never mistakes a failed Spotify fallback for an empty playlist", async () => {
    (Spicetify.Platform.PlaylistAPI as any).getContents = vi.fn().mockRejectedValue(new Error("desktop unavailable"));
    (Spicetify.Platform as any).AuthorizationAPI = {
      getState: () => ({ token: { accessToken: "test-token" } }),
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 403 }));

    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("playlist-1"))
      .rejects.toThrow("403");
  });
});

describe("safe playlist writes", () => {
  const originalFetch = globalThis.fetch;
  const playlistApi = Spicetify.Platform.PlaylistAPI as unknown as {
    getContents: (uri: string) => Promise<unknown>;
    add: (uri: string, items: string[], options: { after: string }) => Promise<unknown>;
  };
  afterEach(() => {
    globalThis.fetch = originalFetch;
    (spotifyApiService as unknown as { playlistReadsBlockedUntil: number }).playlistReadsBlockedUntil = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not add a track when both membership reads fail", async () => {
    vi.spyOn(playlistApi, "getContents").mockRejectedValue(new Error("Invalid playlist response!"));
    const add = vi.spyOn(playlistApi, "add");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    await expect(spotifyApiService.addTrackToSpotifyPlaylist("spotify:track:playing", "five-star")).resolves.toEqual({ success: false, wasAdded: false });
    expect(add).not.toHaveBeenCalled();
    await spotifyApiService.addTrackToSpotifyPlaylist("spotify:track:playing", "five-star");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("resumes playlist reads after Spotify's requested cooldown", async () => {
    vi.useFakeTimers();
    vi.spyOn(playlistApi, "getContents").mockRejectedValue(new Error("Unavailable"));
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "120" } }))
      .mockResolvedValue(new Response(JSON.stringify({ items: [{ track: { uri: "spotify:track:playing" } }], next: null }), { status: 200 }));
    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("five-star")).rejects.toThrow("429");
    await vi.advanceTimersByTimeAsync(119_000);
    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("other-playlist")).rejects.toThrow("rate limit");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("five-star")).resolves.toEqual(["spotify:track:playing"]);
  });

  it("uses the complete fallback to avoid adding an existing track", async () => {
    vi.spyOn(playlistApi, "getContents").mockRejectedValue(new Error("Invalid playlist response!"));
    const add = vi.spyOn(playlistApi, "add");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ track: { uri: "spotify:track:playing" } }], next: null }), { status: 200 }));
    await expect(spotifyApiService.addTrackToSpotifyPlaylist("spotify:track:playing", "five-star")).resolves.toEqual({ success: true, wasAdded: false });
    expect(add).not.toHaveBeenCalled();
  });
});
