import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityEntityLens } from "../CommunityEntityLens";
import { clearCommunityEntityCache, COMMUNITY_ENTITY_REVALIDATE_MS, lookupCommunityEntity } from "../communityEntityCache";

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
  clearCommunityEntityCache();
});

async function open(index = 0) {
  const details = screen.getAllByText("Community perspectives")[index].closest("details")!;
  // Opening a <details> element fires one "toggle" event, as in Spotify.
  await act(async () => {
    details.open = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const songs = Array.from({ length: 20 }, (_, index) => `spotify:track:${`${index}`.padStart(22, "a")}`);

describe("CommunityEntityLens", () => {
  it("costs no request per song while it stays closed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    // About an hour of listening. Before, every song shown looked itself up.
    const { rerender } = render(<CommunityEntityLens entityUri={songs[0]} />);
    for (const song of songs) rerender(<CommunityEntityLens entityUri={song} />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Community perspectives")).toBeInTheDocument();
  });

  it("asks once when opened, then follows the music with one request per song while open", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ entity }));
    const { rerender } = render(<CommunityEntityLens entityUri={songs[0]} />);
    await open();
    expect(await screen.findByText("Mira")).toBeInTheDocument();
    for (const song of songs.slice(1, 4)) {
      rerender(<CommunityEntityLens entityUri={song} />);
      await act(async () => {});
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("shows individual Community contributors and their tags", async () => {
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
    await open();

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getByText("Your public tags")).toBeInTheDocument();
    expect(screen.getByText("Theo")).toBeInTheDocument();
    expect(screen.getByText("Nocturnal")).toBeInTheDocument();
    expect(screen.getByText("Peak-time")).toBeInTheDocument();
    expect(screen.getByText("2 contributors")).toBeInTheDocument();
    expect(screen.queryByText("Community rating")).not.toBeInTheDocument();
    expect(screen.queryByText("Ways people tag this")).not.toBeInTheDocument();
    expect(screen.queryByText("Discussion")).not.toBeInTheDocument();
    expect(screen.queryByText("Open full Community page")).not.toBeInTheDocument();
  });

  it("shows what this session already knows at once, and checks again on open", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const fetchMock = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json({ entity }))
        .mockResolvedValueOnce(Response.json({ entity: { ...entity, contributors: [...entity.contributors, { ...entity.contributors[0], handle: "theo", displayName: "Theo" }] } }));
      await lookupCommunityEntity("track", "1eyzqe2QqGZUmfcPZtrIyt");

      render(<CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />);
      expect(screen.getByText("1 contributor")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + COMMUNITY_ENTITY_REVALIDATE_MS);
      await open();
      // The known answer stays visible while Community is checked.
      expect(screen.getByText("Mira")).toBeInTheDocument();
      expect(await screen.findByText("Theo")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("says when nobody has shared tags yet", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ entity: { ...entity, contributors: [] } }));
    render(<CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />);
    await open();
    expect(await screen.findByText("No one has shared public tags for this yet.")).toBeInTheDocument();
  });

  it("explains when Community cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />);
    await open();
    expect(await screen.findByText(/Community can’t be reached right now/)).toBeInTheDocument();
  });

  it("reads the public page without credentials, even while Cloud Sync is connected", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ entity }));
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
      }),
    );

    render(<CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />);
    await open();

    expect(await screen.findByText("Mira")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://community.tagify.fm/api/v2/public-entities/track/1eyzqe2QqGZUmfcPZtrIyt",
    );
  });

  it("shares one request between views of the same song", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ entity }));

    render(<>
      <CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />
      <CommunityEntityLens entityUri="spotify:track:1eyzqe2QqGZUmfcPZtrIyt" />
    </>);
    await open(0);
    await open(1);

    expect(await screen.findAllByText("Mira")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
