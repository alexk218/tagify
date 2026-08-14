import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaggedPlaylistsList from "../TaggedPlaylistsList";
import { useFilterState } from "@/features/filter-state";
import { PlaylistData, TagTaxonomy } from "@/types/tagData";

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
    dateModified: 300,
  },
  "spotify:playlist:playlist-a": {
    name: "Playlist A",
    ownerName: "Owner A",
    rating: 3,
    energy: 4,
    tagIds: ["chill"],
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

function renderList(
  overrides: Partial<React.ComponentProps<typeof TaggedPlaylistsList>> = {},
) {
  const props: React.ComponentProps<typeof TaggedPlaylistsList> = {
    playlists,
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
      onRemoveTagFilter={filters.removeTagFilter}
      onSetTagFilterOperator={(operator) =>
        filters.setIncludeClauseOperator(0, operator)
      }
      onClearTagFilters={filters.clearTagFilters}
    />
  );
}

async function openFilters() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /filters/i }));
  return user;
}

describe("TaggedPlaylistsList", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows albums only in album mode", () => {
    renderList({ entityType: "album" });

    expect(screen.getByText("Tagged Albums")).toBeInTheDocument();
    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.getByText("Album B")).toBeInTheDocument();
    expect(screen.getByText("Album C")).toBeInTheDocument();
    expect(screen.queryByText("Playlist A")).not.toBeInTheDocument();
  });

  it("shows playlists only in playlist mode", () => {
    renderList({ entityType: "playlist" });

    expect(screen.getByText("Tagged Playlists")).toBeInTheDocument();
    expect(screen.getByText("Playlist A")).toBeInTheDocument();
    expect(screen.queryByText("Album A")).not.toBeInTheDocument();
    expect(screen.queryByText("Album B")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Album B")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: 'Exclude "House"' }));
    expect(screen.queryByText("Album A")).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Match Any" }));
    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.getByText("Album C")).toBeInTheDocument();

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
