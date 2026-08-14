import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaggedArtistsList from "../TaggedArtistsList";
import { useFilterState } from "@/features/filter-state";
import { ArtistData, TagTaxonomy } from "@/types/tagData";

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

const artists: Record<string, ArtistData> = {
  "spotify:artist:alpha": {
    name: "DJ Alpha",
    rating: 5,
    energy: 9,
    tagIds: ["house", "chill"],
    followerCount: 1200,
    genres: ["house"],
    dateModified: 300,
  },
  "spotify:artist:beta": {
    name: "Beta Band",
    rating: 3,
    energy: 4,
    tagIds: ["chill"],
    followerCount: 900,
    genres: ["ambient"],
    dateModified: 200,
  },
  "spotify:artist:gamma": {
    name: "Gamma",
    rating: 4,
    energy: 6,
    tagIds: [],
    followerCount: 100,
    genres: [],
    dateModified: 100,
  },
};

function renderList(
  overrides: Partial<React.ComponentProps<typeof TaggedArtistsList>> = {},
) {
  const props: React.ComponentProps<typeof TaggedArtistsList> = {
    artists,
    taxonomy,
    includeTagClauses: [],
    clauseConnectors: [],
    activeTagFilters: [],
    excludedTagFilters: [],
    activeArtistUri: null,
    onSelectArtist: vi.fn(),
    onOpenArtist: vi.fn(),
    onCycleTagFilter: vi.fn(),
    onRemoveTagFilter: vi.fn(),
    onSetTagFilterOperator: vi.fn(),
    onClearTagFilters: vi.fn(),
    ...overrides,
  };

  render(<TaggedArtistsList {...props} />);
  return props;
}

function StatefulArtistList() {
  const filters = useFilterState("artists");

  return (
    <TaggedArtistsList
      artists={artists}
      taxonomy={taxonomy}
      includeTagClauses={filters.includeTagClauses}
      clauseConnectors={filters.clauseConnectors}
      activeTagFilters={filters.activeTagFilters}
      excludedTagFilters={filters.excludedTagFilters}
      activeArtistUri={null}
      onSelectArtist={vi.fn()}
      onOpenArtist={vi.fn()}
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

describe("TaggedArtistsList", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("filters by exact rating star chip", async () => {
    const user = await openFiltersAfterRender();

    await user.click(
      screen.getByRole("button", { name: "Filter artists by 5 star rating" }),
    );

    expect(screen.getByText("DJ Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta Band")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
  });

  it("filters by energy range", async () => {
    const user = await openFiltersAfterRender();

    await user.selectOptions(screen.getByLabelText("Minimum artist energy"), "9");

    expect(screen.getByText("DJ Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta Band")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
  });

  it("composes search, tag filters, rating, and energy", async () => {
    renderList({
      includeTagClauses: [{ tagIds: ["house"], excludedTagIds: [], operator: "OR" }],
      activeTagFilters: ["house"],
    });
    const user = await openFilters();

    await user.type(screen.getByPlaceholderText("Search artists..."), "dj");
    await user.click(
      screen.getByRole("button", { name: "Filter artists by 5 star rating" }),
    );
    await user.selectOptions(screen.getByLabelText("Minimum artist energy"), "9");

    expect(screen.getByText("DJ Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta Band")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
  });

  it("shows excluded available tags as red pills with strikethrough", async () => {
    await openFiltersAfterRender({ excludedTagFilters: ["house"] });
    const availableHouseTag = screen
      .getAllByTitle('Remove "House" from artist filters')
      .find((element) => element.tagName === "BUTTON");

    expect(availableHouseTag).toHaveStyle({
      backgroundColor: "#b91c1c",
      textDecoration: "line-through",
    });
  });

  it("cycles artist tags through include, exclude, and off", async () => {
    render(<StatefulArtistList />);
    const user = await openFilters();
    const house = screen.getByRole("button", { name: 'Include "House"' });

    await user.click(house);
    expect(screen.getByText("DJ Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta Band")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Exclude "House"' })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: 'Exclude "House"' }));
    expect(screen.queryByText("DJ Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Band")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Remove "House" filter' })).toHaveStyle({
      textDecoration: "line-through",
    });

    await user.click(screen.getByRole("button", { name: 'Remove "House" filter' }));
    expect(screen.getByText("DJ Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta Band")).toBeInTheDocument();
  });

  it("supports Match All and removable applied artist filters", async () => {
    render(<StatefulArtistList />);
    const user = await openFilters();

    expect(screen.queryByRole("button", { name: /complex/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Match All" }));
    await user.click(screen.getByRole("button", { name: 'Include "House"' }));
    await user.click(screen.getByRole("button", { name: 'Include "Chill"' }));

    expect(screen.getByText("DJ Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta Band")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Match Any" }));
    expect(screen.getByText("Beta Band")).toBeInTheDocument();

    const applied = screen.getByRole("button", {
      name: 'Remove included filter "House"',
    });
    expect(applied).toBeInTheDocument();
    await user.click(applied);
    expect(screen.getByText("DJ Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta Band")).toBeInTheDocument();
  });

  it("renders applied artist tags in taxonomy order", () => {
    renderList({
      artists: {
        ...artists,
        "spotify:artist:alpha": {
          ...artists["spotify:artist:alpha"],
          tagIds: ["chill", "house"],
        },
      },
    });

    const artistItem = screen
      .getByText("DJ Alpha")
      .closest('[class*="artistItem"]') as HTMLElement | null;

    expect(artistItem).toBeTruthy();
    if (!artistItem) {
      throw new Error("Expected DJ Alpha artist item");
    }

    expect(
      within(artistItem)
        .getAllByText(/^(House|Chill)$/)
        .map((element) => element.textContent),
    ).toEqual(["House", "Chill"]);
  });

  it("clears local and shared filters", async () => {
    const onClearTagFilters = vi.fn();
    const user = await openFiltersAfterRender({ onClearTagFilters });

    await user.click(
      screen.getByRole("button", { name: "Filter artists by 5 star rating" }),
    );
    expect(screen.queryByText("Beta Band")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear All" }));

    await waitFor(() => {
      expect(screen.getByText("DJ Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta Band")).toBeInTheDocument();
    });
    expect(onClearTagFilters).toHaveBeenCalledTimes(1);
  });
});

async function openFiltersAfterRender(
  overrides: Partial<React.ComponentProps<typeof TaggedArtistsList>> = {},
) {
  renderList(overrides);
  return openFilters();
}
