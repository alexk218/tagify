import { beforeEach, describe, expect, it, vi } from "vitest";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";

describe("Spotify metadata request protection", () => {
  beforeEach(() => {
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
    expect(result["spotify:track:graph-2"]).toMatchObject({
      albumUri: "spotify:album:album",
      albumImageUrl: "https://example.com/album.jpg",
      artists: "Artist",
    });
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
