import { describe, expect, it } from "vitest";
import {
  createFailedSpotifyTrack,
  createLoadingSpotifyTrack,
  createLocalSpotifyTrack,
  createSpotifyTrackFromPlayerItem,
  createSpotifyTrackFromTrackInfo,
} from "@/features/track-session/utils/trackSession.mappers";

describe("trackSession.mappers", () => {
  it("creates local spotify tracks from spotify:local URIs", () => {
    const track = createLocalSpotifyTrack(
      "spotify:local:Artist+Name:Album+Name:Track+Name:123",
    );

    expect(track.uri).toBe("spotify:local:Artist+Name:Album+Name:Track+Name:123");
    expect(track.name).toBe("Track Name");
    expect(track.artists[0].name).toBe("Artist Name");
    expect(track.album.name).toBe("Album Name");
    expect(track.duration_ms).toBe(0);
  });

  it("maps service TrackInfo to app SpotifyTrack", () => {
    const track = createSpotifyTrackFromTrackInfo("spotify:track:abc", {
      name: "Track",
      artists: "Artist One",
      albumName: "Album",
      albumUri: "spotify:album:xyz",
      artistsData: [{ name: "Artist One", uri: "spotify:artist:1" }],
      duration_ms: 211000,
      release_date: "2020-01-01",
    });

    expect(track).toEqual({
      uri: "spotify:track:abc",
      name: "Track",
      artists: [{ name: "Artist One" }],
      album: { name: "Album" },
      duration_ms: 211000,
    });
  });

  it("maps player item with sane defaults", () => {
    const mapped = createSpotifyTrackFromPlayerItem({
      uri: "spotify:track:def",
      artists: [],
      album: {},
    });

    expect(mapped).toEqual({
      uri: "spotify:track:def",
      name: "Unknown Track",
      artists: [{ name: "Unknown Artist" }],
      album: { name: "Unknown Album" },
      duration_ms: 0,
    });
  });

  it("returns null when player item is missing uri", () => {
    expect(createSpotifyTrackFromPlayerItem(undefined)).toBeNull();
    expect(createSpotifyTrackFromPlayerItem({})).toBeNull();
  });

  it("creates loading and failed placeholder tracks", () => {
    expect(createLoadingSpotifyTrack("spotify:track:1").name).toBe("Loading...");
    expect(createFailedSpotifyTrack("spotify:track:1").name).toBe("Failed to load");
  });
});
