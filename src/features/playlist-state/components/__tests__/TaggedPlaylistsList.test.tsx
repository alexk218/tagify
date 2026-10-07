import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaggedPlaylistsList from "../TaggedPlaylistsList";
import { useFilterState } from "@/features/filter-state";
import { PlaylistData, TagTaxonomy, TrackData } from "@/types/tagData";

const albumLengths = vi.hoisted(() => ({
  totals: {} as Record<string, number>,
  requested: [] as string[][],
}));

vi.mock("../../hooks/useAlbumTrackTotals", () => ({
  useKnownAlbumTrackTotals: () => albumLengths.totals,
  useAlbumTrackTotalLookups: (albumUris: string[]) => {
    albumLengths.requested.push(albumUris);
  },
}));

function showSingleTrackAlbums() {
  window.localStorage.setItem("tagify:albumListShowSingleTrackAlbums", "true");
}

const taxonomy: TagTaxonomy = {
  categoryOrder: ["genre"],
  categoriesById: {
    genre: {
      id: "genre",
      name: "Genre",
      subcategoryIds: ["mood"],
    },
  },
  subcategoriesById: {
    mood: {
      id: "mood",
      name: "Mood",
      categoryId: "genre",
      tagIds: ["house", "chill"],
    },
  },
  tagsById: {
    house: {
      id: "house",
      name: "House",
      subcategoryId: "mood",
      accentId: "blue",
    },
    chill: {
      id: "chill",
      name: "Chill",
      subcategoryId: "mood",
      accentId: null,
    },
  },
  customAccentsById: {},
  colorThemesById: {},
  ungroupedColorIds: [],
};

const playlists: Record<string, PlaylistData> = {
  "spotify:album:album-a": {
    name: "Album A",
    ownerName: "Artist A",
    rating: 5,
    energy: 8,
    tagIds: ["house"],
    trackCount: 10,
    dateModified: 300,
  },
  "spotify:playlist:playlist-a": {
    name: "Playlist A",
    ownerName: "Owner A",
    rating: 3,
    energy: 4,
    tagIds: ["chill"],
    trackCount: 42,
    dateModified: 200,
  },
  "spotify:album:album-b": {
    name: "Album B",
    ownerName: "Artist B",
    rating: 4,
    energy: 6,
    tagIds: [],
    dateModified: 100,
  },
  "spotify:album:album-c": {
    name: "Album C",
    ownerName: "Artist C",
    rating: 2,
    energy: 2,
    tagIds: ["chill"],
    dateModified: 50,
  },
};

const tracks: Record<string, TrackData> = {
  "spotify:track:rated-album-a": {
    albumName: "Album A",
    albumUri: "spotify:album:album-a",
    rating: 3,
    energy: 0,
    bpm: null,
    tagIds: [],
  },
  "spotify:track:rated-a": {
    name: "Rated A",
    artists: "Artist D",
    albumName: "Album D",
    albumUri: "spotify:album:album-d",
    rating: 4,
    energy: 7,
    bpm: null,
    tagIds: [],
  },
  "spotify:track:rated-b": {
    name: "Rated B",
    artists: "Artist D, Guest",
    albumName: "Album D",
    albumUri: "spotify:album:album-d",
    rating: 4.5,
    energy: 8,
    bpm: null,
    tagIds: ["house"],
  },
  "spotify:track:unrated": {
    name: "Unrated",
    artists: "Artist D",
    albumName: "Album D",
    albumUri: "spotify:album:album-d",
    rating: 0,
    energy: 0,
    bpm: null,
    tagIds: ["house", "chill"],
  },
  "spotify:track:rated-e": {
    albumName: "Album E",
    albumUri: "spotify:album:album-e",
    rating: 4.2,
    energy: 9,
    bpm: null,
    tagIds: [],
  },
  "spotify:track:tag-only": {
    name: "Tag Only",
    artists: "Artist F",
    albumName: "Album F",
    albumUri: "spotify:album:album-f",
    rating: 0,
    energy: 0,
    bpm: null,
    tagIds: ["chill"],
  },
  "spotify:track:energy-only": {
    name: "Energy Only",
    artists: "Artist G",
    albumName: "Album G",
    albumUri: "spotify:album:album-g",
    rating: 0,
    energy: 6,
    bpm: null,
    tagIds: [],
  },
};

function renderList(
  overrides: Partial<React.ComponentProps<typeof TaggedPlaylistsList>> = {},
) {
  const props: React.ComponentProps<typeof TaggedPlaylistsList> = {
    playlists,
    tracks,
    entityType: "album",
    taxonomy,
    includeTagClauses: [],
    clauseConnectors: [],
    activeTagFilters: [],
    excludedTagFilters: [],
    activePlaylistUri: null,
    onSelectPlaylist: vi.fn(),
    onOpenPlaylist: vi.fn(),
    onCycleTagFilter: vi.fn(),
    onToggleTagFilter: vi.fn(),
    onRemoveTagFilter: vi.fn(),
    onSetTagFilterOperator: vi.fn(),
    onClearTagFilters: vi.fn(),
    ...overrides,
  };

  render(<TaggedPlaylistsList {...props} />);
  return props;
}

function StatefulPlaylistList({ entityType }: { entityType: "album" | "playlist" }) {
  const filters = useFilterState(entityType === "album" ? "albums" : "playlists");

  return (
    <TaggedPlaylistsList
      playlists={playlists}
      tracks={tracks}
      entityType={entityType}
      taxonomy={taxonomy}
      includeTagClauses={filters.includeTagClauses}
      clauseConnectors={filters.clauseConnectors}
      activeTagFilters={filters.activeTagFilters}
      excludedTagFilters={filters.excludedTagFilters}
      activePlaylistUri={null}
      onSelectPlaylist={vi.fn()}
      onOpenPlaylist={vi.fn()}
      onCycleTagFilter={filters.cycleTagIncludeExcludeOff}
      onToggleTagFilter={filters.toggleBasicTagFilter}
      onRemoveTagFilter={filters.removeTagFilter}
      onSetTagFilterOperator={(operator) =>
        filters.setIncludeClauseOperator(0, operator)
      }
      onClearTagFilters={filters.clearTagFilters}
    />
  );
}

function getRow(name: string): HTMLElement {
  const row = screen.getByRole("button", { name }).closest<HTMLElement>(
    '[class*="playlistItem"]',
  );
  if (!row) {
    throw new Error(`No row for ${name}`);
  }
  return row;
}

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('[class*="playlistName"]')).map(
    (element) => element.textContent || "",
  );
}

async function openFilters() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^Filters\b/ }));
  return user;
}

describe("TaggedPlaylistsList", () => {
  beforeEach(() => {
    window.localStorage.clear();
    albumLengths.totals = {};
    albumLengths.requested = [];
  });

  it("shows albums only in album mode", () => {
    renderList({ entityType: "album" });

    expect(screen.getByText("Tagged Albums")).toBeInTheDocument();
    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.getByText("Album B")).toBeInTheDocument();
    expect(screen.getByText("Album C")).toBeInTheDocument();
    expect(screen.queryByText("Playlist A")).not.toBeInTheDocument();
    expect(screen.queryByText("Album", { exact: true })).not.toBeInTheDocument();
  });

  it("lists albums that only have tagged tracks, with their average track rating", () => {
    renderList({ entityType: "album" });

    expect(within(getRow("Album D")).getByText("Artist D")).toBeInTheDocument();
    expect(within(getRow("Album D")).getByText("4.3 avg")).toBeInTheDocument();
  });

  it("hides albums with just one rated or tagged track until asked", async () => {
    renderList({ entityType: "album" });
    const user = userEvent.setup();

    expect(rowNames()).toEqual(["Album A", "Album B", "Album C", "Album D"]);
    expect(screen.getByText(/^4 albums/)).toHaveTextContent(
      "4 albums · Show 3 more with one rated or tagged track",
    );

    await user.click(
      screen.getByRole("button", { name: "Show 3 more with one rated or tagged track" }),
    );

    expect(rowNames()).toEqual(expect.arrayContaining(["Album E", "Album F", "Album G"]));
    expect(screen.getByText(/^7 albums/)).toHaveTextContent(
      "7 albums · Hide 3 with one rated or tagged track",
    );
  });

  it("explains hidden one-track albums when nothing else matches", async () => {
    renderList({ entityType: "album" });
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("Search albums..."), "Album F");

    expect(
      screen.getByText(/Albums with just one rated or tagged track are hidden/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show them" }));
    expect(rowNames()).toEqual(["Album F"]);
  });

  it("only shows an average once more than one track is rated", () => {
    showSingleTrackAlbums();
    renderList({ entityType: "album" });

    expect(within(getRow("Album A")).queryByText(/avg/)).not.toBeInTheDocument();
    expect(within(getRow("Album E")).queryByText(/avg/)).not.toBeInTheDocument();
    expect(within(getRow("Album D")).getByText("4.3 avg")).toBeInTheDocument();
  });

  it("shows how many of each album's tracks are rated or tagged", () => {
    showSingleTrackAlbums();
    albumLengths.totals = { "spotify:album:album-d": 12, "spotify:album:album-g": 1 };
    renderList({ entityType: "album" });

    const albumA = within(getRow("Album A"));
    expect(albumA.getByText("1/10 tracks")).toBeInTheDocument();
    expect(albumA.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(within(getRow("Album D")).getByText("3/12 tracks")).toBeInTheDocument();
    expect(within(getRow("Album F")).getByText("1 rated or tagged")).toBeInTheDocument();
    expect(within(getRow("Album F")).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(getRow("Album B").querySelector('[class*="progressText"]')).toBeNull();
    expect(within(getRow("Album G")).getByText("1/1 track").className).toMatch(
      /progressComplete/,
    );
  });

  it("asks for missing album lengths in the order albums are shown", () => {
    renderList({ entityType: "album" });

    expect(albumLengths.requested[albumLengths.requested.length - 1]).toEqual([
      "spotify:album:album-b",
      "spotify:album:album-c",
      "spotify:album:album-d",
    ]);
  });

  it("shows common track tags beside album tags and filters by them", async () => {
    const props = renderList({
      includeTagClauses: [{ tagIds: ["house"], excludedTagIds: [], operator: "OR" }],
      activeTagFilters: ["house"],
    });
    const user = userEvent.setup();
    const albumD = within(getRow("Album D"));

    const house = albumD.getByTitle(/House is on 2 of the 3 tracks you've rated or tagged/);
    expect(house).toHaveTextContent("House");
    expect(albumD.queryByText("From tracks")).not.toBeInTheDocument();

    await user.click(house);
    expect(props.onToggleTagFilter).toHaveBeenCalledWith("house", "OR");
    expect(props.onCycleTagFilter).not.toHaveBeenCalled();
    expect(props.onSelectPlaylist).not.toHaveBeenCalled();
  });

  it("turns row tags on and off without excluding them", async () => {
    render(<StatefulPlaylistList entityType="album" />);
    const user = userEvent.setup();

    await user.click(
      within(getRow("Album A")).getByRole("button", { name: 'Filter albums by "House"' }),
    );
    expect(rowNames()).toEqual(["Album A", "Album D"]);

    await user.click(
      within(getRow("Album A")).getByRole("button", {
        name: 'Remove "House" from album filters',
      }),
    );
    expect(rowNames()).toContain("Album B");
    expect(document.querySelectorAll('[class*="tagExcluded"]')).toHaveLength(0);
    expect(within(getRow("Album A")).getByRole("button", { name: 'Filter albums by "House"' }))
      .toBeInTheDocument();
  });

  it("keeps Match All when row tags start the filter", async () => {
    render(<StatefulPlaylistList entityType="album" />);
    const user = await openFilters();

    await user.click(screen.getByRole("button", { name: "Match All" }));
    await user.click(
      within(getRow("Album A")).getByRole("button", { name: 'Filter albums by "House"' }),
    );
    await user.click(
      within(getRow("Album D")).getByRole("button", { name: 'Filter albums by "Chill"' }),
    );

    expect(rowNames()).toEqual(["Album D"]);
    expect(screen.getByRole("button", { name: "Match All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("labels track tags when the album has its own tags too", () => {
    renderList({
      playlists: {
        "spotify:album:album-d": {
          name: "Album D",
          rating: 0,
          energy: 0,
          tagIds: ["chill"],
        },
      },
    });
    const albumD = within(getRow("Album D"));

    expect(albumD.getByText("From tracks")).toBeInTheDocument();
    expect(
      within(albumD.getByLabelText("Common tags on your tracks")).getAllByRole("button"),
    ).toHaveLength(1);
  });

  it("neither shows nor filters by common tags from a single tagged track", async () => {
    showSingleTrackAlbums();
    render(<StatefulPlaylistList entityType="album" />);

    expect(
      within(getRow("Album F")).queryByLabelText("Common tags on your tracks"),
    ).not.toBeInTheDocument();

    const user = await openFilters();
    await user.click(screen.getByRole("button", { name: 'Include "Chill"' }));

    expect(rowNames()).toContain("Album C");
    expect(rowNames()).toContain("Album D");
    expect(rowNames()).not.toContain("Album F");
  });

  it("shows at most four common track tags in a row", () => {
    const tagIds = Array.from({ length: 6 }, (_, index) => `tag-${index}`);
    const manyTagTaxonomy: TagTaxonomy = {
      categoryOrder: ["genre"],
      categoriesById: {
        genre: { id: "genre", name: "Genre", subcategoryIds: ["mood"] },
      },
      subcategoriesById: {
        mood: {
          id: "mood",
          name: "Mood",
          categoryId: "genre",
          tagIds,
        },
      },
      tagsById: Object.fromEntries(
        tagIds.map((tagId, index) => [
          tagId,
          { id: tagId, name: `Tag ${index}`, subcategoryId: "mood" },
        ]),
      ),
      customAccentsById: {},
      colorThemesById: {},
      ungroupedColorIds: [],
    };

    const manyTagsTrack: TrackData = {
      name: "Many Tags",
      artists: "Artist",
      albumName: "Many Tags Album",
      albumUri: "spotify:album:many-tags",
      rating: 0,
      energy: 0,
      bpm: null,
      tagIds,
    };
    renderList({
      playlists: {},
      taxonomy: manyTagTaxonomy,
      tracks: {
        "spotify:track:many-tags-1": manyTagsTrack,
        "spotify:track:many-tags-2": manyTagsTrack,
      },
    });

    expect(
      within(screen.getByLabelText("Common tags on your tracks")).getAllByRole("button"),
    ).toHaveLength(4);
  });

  it("shows a locally cached track album cover on an album listed from its tracks", () => {
    renderList({
      entityType: "album",
      playlists: {},
      tracks: Object.fromEntries(
        ["spotify:track:covered-1", "spotify:track:covered-2"].map((trackUri) => [
          trackUri,
          {
            name: "Covered Track",
            artists: "Artist",
            albumName: "Covered Album",
            albumUri: "spotify:album:covered",
            albumImageUrl: "https://example.com/covered-album.jpg",
            rating: 5,
            energy: 0,
            bpm: null,
            tagIds: [],
          } as TrackData,
        ]),
      ),
    });

    expect(screen.getByAltText("Covered Album cover")).toHaveAttribute(
      "src",
      "https://example.com/covered-album.jpg",
    );
  });

  it("sorts by average track rating, ignoring single-track averages", async () => {
    renderList({
      entityType: "album",
      tracks: {
        ...tracks,
        "spotify:track:rated-e-2": {
          albumName: "Album E",
          albumUri: "spotify:album:album-e",
          rating: 3,
          energy: 0,
          bpm: null,
          tagIds: [],
        },
      },
    });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Sort albums by"), "trackAverage");

    expect(rowNames().slice(0, 2)).toEqual(["Album D", "Album E"]);
    expect(within(getRow("Album E")).getByText("3.6 avg")).toBeInTheDocument();
  });

  it("sorts by progress, with albums of unknown length last", async () => {
    showSingleTrackAlbums();
    albumLengths.totals = {
      "spotify:album:album-d": 4,
      "spotify:album:album-e": 1,
      "spotify:album:album-g": 2,
    };
    renderList({ entityType: "album" });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Sort albums by"), "progress");

    expect(rowNames().slice(0, 4)).toEqual(["Album E", "Album D", "Album G", "Album A"]);
  });

  it("falls back to Last updated when a saved sort is no longer offered", () => {
    window.localStorage.setItem("tagify:albumListSortBy", "trackEnergyAverage");
    renderList({ entityType: "album" });

    expect(screen.getByLabelText("Sort albums by")).toHaveValue("dateModified");
    expect(rowNames()[0]).toBe("Album A");
  });

  it("orders by the latest change to an album or any of its tracks", () => {
    renderList({
      tracks: {
        ...tracks,
        "spotify:track:recent": {
          albumName: "Album C",
          albumUri: "spotify:album:album-c",
          rating: 4,
          energy: 0,
          bpm: null,
          tagIds: [],
          dateModified: 1000,
        },
      },
    });

    expect(rowNames()[0]).toBe("Album C");
  });

  it("shows playlists only in playlist mode, without album progress", () => {
    renderList({ entityType: "playlist" });

    expect(screen.getByText("Tagged Playlists")).toBeInTheDocument();
    expect(screen.getByText("Playlist A")).toBeInTheDocument();
    expect(screen.getByText("42 tracks")).toBeInTheDocument();
    expect(screen.queryByText("Album A")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Sort playlists by")).queryByRole("option", {
        name: "Progress",
      }),
    ).not.toBeInTheDocument();
  });

  it("filters by exact rating star chip", async () => {
    const user = await openFiltersAfterRender();

    await user.click(
      screen.getByRole("button", {
        name: "Filter albums by 5 star rating",
      }),
    );

    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.queryByText("Album B")).not.toBeInTheDocument();
  });

  it("filters by energy range", async () => {
    const user = await openFiltersAfterRender();

    await user.selectOptions(
      screen.getByLabelText("Minimum album energy"),
      "8",
    );

    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.queryByText("Album B")).not.toBeInTheDocument();
  });

  it("composes search, tag filters, rating, and energy", async () => {
    renderList({
      includeTagClauses: [{ tagIds: ["house"], excludedTagIds: [], operator: "OR" }],
      activeTagFilters: ["house"],
    });
    const user = await openFilters();

    await user.type(screen.getByPlaceholderText("Search albums..."), "album");
    await user.click(
      screen.getByRole("button", {
        name: "Filter albums by 5 star rating",
      }),
    );
    await user.selectOptions(
      screen.getByLabelText("Minimum album energy"),
      "8",
    );

    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.queryByText("Album B")).not.toBeInTheDocument();
  });

  it("explains that album tag filters include tags common on tracks", async () => {
    await openFiltersAfterRender();

    expect(
      screen.getByText("Matches album tags and tags common on your tracks from each album."),
    ).toBeInTheDocument();
  });

  it("shows excluded available tags as red pills with strikethrough", async () => {
    await openFiltersAfterRender({ excludedTagFilters: ["house"] });
    const availableHouseTag = screen
      .getAllByTitle('Remove "House" from album filters')
      .find((element) => element.tagName === "BUTTON");

    expect(availableHouseTag).toHaveStyle({
      backgroundColor: "#b91c1c",
      textDecoration: "line-through",
    });
  });

  it("cycles album tags through include, exclude, and off", async () => {
    render(<StatefulPlaylistList entityType="album" />);
    const user = await openFilters();

    await user.click(screen.getByRole("button", { name: 'Include "House"' }));
    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.getByText("Album D")).toBeInTheDocument();
    expect(screen.queryByText("Album B")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: 'Exclude "House"' }));
    expect(screen.queryByText("Album A")).not.toBeInTheDocument();
    expect(screen.queryByText("Album D")).not.toBeInTheDocument();
    expect(screen.getByText("Album B")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: 'Remove "House" filter' }));
    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.getByText("Album B")).toBeInTheDocument();
  });

  it("supports Match Any/All and removable applied album filters", async () => {
    render(<StatefulPlaylistList entityType="album" />);
    const user = await openFilters();

    expect(screen.queryByRole("button", { name: /complex/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Match All" }));
    await user.click(screen.getByRole("button", { name: 'Include "House"' }));
    await user.click(screen.getByRole("button", { name: 'Include "Chill"' }));

    expect(screen.queryByText("Album A")).not.toBeInTheDocument();
    expect(screen.queryByText("Album C")).not.toBeInTheDocument();
    expect(screen.getByText("Album D")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Match Any" }));
    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.getByText("Album C")).toBeInTheDocument();
    expect(screen.getByText("Album D")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: 'Remove included filter "House"' }),
    );

    expect(screen.queryByText("Album A")).not.toBeInTheDocument();
    expect(screen.getByText("Album C")).toBeInTheDocument();
  });

  it("clears local and shared filters", async () => {
    const onClearTagFilters = vi.fn();
    const user = await openFiltersAfterRender({ onClearTagFilters });

    await user.type(screen.getByPlaceholderText("Search albums..."), "Artist B");
    expect(screen.queryByText("Album A")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear All" }));

    await waitFor(() => {
      expect(screen.getByText("Album A")).toBeInTheDocument();
      expect(screen.getByText("Album B")).toBeInTheDocument();
    });
    expect(onClearTagFilters).toHaveBeenCalledTimes(1);
  });
});

async function openFiltersAfterRender(
  overrides: Partial<React.ComponentProps<typeof TaggedPlaylistsList>> = {},
) {
  renderList(overrides);
  return openFilters();
}
