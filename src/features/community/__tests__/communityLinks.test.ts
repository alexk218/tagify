import { describe, expect, it } from "vitest";
import { getCommunityDisconnectUrl, getCommunityEntityUrl } from "../communityLinks";

describe("Community links", () => {
  it("links supported exact Spotify entities", () => {
    expect(getCommunityEntityUrl("spotify:track:4uLU6hMCjMI75M1A2tKUQC")).toBe("https://community.tagify.fm/entity/track/4uLU6hMCjMI75M1A2tKUQC");
  });

  it("does not expose playlists or local files", () => {
    expect(getCommunityEntityUrl("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M")).toBeNull();
    expect(getCommunityEntityUrl("spotify:local:Artist:Album:Song:200")).toBeNull();
  });

  it("targets the matching account when finishing a disconnect", () => {
    expect(getCommunityDisconnectUrl("account/id", "device/id")).toBe(
      "https://community.tagify.fm/auth/disconnect?account=account%2Fid&device=device%2Fid",
    );
  });
});
