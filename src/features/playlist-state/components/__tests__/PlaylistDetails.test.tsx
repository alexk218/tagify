import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlaylistDetails from "../PlaylistDetails";
import { albumTrackTotalsStore } from "../../services/albumTrackTotals";
import { spotifyApiService } from "@/services/SpotifyApiService";
import {
  AlbumTrackSummary,
  PlaylistData,
  TagTaxonomy,
  TrackData,
} from "@/types/tagData";

const taxonomy: TagTaxonomy = {
  categoryOrder: ["genre", "context"],
  categoriesById: {
    genre: {
      id: "genre",
      name: "Genre",
      subcategoryIds: ["style"],
    },
    context: {
      id: "context",
      name: "Context",
      subcategoryIds: ["activity"],
    },
  },
  subcategoriesById: {
    style: {
      id: "style",
      name: "Style",
      categoryId: "genre",
      tagIds: ["rock", "ambient", "focus"],
    },
    activity: {
      id: "activity",
      name: "Activity",
      categoryId: "context",
      tagIds: ["workout"],
    },
  },
  tagsById: {
    rock: { id: "rock", name: "Rock", subcategoryId: "style", accentId: null },
    ambient: { id: "ambient", name: "Ambient", subcategoryId: "style", accentId: null },
    focus: { id: "focus", name: "Focus", subcategoryId: "style", accentId: null },
    workout: { id: "workout", name: "Workout", subcategoryId: "activity", accentId: null },
  },
  customAccentsById: {},
  colorThemesById: {},
  ungroupedColorIds: [],
};

const playlistData: PlaylistData = {
  name: "Taxonomy Ordered Playlist",
  ownerName: "Owner",
  rating: 0,
  energy: 0,
  tagIds: ["workout", "ambient", "rock"],
};

const albumData: PlaylistData = {
  name: "Glass Horizons",
  ownerName: "Maya Fields",
  description: "Released 2021-05-07",
  trackCount: 13,
  rating: 4.5,
  energy: 7,
  tagIds: ["rock"],
  dateCreated: Date.UTC(2026, 8, 27),
  dateModified: Date.UTC(2026, 9, 7),
};

const albumTrackSummary: AlbumTrackSummary = {
  taggedTrackCount: 9,
  ratedTrackCount: 8,
  ratingAverage: 4.25,
  energyTrackCount: 6,
  energyAverage: 6.5,
  commonTags: [
    { tagId: "rock", trackCount: 6, coverage: 6 / 9 },
    { tagId: "ambient", trackCount: 3, coverage: 3 / 9 },
  ],
  albumName: "Glass Horizons",
  artistName: "Maya Fields",
  imageUrl: null,
  lastTaggedAt: Date.UTC(2026, 9, 6),
};

function renderDetails(
  overrides: Partial<React.ComponentProps<typeof PlaylistDetails>> = {},
) {
  const props: React.ComponentProps<typeof PlaylistDetails> = {
    playlistUri: "spotify:playlist:123",
    playlistData,
    playlistMetadata: null,
    tracks: {},
    taxonomy,
    activeTagFilters: [],
    excludedTagFilters: [],
    onSetRating: vi.fn(),
    onSetEnergy: vi.fn(),
    onRemoveTag: vi.fn(),
    onToggleTagIncludeOff: vi.fn(),
    onOpenPlaylist: vi.fn(),
    onRefreshMetadata: vi.fn(),
    onLoadTrackUris: vi.fn().mockResolvedValue([]),
    onApplyTrackUpdates: vi.fn().mockResolvedValue(undefined),
    onTagTrack: vi.fn(),
    onSetTrackRating: vi.fn(),
    ...overrides,
  };

  render(<PlaylistDetails {...props} />);
  return props;
}

function renderAlbum(overrides: Partial<React.ComponentProps<typeof PlaylistDetails>> = {}) {
  return renderDetails({
    playlistUri: "spotify:album:glass",
    playlistData: albumData,
    albumTrackSummary,
    ...overrides,
  });
}

describe("PlaylistDetails", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    vi.spyOn(spotifyApiService, "getAlbumTrackTotals").mockResolvedValue(new Map());
    vi.spyOn(spotifyApiService, "getAlbumTracks").mockResolvedValue(null);
    vi.mocked(Spicetify.showNotification).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows playlist tags in taxonomy order", () => {
    renderDetails();

    const tags = within(screen.getByLabelText("Playlist tags")).getAllByRole(
      "button",
      { name: /rock|ambient|workout/i },
    );

    expect(tags.map((tag) => tag.textContent).filter(Boolean)).toEqual([
      "Rock",
      "Ambient",
      "Workout",
    ]);
    expect(screen.queryByLabelText("Tracks on this album")).not.toBeInTheDocument();
  });

  it("separates the album's own values from what its tracks say", () => {
    renderAlbum();

    expect(screen.getByText("Maya Fields")).toBeInTheDocument();
    expect(screen.getByText("2021")).toBeInTheDocument();
    expect(screen.getByText("13 tracks")).toBeInTheDocument();
    expect(screen.getByText("Album rating")).toBeInTheDocument();
    expect(screen.getByText("Album energy")).toBeInTheDocument();
    expect(screen.getByLabelText("Album tags")).toHaveTextContent("Rock");

    const insights = screen.getByLabelText("Tracks on this album");
    expect(insights).toHaveTextContent("9 of 13 tracks rated or tagged");
    expect(within(insights).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "9",
    );
    expect(within(insights).getByRole("progressbar")).toHaveAttribute(
      "aria-valuemax",
      "13",
    );
    expect(insights).toHaveTextContent("Average rating4.3from 8 tracks");
    expect(insights).toHaveTextContent("Average energy6.5from 6 tracks");
    expect(
      within(screen.getByLabelText("Common tags on your tracks")).getAllByRole("button"),
    ).toHaveLength(2);
    expect(screen.getByLabelText("Common tags on your tracks")).toHaveTextContent(
      "Rock6Ambient3",
    );
    expect(screen.queryByText(/coverage|threshold/i)).not.toBeInTheDocument();
  });

  it("switches an album tag filter on and off instead of excluding it", () => {
    renderAlbum({ activeTagFilters: ["rock"] });
    expect(
      within(screen.getByLabelText("Album tags")).getByRole("button", {
        name: 'Remove "Rock" filter',
      }),
    ).toHaveAttribute("title", 'Remove "Rock" from album filters');
  });

  it("offers to remove an excluded album tag filter rather than cycle it", () => {
    renderAlbum({ excludedTagFilters: ["rock"] });

    expect(
      within(screen.getByLabelText("Album tags")).getByRole("button", {
        name: 'Remove "Rock" filter',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Exclude/ })).not.toBeInTheDocument();
  });

  it("hides track averages that would come from a single track", () => {
    renderAlbum({
      albumTrackSummary: {
        ...albumTrackSummary,
        taggedTrackCount: 2,
        ratedTrackCount: 1,
        ratingAverage: null,
        energyTrackCount: 1,
        energyAverage: null,
      },
    });

    const insights = screen.getByLabelText("Tracks on this album");
    expect(insights).toHaveTextContent("2 of 13 tracks rated or tagged");
    expect(insights).not.toHaveTextContent("Average");
  });

  it("lists every album track with what you've set on it", async () => {
    vi.mocked(spotifyApiService.getAlbumTracks).mockResolvedValue([
      { uri: "spotify:track:t1", name: "Opening Lights", artists: "Maya Fields", discNumber: 1, trackNumber: 1 },
      { uri: "spotify:track:t2", name: "Paper Planes", artists: "Maya Fields", discNumber: 1, trackNumber: 2 },
    ]);
    const props = renderDetails({
      playlistUri: "spotify:album:tracklist",
      playlistData: { ...albumData, trackCount: 2 },
      albumTrackSummary: { ...albumTrackSummary, taggedTrackCount: 1 },
      tracks: {
        "spotify:track:t1": {
          rating: 4.5,
          energy: 7,
          bpm: null,
          tagIds: ["rock", "ambient"],
          albumUri: "spotify:album:tracklist",
        },
      },
    });
    const user = userEvent.setup();

    const tracksSection = screen.getByLabelText("Tracks on this album");
    const opening = await within(tracksSection).findByTitle('Edit "Opening Lights" in Tracks');
    expect(opening).toHaveTextContent("1Opening LightsRockAmbient");
    expect(
      within(tracksSection).getByRole("slider", { name: 'Rating for "Opening Lights"' }),
    ).toHaveAttribute("aria-valuetext", "4.5 stars");
    expect(within(tracksSection).getByTitle("Energy 7")).toHaveTextContent("7");
    expect(
      within(tracksSection).getByRole("slider", { name: 'Rating for "Paper Planes"' }),
    ).toHaveAttribute("aria-valuetext", "Not rated");

    await user.click(within(tracksSection).getByTitle('Tag "Paper Planes" in Tracks'));
    expect(props.onTagTrack).toHaveBeenCalledWith("spotify:track:t2");
  });

  it("rates album tracks without leaving the album", async () => {
    vi.mocked(spotifyApiService.getAlbumTracks).mockResolvedValue([
      { uri: "spotify:track:r1", name: "Opening Lights", artists: "Maya Fields", discNumber: 1, trackNumber: 1 },
      { uri: "spotify:track:r2", name: "Paper Planes", artists: "", discNumber: 1, trackNumber: 2 },
    ]);
    const props = renderDetails({
      playlistUri: "spotify:album:rating",
      playlistData: { ...albumData, trackCount: 2, imageUrl: "https://i.scdn.co/image/cover" },
      tracks: {
        "spotify:track:r1": {
          name: "Opening Lights",
          artists: "Maya Fields",
          rating: 3,
          energy: 0,
          bpm: null,
          tagIds: [],
          albumUri: "spotify:album:rating",
        },
      },
    });
    const user = userEvent.setup();
    const albumDetails = {
      albumName: "Glass Horizons",
      albumUri: "spotify:album:rating",
      albumImageUrl: "https://i.scdn.co/image/cover",
    };

    const unrated = await screen.findByRole("slider", { name: 'Rating for "Paper Planes"' });
    // The stars appear once their effect has run.
    await waitFor(() => expect(unrated.querySelectorAll("[data-index]")).toHaveLength(5));
    // Clicking the right half of the fourth star gives four full stars.
    fireEvent.click(unrated.querySelectorAll("[data-index]")[3], { clientX: 10 });
    expect(props.onSetTrackRating).toHaveBeenLastCalledWith("spotify:track:r2", 4, {
      name: "Paper Planes",
      artists: "Unknown Artist",
      ...albumDetails,
    });
    expect(unrated).toHaveAttribute("aria-valuetext", "4 stars");

    // Keyboard ratings keep focus on the stars while they save.
    unrated.focus();
    await user.keyboard("{ArrowRight}");
    expect(props.onSetTrackRating).toHaveBeenLastCalledWith(
      "spotify:track:r2",
      4.5,
      expect.objectContaining({ albumUri: "spotify:album:rating" }),
    );
    await user.keyboard("2");
    expect(props.onSetTrackRating).toHaveBeenLastCalledWith(
      "spotify:track:r2",
      2,
      expect.objectContaining({ albumUri: "spotify:album:rating" }),
    );
    expect(unrated).toHaveFocus();

    const rated = screen.getByRole("slider", { name: 'Rating for "Opening Lights"' });
    expect(rated).toHaveAttribute("aria-valuetext", "3 stars");
    await user.click(screen.getByRole("button", { name: 'Clear rating for "Opening Lights"' }));
    expect(props.onSetTrackRating).toHaveBeenLastCalledWith("spotify:track:r1", 0, {
      name: "Opening Lights",
      artists: "Maya Fields",
      ...albumDetails,
    });
    expect(rated).toHaveAttribute("aria-valuetext", "Not rated");
    expect(rated).toHaveFocus();
    expect(props.onTagTrack).not.toHaveBeenCalled();
  });

  it("shows a single's one track instead of a progress bar", async () => {
    vi.mocked(spotifyApiService.getAlbumTracks).mockResolvedValue([
      { uri: "spotify:track:single", name: "Manos", artists: "Titán", discNumber: 1, trackNumber: 1 },
    ]);
    renderDetails({
      playlistUri: "spotify:album:single",
      playlistData: undefined,
      playlistMetadata: {
        name: "Manos",
        ownerName: "Titán",
        imageUrl: null,
        description: null,
        trackCount: 1,
        snapshotId: null,
      },
      albumTrackSummary: { ...albumTrackSummary, taggedTrackCount: 1 },
      tracks: {
        "spotify:track:single": {
          rating: 4,
          energy: 0,
          bpm: null,
          tagIds: ["rock"],
          albumUri: "spotify:album:single",
        },
      },
    });

    const tracksSection = screen.getByLabelText("Tracks on this album");
    expect(within(tracksSection).getByRole("heading", { name: "Track" })).toBeInTheDocument();
    expect(within(tracksSection).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(await within(tracksSection).findByTitle('Edit "Manos" in Tracks')).toHaveTextContent(
      "Rock",
    );
  });

  it("falls back to the tracks you've rated or tagged when Spotify can't list the album", async () => {
    renderDetails({
      playlistUri: "spotify:album:unlisted",
      albumTrackSummary: { ...albumTrackSummary, taggedTrackCount: 1 },
      tracks: {
        "spotify:track:known": {
          name: "Known Song",
          rating: 3,
          energy: 0,
          bpm: null,
          tagIds: [],
          albumUri: "spotify:album:unlisted",
        },
        "spotify:track:elsewhere": {
          name: "Other Album Song",
          rating: 5,
          energy: 0,
          bpm: null,
          tagIds: [],
          albumUri: "spotify:album:other",
        },
      },
    });

    const tracksSection = screen.getByLabelText("Tracks on this album");
    expect(
      await within(tracksSection).findByText(/only the ones you've rated or tagged are shown/),
    ).toBeInTheDocument();
    expect(within(tracksSection).getByTitle('Edit "Known Song" in Tracks')).toBeInTheDocument();
    expect(within(tracksSection).queryByText("Other Album Song")).not.toBeInTheDocument();
  });

  it("filters the album list from a common track tag", async () => {
    const props = renderAlbum();
    const user = userEvent.setup();

    await user.click(
      within(screen.getByLabelText("Common tags on your tracks")).getByRole("button", {
        name: /Ambient/,
      }),
    );

    expect(props.onToggleTagIncludeOff).toHaveBeenCalledWith("ambient");
  });

  it("measures progress against a saved album length when only tracks are tagged", () => {
    albumTrackTotalsStore.remember({ "spotify:album:tracks-only": 11 });

    renderDetails({
      playlistUri: "spotify:album:tracks-only",
      playlistData: undefined,
      albumTrackSummary: { ...albumTrackSummary, taggedTrackCount: 2, albumName: "Quiet Machines" },
    });

    expect(screen.getByRole("button", { name: "Quiet Machines" })).toBeInTheDocument();
    expect(screen.getByText("2 of 11 tracks rated or tagged")).toBeInTheDocument();
  });

  it("looks up the album length when it is unknown", async () => {
    vi.mocked(spotifyApiService.getAlbumTrackTotals).mockResolvedValue(
      new Map([["spotify:album:unknown-length", 7]]),
    );

    renderDetails({
      playlistUri: "spotify:album:unknown-length",
      playlistData: undefined,
      albumTrackSummary: { ...albumTrackSummary, taggedTrackCount: 7 },
    });

    expect(await screen.findByText("All 7 tracks rated or tagged")).toBeInTheDocument();
  });

  it("remembers the album length from fresh Spotify details", () => {
    renderDetails({
      playlistUri: "spotify:album:fresh",
      playlistData: undefined,
      playlistMetadata: {
        name: "Fresh",
        ownerName: null,
        imageUrl: null,
        description: null,
        trackCount: 12,
        snapshotId: null,
      },
    });

    expect(albumTrackTotalsStore.getSnapshot()["spotify:album:fresh"]).toBe(12);
    expect(screen.getByText("None of the 12 tracks rated or tagged yet")).toBeInTheDocument();
  });

  it("hides Apply to tracks until the album has its own tags, rating, or energy", () => {
    renderAlbum({ playlistData: { ...albumData, rating: 0, energy: 0, tagIds: [] } });

    expect(screen.queryByRole("button", { name: /Apply to tracks/ })).not.toBeInTheDocument();
    expect(screen.getByText("None yet. Choose tags below.")).toBeInTheDocument();
  });

  it("applies exactly the album's own values without replacing track values", async () => {
    const tracks: Record<string, TrackData> = {
      "spotify:track:rated": {
        rating: 3,
        energy: 0,
        bpm: null,
        tagIds: ["rock"],
        albumUri: "spotify:album:glass",
      },
    };
    const props = renderAlbum({
      playlistData: { ...albumData, tagIds: ["rock", "ambient"], rating: 4, energy: 0 },
      tracks,
      onLoadTrackUris: vi
        .fn()
        .mockResolvedValue([
          "spotify:track:rated",
          "spotify:track:new-a",
          "spotify:track:new-b",
        ]),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Apply to tracks/ }));
    const dialog = await screen.findByRole("dialog");

    expect(props.onLoadTrackUris).toHaveBeenCalledWith("spotify:album:glass");
    expect(await within(dialog).findByText("Added to all 3 tracks.")).toBeInTheDocument();
    expect(within(dialog).getByText("Rock")).toBeInTheDocument();
    expect(within(dialog).getByText("Ambient")).toBeInTheDocument();
    expect(within(dialog).queryByText("Focus")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("Rates the 2 tracks without a rating yet."),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/Album energy/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Update 3 tracks" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const albumDetails = {
      albumUri: "spotify:album:glass",
      albumName: "Glass Horizons",
      albumImageUrl: null,
    };
    expect(props.onApplyTrackUpdates).toHaveBeenCalledWith([
      { trackUri: "spotify:track:rated", toAdd: ["ambient"], toRemove: [], albumDetails },
      {
        trackUri: "spotify:track:new-a",
        toAdd: ["rock", "ambient"],
        toRemove: [],
        newRating: 4,
        albumDetails,
      },
      {
        trackUri: "spotify:track:new-b",
        toAdd: ["rock", "ambient"],
        toRemove: [],
        newRating: 4,
        albumDetails,
      },
    ]);
    expect(Spicetify.showNotification).toHaveBeenCalledWith(
      "Updated 3 tracks from Glass Horizons",
    );
  });

  it("lets the user leave out the album rating", async () => {
    const props = renderAlbum({
      playlistData: { ...albumData, tagIds: [], rating: 4, energy: 7 },
      onLoadTrackUris: vi.fn().mockResolvedValue(["spotify:track:new"]),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Apply to tracks/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("checkbox", { name: /Album rating/ }));
    await user.click(within(dialog).getByRole("button", { name: "Update 1 track" }));

    await waitFor(() =>
      expect(props.onApplyTrackUpdates).toHaveBeenCalledWith([
        expect.objectContaining({ trackUri: "spotify:track:new", newEnergy: 7 }),
      ]),
    );
    expect(vi.mocked(props.onApplyTrackUpdates).mock.calls[0][0][0]).not.toHaveProperty(
      "newRating",
    );
  });

  it("offers a retry when Spotify does not return the album's tracks", async () => {
    const onLoadTrackUris = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(["spotify:track:new"]);
    renderAlbum({ onLoadTrackUris });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Apply to tracks/ }));
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText(/Spotify didn't return this album's tracks/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Update tracks" })).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Try again" }));

    expect(await within(dialog).findByRole("button", { name: "Update 1 track" })).toBeEnabled();
  });

  it("closes the dialog with Escape without changing anything", async () => {
    const props = renderAlbum({
      onLoadTrackUris: vi.fn().mockResolvedValue(["spotify:track:new"]),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Apply to tracks/ }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.onApplyTrackUpdates).not.toHaveBeenCalled();
  });
});
