import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstSongCard } from "../FirstSongCard";
const { getTaggingQueuePage, recordProductInteraction } = vi.hoisted(() => ({ getTaggingQueuePage: vi.fn(), recordProductInteraction: vi.fn() }));
vi.mock("@/services/SpotifyApiService", () => ({ spotifyApiService: { getTaggingQueuePage } }));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction }));
const song = (id: string, name: string) => ({ uri: `spotify:track:${id}`, name, artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: "https://i.scdn.co/image/cover" }] }, duration_ms: 100 });
const page = (tracks: unknown[]) => ({ tracks, checked: tracks.length, unavailable: 0, nextOffset: null, total: tracks.length });
const playing = { uri: "spotify:track:playing", name: "Playing Song", artists: [{ name: "Band" }], album: { name: "Album" }, duration_ms: 100 };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

it("offers up to six Liked Songs and opens the picked one for tagging", async () => {
  const liked = Array.from({ length: 8 }, (_, index) => song(`s${index}`, `Song ${index}`));
  getTaggingQueuePage.mockResolvedValue(page([...liked, { ...song("local", "Local"), uri: "spotify:local:a:b:c:1" }]));
  const onPick = vi.fn();
  render(<FirstSongCard currentTrack={playing} onPick={onPick} />);
  expect(await screen.findByText("From your Liked Songs")).toBeVisible();
  expect(getTaggingQueuePage).toHaveBeenCalledWith(null, 0, expect.any(AbortSignal));
  expect(screen.getAllByRole("button")).toHaveLength(6);
  expect(screen.queryByText("Playing Song")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Song 1/ }));
  expect(onPick).toHaveBeenCalledWith("spotify:track:s1");
  expect(recordProductInteraction).toHaveBeenCalledWith("first_run_shown", { liked_songs: "1+" });
  expect(recordProductInteraction).toHaveBeenCalledWith("first_run_song_picked", { first_run_source: "liked" });
});

it("offers the song Spotify is playing when Liked Songs is empty or unreadable", async () => {
  getTaggingQueuePage.mockRejectedValue(new Error("offline"));
  const onPick = vi.fn();
  render(<FirstSongCard currentTrack={playing} onPick={onPick} />);
  await userEvent.click(await screen.findByRole("button", { name: /Tag this song/ }));
  expect(onPick).toHaveBeenCalledWith("spotify:track:playing");
  expect(recordProductInteraction).toHaveBeenCalledWith("first_run_shown", { liked_songs: "0" });
  expect(recordProductInteraction).toHaveBeenCalledWith("first_run_song_picked", { first_run_source: "playing" });
});

it("asks for any song when there is nothing to suggest, and reports the card once a day", async () => {
  getTaggingQueuePage.mockResolvedValue(page([]));
  const { unmount } = render(<FirstSongCard currentTrack={null} onPick={vi.fn()} />);
  expect(await screen.findByText("Play any song in Spotify and it appears here, ready to tag.")).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
  unmount();
  render(<FirstSongCard currentTrack={null} onPick={vi.fn()} />);
  await screen.findByText("Play any song in Spotify and it appears here, ready to tag.");
  expect(recordProductInteraction.mock.calls.filter(([event]) => event === "first_run_shown")).toHaveLength(1);
});
