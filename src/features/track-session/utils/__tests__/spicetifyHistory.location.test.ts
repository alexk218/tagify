import { describe, expect, it } from "vitest";
import { parseHistoryTrackSelection } from "@/features/track-session/utils/spicetifyHistory.location";
import { SpicetifyHistoryLocation } from "@/types/SpotifyTypes";

describe("spicetifyHistory.location", () => {
  it("extracts single track uri from search params", () => {
    const parsed = parseHistoryTrackSelection({
      pathname: "/tagify",
      search: "?uri=spotify%3Atrack%3A123",
      state: {},
    });

    expect(parsed.trackUri).toBe("spotify:track:123");
    expect(parsed.trackUris).toBeNull();
    expect(parsed.playlistUri).toBeNull();
    expect(parsed.artistUri).toBeNull();
  });

  it("falls back to state.trackUri when search is empty", () => {
    const parsed = parseHistoryTrackSelection({
      pathname: "/tagify",
      search: "",
      state: { trackUri: "spotify:track:state" },
    });

    expect(parsed.trackUri).toBe("spotify:track:state");
  });

  it("extracts multi-track uris from state", () => {
    const parsed = parseHistoryTrackSelection({
      pathname: "/tagify",
      search: "",
      state: {
        trackUris: ["spotify:track:1", "spotify:track:2"],
      },
    });

    expect(parsed.trackUris).toEqual(["spotify:track:1", "spotify:track:2"]);
    expect(parsed.playlistUri).toBeNull();
    expect(parsed.artistUri).toBeNull();
  });

  it("filters invalid entries from state.trackUris", () => {
    const locationWithInvalidUris = {
      pathname: "/tagify",
      search: "",
      state: {
        trackUris: ["spotify:track:1", "", 1, null],
      },
    } as unknown as SpicetifyHistoryLocation;

    const parsed = parseHistoryTrackSelection(locationWithInvalidUris);

    expect(parsed.trackUris).toEqual(["spotify:track:1"]);
  });

  it("returns nulls when location is missing", () => {
    expect(parseHistoryTrackSelection(undefined)).toEqual({
      trackUri: null,
      trackUris: null,
      playlistUri: null,
      artistUri: null,
    });
  });

  it("extracts playlist uri from search params", () => {
    const parsed = parseHistoryTrackSelection({
      pathname: "/tagify",
      search: "?playlistUri=spotify%3Aplaylist%3Aabc",
      state: {},
    });

    expect(parsed.playlistUri).toBe("spotify:playlist:abc");
    expect(parsed.trackUri).toBeNull();
    expect(parsed.trackUris).toBeNull();
    expect(parsed.artistUri).toBeNull();
  });

  it("extracts artist uri from search params", () => {
    const parsed = parseHistoryTrackSelection({
      pathname: "/tagify",
      search: "?artistUri=spotify%3Aartist%3Aabc",
      state: {},
    });

    expect(parsed.artistUri).toBe("spotify:artist:abc");
    expect(parsed.playlistUri).toBeNull();
    expect(parsed.trackUri).toBeNull();
    expect(parsed.trackUris).toBeNull();
  });
});
