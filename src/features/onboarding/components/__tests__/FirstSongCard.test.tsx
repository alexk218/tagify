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

it("asks what the person listens to below the songs, without moving them", async () => {
  getTaggingQueuePage.mockResolvedValue(page([song("s1", "Song 1")]));
  const onPick = vi.fn();
  render(<FirstSongCard currentTrack={null} onPick={onPick} tastePacks={<button type="button">Metal &amp; Heavy</button>} />);
  const packs = screen.getByRole("group", { name: /What do you listen to\?/ });
  expect(packs).toHaveTextContent("we'll add tags for it to Genre & Style");
  const songRow = await screen.findByRole("button", { name: /Song 1/ });
  expect(songRow.compareDocumentPosition(packs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.click(songRow);
  expect(onPick).toHaveBeenCalledWith("spotify:track:s1");
});

it("reports the taste pack row once per session, only when it is drawn", async () => {
  vi.resetModules();
  const { FirstSongCard: Card } = await import("../FirstSongCard");
  getTaggingQueuePage.mockResolvedValue(page([]));
  const first = render(<Card currentTrack={null} onPick={vi.fn()} />);
  await screen.findByText(/Play any song in Spotify/);
  expect(recordProductInteraction).not.toHaveBeenCalledWith("taste_packs_shown");
  first.rerender(<Card currentTrack={null} onPick={vi.fn()} tastePacks={<button type="button">Metal</button>} />);
  expect(recordProductInteraction).toHaveBeenCalledWith("taste_packs_shown");
  first.unmount();
  render(<Card currentTrack={null} onPick={vi.fn()} tastePacks={<button type="button">Metal</button>} />);
  await screen.findByText(/Play any song in Spotify/);
  expect(recordProductInteraction.mock.calls.filter(([event]) => event === "taste_packs_shown")).toHaveLength(1);
});

const { findCommunityMatches } = vi.hoisted(() => ({ findCommunityMatches: vi.fn() }));
vi.mock("../../services/communityMatches", () => ({ findCommunityMatches }));
const match = (id: string, name: string, labels: string[]) => ({
  track: song(id, name),
  tags: labels.map((label) => ({ label, paths: [`Mood & Energy / Atmosphere / ${label}`], people: 2 })),
});

it("shows Liked Songs members already tagged and adds their tags in one tap", async () => {
  const liked = Array.from({ length: 8 }, (_, index) => song(`s${index}`, `Song ${index}`));
  getTaggingQueuePage.mockResolvedValue(page(liked));
  findCommunityMatches.mockResolvedValue([match("s2", "Song 2", ["Dark", "Night drive"])]);
  const onAddMembersTags = vi.fn().mockResolvedValue(undefined);
  render(<FirstSongCard currentTrack={null} onPick={vi.fn()} onAddMembersTags={onAddMembersTags} />);
  expect(await screen.findByText("Members already tagged 1 of your song")).toBeVisible();
  // The whole page goes to the lookup, not just the six shown.
  expect(findCommunityMatches.mock.calls[0][0]).toHaveLength(8);
  expect(recordProductInteraction).toHaveBeenCalledWith("first_run_members_checked", { members_matches: "1-4" });
  await userEvent.click(screen.getByRole("button", { name: "Add Dark to Song 2" }));
  expect(onAddMembersTags).toHaveBeenCalledWith(expect.objectContaining({ track: expect.objectContaining({ uri: "spotify:track:s2" }) }),
    [expect.objectContaining({ label: "Dark" })], "tag");
  expect(await screen.findByRole("button", { name: "Dark added to Song 2" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Add all" }));
  // Only the tag not yet added goes in.
  expect(onAddMembersTags).toHaveBeenLastCalledWith(expect.anything(), [expect.objectContaining({ label: "Night drive" })], "all");
  expect(recordProductInteraction).toHaveBeenCalledWith("first_run_members_tag_added", { members_add: "all" });
});

it("keeps today's card when members haven't tagged any of the songs", async () => {
  getTaggingQueuePage.mockResolvedValue(page([song("s1", "Song 1")]));
  findCommunityMatches.mockResolvedValue([]);
  render(<FirstSongCard currentTrack={null} onPick={vi.fn()} onAddMembersTags={vi.fn()} />);
  expect(await screen.findByText("From your Liked Songs")).toBeVisible();
  await vi.waitFor(() => expect(recordProductInteraction).toHaveBeenCalledWith("first_run_members_checked", { members_matches: "0" }));
  expect(screen.queryByText(/Members already tagged/)).toBeNull();
});

it("shows the error and keeps the tag addable when adding fails", async () => {
  getTaggingQueuePage.mockResolvedValue(page([song("s1", "Song 1")]));
  findCommunityMatches.mockResolvedValue([match("s1", "Song 1", ["Dark"])]);
  const onAddMembersTags = vi.fn().mockRejectedValue(new Error("Your tags are still loading. Please try again."));
  render(<FirstSongCard currentTrack={null} onPick={vi.fn()} onAddMembersTags={onAddMembersTags} />);
  await userEvent.click(await screen.findByRole("button", { name: "Add Dark to Song 1" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your tags are still loading. Please try again.");
  expect(screen.getByRole("button", { name: "Add Dark to Song 1" })).toBeEnabled();
});
