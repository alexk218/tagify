import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TagDataStructure } from "@/types/tagData";
import { buildTaxonomyFromCategoryTree, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import { StatsWorkspace } from "../StatsWorkspace";

const NOW = new Date(2026, 9, 11, 12).getTime();
const day = (daysAgo: number) => NOW - daysAgo * 86_400_000;

function library(): TagDataStructure {
  return {
    schemaVersion: TAG_DATA_SCHEMA_VERSION,
    taxonomy: buildTaxonomyFromCategoryTree([
      { id: "cat_mood", name: "Mood", subcategories: [{ id: "sub_feel", name: "Feeling", tags: [
        { id: "tag_calm", name: "Calm", accentId: "teal" },
        { id: "tag_night", name: "Night drive" },
        { id: "tag_spare", name: "Spare" },
      ] }] },
    ]),
    tracks: {
      "spotify:track:a": { tagIds: ["tag_calm", "tag_night"], rating: 4, energy: 5, bpm: 120, dateCreated: day(1), name: "Alpha", artists: "M83" },
      "spotify:track:b": { tagIds: ["tag_calm"], rating: 0, energy: 0, bpm: null, dateCreated: day(40), name: "Beta", artists: "Slowdive" },
      "spotify:track:c": { tagIds: [], rating: 3, energy: 0, bpm: null, dateCreated: day(200) },
      "spotify:track:old": { tagIds: ["tag_night"], rating: 5, energy: 7, bpm: null },
    },
    playlists: {},
    artists: {},
  };
}

function renderStats(data = library()) {
  const handlers = { onShowTracks: vi.fn(), onOpenTrack: vi.fn(), onPlayTracks: vi.fn(), onClose: vi.fn() };
  render(<StatsWorkspace tagData={data} {...handlers} />);
  return handlers;
}

describe("StatsWorkspace", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("leads with how many tracks are tagged and what needs attention", () => {
    const handlers = renderStats();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("tracks tagged")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show tracks: 1 tagged track has no rating" }));
    expect(handlers.onShowTracks).toHaveBeenCalledWith({ label: "Tagged tracks with no rating", trackUris: ["spotify:track:b"] });
    fireEvent.click(screen.getByRole("button", { name: "Play: 1 tagged track has no rating" }));
    expect(handlers.onPlayTracks).toHaveBeenCalledWith(["spotify:track:b"]);
    expect(screen.getByText(/tag you haven't used yet/)).toBeInTheDocument();
  });

  it("switches sections and explains tracks without dates in a time range", () => {
    renderStats();
    fireEvent.click(screen.getByRole("tab", { name: "Tags" }));
    expect(screen.getByRole("heading", { name: "Tags that go together" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Last 30 days" }));
    expect(screen.getByText("Tracks you first tagged in the last 30 days.")).toBeInTheDocument();
    expect(screen.getByText(/1 track was tagged before Tagify kept dates/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByText("track tagged")).toBeInTheDocument();
  });

  it("opens one tag in depth and acts on its tracks", () => {
    const handlers = renderStats();
    fireEvent.click(screen.getByRole("tab", { name: "Tags" }));
    fireEvent.click(within(screen.getByRole("list", { name: "Most used tags" })).getByRole("button", { name: /Calm/ }));
    expect(screen.getByRole("heading", { name: "Calm" })).toBeInTheDocument();
    expect(screen.getByText("Mood > Feeling > Calm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Show tracks$/ }));
    expect(handlers.onShowTracks).toHaveBeenCalledWith({ label: "Tagged Calm", trackUris: ["spotify:track:a", "spotify:track:b"] });
    fireEvent.click(screen.getByRole("button", { name: /^Play$/ }));
    expect(handlers.onPlayTracks).toHaveBeenCalledWith(["spotify:track:a", "spotify:track:b"]);
    fireEvent.click(screen.getByRole("button", { name: "Open Alpha in Tagify" }));
    expect(handlers.onOpenTrack).toHaveBeenCalledWith("spotify:track:a", { label: "Tagged Calm", trackUris: ["spotify:track:a", "spotify:track:b"] });
    fireEvent.click(screen.getByRole("button", { name: "Play Alpha" }));
    expect(handlers.onPlayTracks).toHaveBeenCalledWith(["spotify:track:a"]);
    fireEvent.click(within(screen.getByRole("list", { name: "Top artists tagged Calm" })).getByRole("button", { name: /Slowdive/ }));
    expect(handlers.onShowTracks).toHaveBeenLastCalledWith({ label: "Tagged Calm, by Slowdive", trackUris: ["spotify:track:b"] });
    fireEvent.click(screen.getByRole("button", { name: "Rated 4★: 1. Show these tracks" }));
    expect(handlers.onShowTracks).toHaveBeenLastCalledWith({ label: "Tagged Calm, rated 4★", trackUris: ["spotify:track:a"] });
    fireEvent.click(screen.getByRole("button", { name: "October 2026: 1. Show these tracks" }));
    expect(handlers.onShowTracks).toHaveBeenLastCalledWith({ label: "Tagged Calm, first tagged in October 2026", trackUris: ["spotify:track:a"] });
    expect(screen.queryByText("Albums")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    expect(screen.getByRole("tab", { name: "Tags" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows activity and music charts with readable values", () => {
    renderStats();
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(screen.getByRole("img", { name: /3 tracks first tagged over the last year, on 3 different days/ })).toBeInTheDocument();
    expect(screen.getByText("1 track was tagged before Tagify kept dates, so it isn't in these charts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "October 2026: 1. Show these tracks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Music" }));
    expect(within(screen.getByRole("list", { name: "Most-tagged artists" })).getByText("M83")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "120–125 BPM: 1. Show these tracks" })).toBeInTheDocument();
  });

  it("opens the tracks behind charts and rows, naming the time range", () => {
    const handlers = renderStats();
    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    fireEvent.click(screen.getByRole("button", { name: "October 2026: 1. Show these tracks" }));
    expect(handlers.onShowTracks).toHaveBeenLastCalledWith({ label: "First tagged in October 2026", trackUris: ["spotify:track:a"] });
    fireEvent.click(screen.getByRole("radio", { name: "Last 12 months" }));
    fireEvent.click(screen.getByRole("tab", { name: "Ratings" }));
    fireEvent.click(screen.getByRole("button", { name: "Rated 4★: 1. Show these tracks" }));
    expect(handlers.onShowTracks).toHaveBeenLastCalledWith({ label: "Rated 4★ · Last 12 months", trackUris: ["spotify:track:a"] });
    fireEvent.click(screen.getByRole("tab", { name: "Music" }));
    fireEvent.click(within(screen.getByRole("list", { name: "Most-tagged artists" })).getByRole("button", { name: /M83/ }));
    expect(handlers.onShowTracks).toHaveBeenLastCalledWith({ label: "Tagged tracks by M83 · Last 12 months", trackUris: ["spotify:track:a"] });
  });

  it("takes you to the unused tags from the overview", () => {
    renderStats();
    fireEvent.click(screen.getByRole("button", { name: "See them" }));
    expect(screen.getByRole("tab", { name: "Tags" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Never used" })).toBeInTheDocument();
  });

  it("invites tagging when the library is empty", () => {
    renderStats({ ...library(), tracks: {} });
    expect(screen.getByText("Tag a few tracks and your stats will show up here.")).toBeInTheDocument();
  });

  it("closes", () => {
    const handlers = renderStats();
    fireEvent.click(screen.getByRole("button", { name: "Close stats" }));
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
