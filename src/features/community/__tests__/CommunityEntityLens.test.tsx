import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityEntityLens } from "../CommunityEntityLens";

const entity = {
  entity: { provider: "spotify", kind: "track", providerId: "1eyzqe2QqGZUmfcPZtrIyt" },
  title: "Midnight City",
  subtitle: "Exact Spotify edition",
  spotifyUrl: "https://open.spotify.com/track/1eyzqe2QqGZUmfcPZtrIyt",
  thumbnailUrl: null,
  artists: [{ providerId: "63MQldklfxkjYDoUE4Tppz", name: "M83", spotifyUrl: "https://open.spotify.com/artist/63MQldklfxkjYDoUE4Tppz" }],
  rating: { average: 4.5, count: 2, distribution: [] },
  contributors: [{ handle: "mira", displayName: "Mira", ratingHalfStars: 9, tags: [{ label: "Nocturnal", path: "Mood / Night / Nocturnal" }], isFollowing: false }],
  tagInspiration: {
    contributorCount: 1,
    tags: [{
      label: "Nocturnal",
      contributorCount: 1,
      paths: [{ path: "Mood / Night / Nocturnal", contributorCount: 1 }],
      contributors: [{ handle: "mira", displayName: "Mira", isFollowing: false }],
    }],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("CommunityEntityLens", () => {
  it("shows only individual Community contributors and their tags", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        entity: {
          ...entity,
          contributors: [
            { ...entity.contributors[0], isOwn: true },
            {
              handle: "theo",
              displayName: "Theo",
              ratingHalfStars: null,
              tags: [{ label: "Peak-time", path: "Energy / Peak-time" }],
              isFollowing: false,
            },
          ],
        },
      }),
    );
    localStorage.setItem(
      "tagify:communityDeviceCredentialV1",
      JSON.stringify({ accessToken: "tgfy_access_test" }),
    );

    render(<CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />);

    expect(await screen.findByText("Community perspectives")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Your public tags")).toBeInTheDocument();
    expect(screen.getByText("Theo")).toBeInTheDocument();
    expect(screen.getByText("Nocturnal")).toBeInTheDocument();
    expect(screen.getByText("Peak-time")).toBeInTheDocument();
    expect(screen.queryByText("Community rating")).not.toBeInTheDocument();
    expect(screen.queryByText("Ways people tag this")).not.toBeInTheDocument();
    expect(screen.queryByText("Discussion")).not.toBeInTheDocument();
    expect(screen.queryByText("Open full Community page")).not.toBeInTheDocument();
  });

  it("does not render when no Community contributors exist", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ entity: { ...entity, contributors: [] } }),
    );

    render(<CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Community perspectives")).not.toBeInTheDocument();
  });

  it("uses the Cloud Sync session to identify the current contributor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        entity: {
          ...entity,
          contributors: [{ ...entity.contributors[0], isOwn: true }],
        },
      }),
    );
    localStorage.setItem(
      "tagify:sync:configuration",
      JSON.stringify({
        accountId: "account-a",
        libraryId: "library-a",
        deviceId: "device-a",
        apiBaseUrl: "https://community.tagify.fm",
        supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "key",
        accessToken: "supabase-access-token",
        refreshToken: "supabase-refresh-token",
        expiresAt: 9999999999,
        profile: { id: "profile-a", handle: "mira", displayName: "Mira" },
      }),
    );

    render(<CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />);

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://community.tagify.fm/api/v2/entities/track/1eyzqe2QqGZUmfcPZtrIyt",
      { headers: { authorization: "Bearer supabase-access-token" } },
    );
  });
});
