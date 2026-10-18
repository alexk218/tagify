import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaggingQueue } from "../TaggingQueue";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
const { getTaggingQueuePage } = vi.hoisted(() => ({ getTaggingQueuePage: vi.fn() }));
vi.mock("@/services/SpotifyApiService", () => ({ spotifyApiService: { getTaggingQueuePage } }));
const one = { uri: "spotify:track:one", name: "One", artists: [{ name: "Artist" }], album: { name: "Album" }, duration_ms: 100 };
const two = { ...one, uri: "spotify:track:two", name: "Two" };
const initial = { tracks: [one, two], checked: 2, unavailable: 0, nextOffset: 2, total: 3 };
const props = { tracks: {}, taxonomy: createEmptyTaxonomy(), onTagTrack: vi.fn(), onTagTracks: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); });
it("checks only on request, opens an untagged track, and removes completed tracks as saved data changes", async () => {
  getTaggingQueuePage.mockResolvedValue(initial);
  const { rerender } = render(<TaggingQueue {...props} />);
  expect(getTaggingQueuePage).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText("Tagging queue"));
  await userEvent.click(screen.getByRole("button", { name: "Check first 50" }));
  expect(await screen.findByRole("status")).toHaveTextContent("2 needing attention · 2 of 3 checked · More tracks to check");
  await userEvent.click(screen.getByRole("button", { name: "Tag next track" }));
  expect(props.onTagTrack).toHaveBeenCalledWith(one.uri);
  rerender(<TaggingQueue {...props} tracks={{ [one.uri]: { rating: 0, energy: 0, bpm: null, tagIds: ["done"] } }} />);
  expect(screen.queryByRole("button", { name: "Tag One" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Select this page" }));
  await userEvent.click(screen.getByRole("button", { name: "Tag selected (1)" }));
  expect(props.onTagTracks).toHaveBeenCalledWith([two]);
});
it("keeps a failed next page retryable without claiming the library is checked", async () => {
  getTaggingQueuePage.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error("Spotify needs a break"));
  render(<TaggingQueue {...props} />);
  await userEvent.click(screen.getByText("Tagging queue"));
  await userEvent.click(screen.getByRole("button", { name: "Check first 50" }));
  await userEvent.click(screen.getByRole("button", { name: "Check next 50" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Spotify needs a break");
  expect(screen.getByRole("status")).toHaveTextContent("More tracks to check");
  expect(screen.getByRole("button", { name: "Tag One" })).toBeVisible();
});
it("discards a stopped page when the user chooses a new source", async () => {
  let finish!: (value: typeof initial) => void;
  getTaggingQueuePage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<TaggingQueue {...props} />);
  await userEvent.click(screen.getByText("Tagging queue"));
  await userEvent.click(screen.getByRole("button", { name: "Check first 50" }));
  await userEvent.click(screen.getByRole("button", { name: "Stop checking" }));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Queue source" }), "playlist");
  await act(async () => { finish(initial); });
  expect(screen.queryByRole("button", { name: "Tag One" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "Spotify playlist link" })).toBeVisible();
});
it("stops with progress kept when Spotify repeats the previous page", async () => {
  getTaggingQueuePage.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, nextOffset: 4 });
  render(<TaggingQueue {...props} />);
  await userEvent.click(screen.getByText("Tagging queue"));
  await userEvent.click(screen.getByRole("button", { name: "Check all tracks" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Spotify stopped advancing through your library");
  expect(getTaggingQueuePage).toHaveBeenCalledTimes(2);
  expect(getTaggingQueuePage).toHaveBeenLastCalledWith(null, 2, expect.any(AbortSignal));
  expect(screen.getByRole("status")).toHaveTextContent("More tracks to check");
});

it("accepts songs that appear again later in a playlist", async () => {
  getTaggingQueuePage.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, tracks: [one], checked: 1, nextOffset: null });
  render(<TaggingQueue {...props} />);
  await userEvent.click(screen.getByText("Tagging queue"));
  await userEvent.click(screen.getByRole("button", { name: "Check all tracks" }));
  expect(await screen.findByRole("status")).toHaveTextContent("2 needing attention · 3 of 3 checked · Library checked");
});
