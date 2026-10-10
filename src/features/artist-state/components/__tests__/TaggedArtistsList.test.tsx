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
    onToggleTagFilter: vi.fn(),
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
      onToggleTagFilter={filters.toggleBasicTagFilter}
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
  await user.click(screen.getByRole("button", { name: /^Filters\b/ }));
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

  it("turns artist row tags on and off without excluding them", async () => {
    render(<StatefulArtistList />);
    const user = userEvent.setup();
    const betaRow = screen.getByText("Beta Band").closest<HTMLElement>("li");
    expect(betaRow).not.toBeNull();

    await user.click(
      within(betaRow!).getByRole("button", { name: 'Filter artists by "Chill"' }),
    );
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
    expect(screen.getByText("DJ Alpha")).toBeInTheDocument();

    await user.click(
      within(betaRow!).getByRole("button", { name: 'Remove "Chill" from artist filters' }),
    );
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(document.querySelectorAll('[class*="tagExcluded"]')).toHaveLength(0);
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
      .closest("li") as HTMLElement | null;

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

it("shows derived artists and keeps their own scores separate while sorting annotated counts", async () => {
  const summary = (name: string, count: number, average: number) => ({
    artistName: name, albumName: null, imageUrl: null, taggedTrackCount: count,
    ratedTrackCount: count, ratingAverage: average, energyTrackCount: 0, energyAverage: null, commonTags: [], lastTaggedAt: 123,
  });
  renderList({ trackInsights: {
    summaries: new Map([["spotify:artist:new-a", summary("Small Album Artist", 3, 5)], ["spotify:artist:new-b", summary("Many Tracks Artist", 20, 3)]]),
    pendingCount: 0, isChecking: false, blockedUntil: 0, retry: vi.fn(),
  } });
  expect(screen.getByText("Small Album Artist")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort artists by" }), "annotatedCount");
  const names = screen.getAllByTitle("Open artist in Spotify").map((node) => node.textContent);
  expect(names.slice(0, 2)).toEqual(["Many Tracks Artist", "Small Album Artist"]);
});

it("includes common track tags in artist filters without creating artist annotations", async () => {
  const onToggleTagFilter = vi.fn();
  renderList({ artists: {}, includeTagClauses: [{ tagIds: ["house"], excludedTagIds: [], operator: "OR" }], activeTagFilters: ["house"], onToggleTagFilter, trackInsights: {
    summaries: new Map([["spotify:artist:derived", { artistName: "Derived Artist", albumName: null, imageUrl: null,
      taggedTrackCount: 4, ratedTrackCount: 4, ratingAverage: 4, energyTrackCount: 0, energyAverage: null,
      commonTags: [{ tagId: "house", trackCount: 3, coverage: 0.75 }], lastTaggedAt: 123 }]]),
    pendingCount: 0, isChecking: false, blockedUntil: 0, retry: vi.fn(),
  } });
  expect(screen.getByText("Derived Artist")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "House 3" }));
  expect(onToggleTagFilter).toHaveBeenCalledWith("house", "OR");
});

it("summarizes an artist's tracks in its row while some tracks are unchecked", () => {
  const retry = vi.fn();
  renderList({ trackInsights: {
    summaries: new Map([["spotify:artist:alpha", { artistName: "DJ Alpha", albumName: null, imageUrl: null,
      taggedTrackCount: 4, ratedTrackCount: 3, ratingAverage: 4, energyTrackCount: 0, energyAverage: null,
      commonTags: [], lastTaggedAt: 123 }]]),
    pendingCount: 12, isChecking: false, blockedUntil: 0, retry,
  } });
  const row = within(screen.getByText("DJ Alpha").closest("li")!);

  expect(row.getByText("4 tracks rated or tagged so far")).toBeInTheDocument();
  expect(row.getByText("Track average: 4.0 · 3 rated")).toBeInTheDocument();
  expect(screen.getByText("12 of your tracks haven't been checked for artists yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check more tracks" })).toBeEnabled();
});
