// @vitest-environment node
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

  it("returns no playlist details without a Web API request when Spotify's desktop details have no usable name", async () => {
    vi.mocked(Spicetify.Platform.PlaylistAPI.getMetadata as any).mockResolvedValue({
      name: "Unknown Playlist",
    });

    await expect(
      spotifyApiService.getPlaylistMetadata("spotify:playlist:playlist-1"),
    ).resolves.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses desktop artist metadata without Web API requests", async () => {
    (Spicetify.GraphQL.Definitions as any).queryArtistOverview = { name: "queryArtistOverview" };
    vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue({ data: { artistUnion: {
      uri: "spotify:artist:artist-1", name: "Recovered Artist",
      images: [{ url: "https://example.com/artist.jpg" }], followers: { total: 1234 }, genres: ["house"],
    } } } as never);
    await expect(spotifyApiService.getArtistMetadata("spotify:artist:artist-1")).resolves.toMatchObject({ name: "Recovered Artist" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(1);
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

    it("opens an album to tag without the throttled Web API pausing Tagify", async () => {
      (Spicetify.Platform as any).AuthorizationAPI = { getState: () => ({ token: { accessToken: "test-token" } }) };
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "40" } }));
      vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue(
        albumUnion({ tracksV2: { totalCount: 1, items: [{ track: { uri: "spotify:track:one", name: "One", trackNumber: 1 } }] } }) as any);

      // The album view asks for details and tracks together, and tagging hydrates details again.
      const [metadata, tracks, uris] = await Promise.all([
        spotifyApiService.getPlaylistMetadata("spotify:album:album-2"),
        spotifyApiService.getAlbumTracks("spotify:album:album-2", { feature: "album-tracks" }),
        spotifyApiService.getAllTrackUrisInAlbum("album-2"),
      ]);
      await expect(spotifyApiService.getPlaylistMetadata("spotify:album:album-2", { priority: "background", feature: "metadata-backfill" }))
        .resolves.toMatchObject({ name: "Quiet Machines" });

      expect(metadata).toMatchObject({ name: "Quiet Machines", ownerName: "Low Orbit", trackCount: 1, description: "Released 1992-02-12T00:00:00Z" });
      expect(tracks?.map(track => track.uri)).toEqual(["spotify:track:one"]);
      expect(uris).toEqual(["spotify:track:one"]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(localStorage.getItem("tagify:spotify-cooldown:v1:current")).toBeNull();
    });

    it("returns no album details without a Web API request when Spotify's client can't describe the album", async () => {
      delete (Spicetify.GraphQL.Definitions as any).getAlbum;
      await expect(spotifyApiService.getPlaylistMetadata("spotify:album:album-2")).resolves.toBeNull();
      await expect(spotifyApiService.getAllTrackUrisInAlbum("album-2")).resolves.toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("does not switch to the Web API while Spotify's client album lookup is paused", async () => {
      vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue({ errors: [{ message: "Too Many Requests", extensions: { status: 429 } }] } as any);
      await expect(spotifyApiService.getPlaylistMetadata("spotify:album:album-2"))
        .rejects.toMatchObject({ spotifyFailure: { kind: "server-429", status: 429, dispatched: true } });
      await expect(spotifyApiService.getAllTrackUrisInAlbum("album-2"))
        .rejects.toMatchObject({ spotifyFailure: { kind: "local-pause", dispatched: false } });
      expect(globalThis.fetch).not.toHaveBeenCalled();
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
        artistsData: [],
        discNumber: 1,
        trackNumber: 1,
      });
      expect(tracks?.[54]).toMatchObject({ uri: "spotify:track:t55", discNumber: 2 });
      expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns no album tracks without a Web API request when Spotify's client can't list them", async () => {
      delete (Spicetify.GraphQL.Definitions as any).getAlbum;
      await expect(spotifyApiService.getAlbumTracks("spotify:album:album-5")).resolves.toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("describes a release for Community with one getAlbum request and no Web API request", async () => {
      vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue(albumUnion({ type: "SINGLE", date: { isoString: "1992-02-12T00:00:00Z", precision: "DAY" } }) as any);
      await expect(spotifyApiService.getAlbumRelease("spotify:album:album-2", { priority: "background", feature: "metadata-backfill" })).resolves.toEqual({
        name: "Quiet Machines", type: "SINGLE", date: { isoString: "1992-02-12T00:00:00Z", precision: "DAY" },
        coverSources: [{ url: "https://example.com/cover.jpg" }],
      });
      expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(1);
      expect(vi.mocked(Spicetify.GraphQL.Request).mock.calls[0][0]).toEqual({ name: "getAlbum" });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("never describes one release with another's details", async () => {
      vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue(albumUnion({ uri: "spotify:album:album-9", type: "ALBUM" }) as any);
      await expect(spotifyApiService.getAlbumRelease("spotify:album:album-2")).resolves.toBeNull();
      delete (Spicetify.GraphQL.Definitions as any).getAlbum;
      await expect(spotifyApiService.getAlbumRelease("spotify:album:album-2")).resolves.toBeNull();
      expect(Spicetify.GraphQL.Request).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("keeps stable artist identities from album pages", async () => {
      vi.mocked(Spicetify.GraphQL.Request).mockResolvedValue(albumUnion({ tracksV2: {
        totalCount: 1, items: [{ track: { uri: "spotify:track:one", artists: { items: [
          { uri: "spotify:artist:one", profile: { name: "Same Name" } },
          { uri: "spotify:artist:two", profile: { name: "Same Name" } },
        ] } } }],
      } }) as any);
      const tracks = await spotifyApiService.getAlbumTracks("spotify:album:album-2");
      expect(tracks?.[0].artistsData).toEqual([
        { uri: "spotify:artist:one", name: "Same Name" },
        { uri: "spotify:artist:two", name: "Same Name" },
      ]);
    });

    it("never confirms a partial album when a later page fails", async () => {
      vi.mocked(Spicetify.GraphQL.Request)
        .mockResolvedValueOnce(albumUnion({ tracksV2: { totalCount: 51, items: Array.from({ length: 50 }, (_, i) => ({ track: { uri: `spotify:track:${i}` } })) } }) as any)
        .mockRejectedValueOnce(new Error("offline"));
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ uri: "spotify:track:one" }], next: "next-page" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 503 }));
      (Spicetify.Platform as any).AuthorizationAPI = { getState: () => ({ token: { accessToken: "test-token" } }) };
      await expect(spotifyApiService.getAlbumTracks("spotify:album:album-2")).resolves.toBeNull();
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
      { playlistId: "top", playlistName: "4★", folders: [] },
      { playlistId: "nested", playlistName: "4.5★", folders: [] },
    ]);
  });

  it("names the folders each playlist sits in, without the account name in their addresses", async () => {
    (Spicetify.Platform as any).RootlistAPI = {
      getContents: vi.fn().mockResolvedValue({
        items: [
          { type: "playlist", uri: "spotify:playlist:top", name: "Top" },
          {
            type: "folder", name: "Workout", hash: "a1b2c3d4e5f60718", uri: "spotify:user:alex.k:folder:a1b2c3d4e5f60718:Workout",
            items: [
              // An older Spotify without `hash`: the ID comes from the address.
              { type: "folder", name: "Running", uri: "spotify:user:alex.k:folder:0f1e2d3c4b5a6978:Running", items: [
                { type: "playlist", uri: "spotify:playlist:tempo", name: "Tempo" },
              ] },
              { type: "playlist", uri: "spotify:playlist:stretch", name: "Stretch" },
            ],
          },
          // A folder Tagify can't identify adds no level.
          { type: "folder", name: "Odd", uri: "spotify:folder", items: [{ type: "playlist", uri: "spotify:playlist:odd", name: "Odd one" }] },
          // A playlist listed twice keeps its first place.
          { type: "folder", name: "Again", hash: "ffffffffffffffff", items: [{ type: "playlist", uri: "spotify:playlist:top", name: "Top" }] },
        ],
      }),
    };

    const references = await spotifyApiService.getAllUserPlaylistReferencesStrict();
    expect(references).toEqual([
      { playlistId: "top", playlistName: "Top", folders: [] },
      { playlistId: "tempo", playlistName: "Tempo", folders: [{ id: "a1b2c3d4e5f60718", name: "Workout" }, { id: "0f1e2d3c4b5a6978", name: "Running" }] },
      { playlistId: "stretch", playlistName: "Stretch", folders: [{ id: "a1b2c3d4e5f60718", name: "Workout" }] },
      { playlistId: "odd", playlistName: "Odd one", folders: [] },
    ]);
    expect(JSON.stringify(references)).not.toContain("alex.k");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reads every desktop playlist page without a Web API fallback", async () => {
    (Spicetify.Platform.PlaylistAPI as any).getContents = vi.fn()
      .mockResolvedValueOnce({ items: [{ uri: "spotify:track:first" }], totalLength: 2 })
      .mockResolvedValueOnce({ items: [{ uri: "spotify:track:second" }], totalLength: 2, offset: 1 });
    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("playlist-1"))
      .resolves.toEqual(["spotify:track:first", "spotify:track:second"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("never mistakes a failed desktop read for an empty playlist", async () => {
    (Spicetify.Platform.PlaylistAPI as any).getContents = vi.fn().mockRejectedValue(new Error("desktop unavailable"));
    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("playlist-1")).rejects.toThrow("desktop unavailable");
    expect(globalThis.fetch).not.toHaveBeenCalled();
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

  it("does not add a track when desktop membership is unavailable", async () => {
    vi.spyOn(playlistApi, "getContents").mockRejectedValue(new Error("Invalid playlist response!"));
    const add = vi.spyOn(playlistApi, "add");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    await expect(spotifyApiService.addTrackToSpotifyPlaylist("spotify:track:playing", "five-star")).resolves.toEqual({ success: false, wasAdded: false });
    expect(add).not.toHaveBeenCalled();
    await spotifyApiService.addTrackToSpotifyPlaylist("spotify:track:playing", "five-star");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("resumes playlist reads after Spotify's requested cooldown", async () => {
    vi.useFakeTimers();
    vi.spyOn(playlistApi, "getContents").mockRejectedValueOnce({ status: 429, retryAfterSeconds: 120 }).mockResolvedValue({ items: [{ uri: "spotify:track:playing" }], totalLength: 1 });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "120" } }))
      .mockResolvedValue(new Response(JSON.stringify({ items: [{ track: { uri: "spotify:track:playing" } }], next: null }), { status: 200 }));
    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("five-star")).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(119_000);
    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("other-playlist")).rejects.toMatchObject({ status: 429 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(spotifyApiService.getAllTrackUrisInPlaylistStrict("five-star")).resolves.toEqual(["spotify:track:playing"]);
  });

  it("uses complete desktop membership to avoid adding an existing track", async () => {
    vi.spyOn(playlistApi, "getContents").mockResolvedValue({ items: [{ uri: "spotify:track:playing" }], totalLength: 1 });
    const add = vi.spyOn(playlistApi, "add");
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ track: { uri: "spotify:track:playing" } }], next: null }), { status: 200 }));
    await expect(spotifyApiService.addTrackToSpotifyPlaylist("spotify:track:playing", "five-star")).resolves.toEqual({ success: true, wasAdded: false });
    expect(add).not.toHaveBeenCalled();
  });
});
