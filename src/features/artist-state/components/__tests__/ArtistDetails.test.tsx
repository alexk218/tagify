import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ArtistDetails from "../ArtistDetails";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import type { ArtistData } from "@/types/tagData";
import type { ArtistTrackInsights } from "@/features/track-insights";

const taxonomy = buildTaxonomyFromCategoryTree([{ id: "cat_genre", name: "Genre", subcategories: [
  { id: "sub_style", name: "Style", tags: [{ id: "tag_house", name: "House" }, { id: "tag_disco", name: "Disco" }] },
] }]);
const artistUri = "spotify:artist:example";
const artistData: ArtistData = {
  name: "Maya Fields", rating: 4, energy: 7, tagIds: ["tag_house"], followerCount: 182400,
  genres: ["deep house"], dateCreated: Date.UTC(2026, 0, 2), dateModified: Date.UTC(2026, 9, 1),
};
const trackInsights: ArtistTrackInsights = {
  summaries: new Map([[artistUri, { artistName: "Maya Fields", albumName: null, imageUrl: null, lastTaggedAt: 1,
    taggedTrackCount: 9, ratedTrackCount: 8, ratingAverage: 4.2, energyTrackCount: 8, energyAverage: 6.5,
    commonTags: [{ tagId: "tag_disco", trackCount: 4, coverage: 0.44 }] }]]),
  pendingCount: 0, isChecking: false, blockedUntil: 0, retry: vi.fn(),
};

function renderArtist(overrides: Partial<React.ComponentProps<typeof ArtistDetails>> = {}) {
  const props: React.ComponentProps<typeof ArtistDetails> = {
    artistUri, artistData, trackInsights, taxonomy, activeTagFilters: [], excludedTagFilters: [],
    onSetRating: vi.fn(), onSetEnergy: vi.fn(), onAddTag: vi.fn(), onRemoveTag: vi.fn(),
    onToggleTagIncludeOff: vi.fn(), onOpenArtist: vi.fn(), onRefreshMetadata: vi.fn(),
    ...overrides,
  };
  render(<ArtistDetails {...props} />);
  return props;
}

beforeEach(() => {
  vi.spyOn(indexedDBStorage, "getPrivateNote").mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("lays out an artist like albums and playlists: details, own values, then tracks", async () => {
  const props = renderArtist();

  expect(screen.getByRole("heading", { name: "Maya Fields" })).toBeInTheDocument();
  expect(screen.getByText("182,400 followers")).toBeInTheDocument();
  expect(screen.getByText(/^Updated /)).toHaveAttribute("title", expect.stringContaining("First tagged"));
  expect(screen.getByText("Your artist rating")).toBeInTheDocument();
  expect(screen.getByText("Artist energy")).toBeInTheDocument();
  expect(within(screen.getByLabelText("Artist tags")).getByRole("button", { name: 'Include "House"' }))
    .toBeInTheDocument();

  const tracks = screen.getByLabelText("Your tracks by this artist");
  expect(tracks).toHaveTextContent("9 tracks rated or tagged");
  expect(tracks).toHaveTextContent("Track average4.2from 8 tracks");
  expect(tracks).toHaveTextContent("Average energy6.5from 8 tracks");
  await userEvent.click(within(tracks).getByRole("button", { name: "Add Disco to this artist" }));
  expect(props.onAddTag).toHaveBeenCalledWith("tag_disco");

  await userEvent.click(screen.getByRole("button", { name: "Refresh artist details from Spotify" }));
  expect(props.onRefreshMetadata).toHaveBeenCalledWith(artistUri);
  await userEvent.click(screen.getByRole("button", { name: "Maya Fields" }));
  expect(props.onOpenArtist).toHaveBeenCalledWith(artistUri);
});

it("invites tagging an artist that has no tags yet", () => {
  renderArtist({ artistData: { ...artistData, tagIds: [] } });
  expect(screen.getByText("None yet. Choose tags below.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Artist tags")).not.toBeInTheDocument();
});

it("notes when an artist's summary is based on the tracks checked so far", () => {
  renderArtist({ trackInsights: { ...trackInsights, pendingCount: 20 } });
  expect(screen.getByLabelText("Your tracks by this artist")).toHaveTextContent("Based on the tracks checked so far.");
  expect(screen.getByText(/From your checked tracks/)).toBeInTheDocument();
});
