import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useFilterState } from "@/features/filter-state";
import { TagTaxonomy } from "@/types/tagData";
import TrackList from "../TrackList";

const taxonomy: TagTaxonomy = {
  categoryOrder: ["genre"],
  categoriesById: {
    genre: {
      id: "genre",
      name: "Genre",
      subcategoryIds: ["style"],
    },
  },
  subcategoriesById: {
    style: {
      id: "style",
      name: "Style",
      categoryId: "genre",
      tagIds: ["house", "chill"],
    },
  },
  tagsById: {
    house: {
      id: "house",
      name: "House",
      subcategoryId: "style",
      accentId: null,
    },
    chill: {
      id: "chill",
      name: "Chill",
      subcategoryId: "style",
      accentId: null,
    },
  },
  customAccentsById: {},
  colorThemesById: {},
  ungroupedColorIds: [],
};

function TrackListHarness() {
  const filters = useFilterState("tracks");

  return (
    <TrackList
      tracks={{
        "spotify:track:house": {
          name: "House Track",
          artists: "House Artist",
          rating: 5,
          energy: 8,
          bpm: 124,
          tagIds: ["house"],
        },
        "spotify:track:chill": {
          name: "Chill Track",
          artists: "Chill Artist",
          rating: 4,
          energy: 3,
          bpm: 90,
          tagIds: ["chill"],
        },
      }}
      taxonomy={taxonomy}
      includeTagClauses={filters.includeTagClauses}
      clauseConnectors={filters.clauseConnectors}
      activeTagFilters={filters.activeTagFilters}
      excludedTagFilters={filters.excludedTagFilters}
      selectedClauseIndex={filters.selectedClauseIndex}
      activeTrackUri={null}
      onAddIncludeClause={filters.addIncludeClause}
      onRemoveIncludeClause={filters.removeIncludeClause}
      onSelectClause={filters.setSelectedClauseIndex}
      onSetIncludeClauseOperator={filters.setIncludeClauseOperator}
      onSetClauseConnector={filters.setClauseConnector}
      onRemoveTagFilter={filters.removeTagFilter}
      onToggleTagIncludeOff={filters.toggleTagIncludeOff}
      onMoveTagToClauseLane={filters.moveTagToClauseLane}
      onReplaceTagFilterFormula={filters.replaceTagFilterFormula}
      onPlayTrack={vi.fn()}
      onTagTrack={vi.fn()}
      onClearTagFilters={filters.clearTagFilters}
      onCreatePlaylist={vi.fn().mockResolvedValue(null)}
      onCreateSmartPlaylist={vi.fn()}
      smartPlaylists={[]}
      onSetSmartPlaylists={vi.fn()}
      onSyncPlaylist={vi.fn().mockResolvedValue(undefined)}
      onCleanupDeletedSmartPlaylists={vi.fn().mockResolvedValue(undefined)}
      onExportSmartPlaylists={vi.fn()}
      onImportSmartPlaylists={vi.fn()}
    />
  );
}

describe("TrackList tag filtering", () => {
  beforeAll(() => {
    class IntersectionObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  });

  it("cycles a tag through Match, NOT, and off without a separate NOT lane", async () => {
    const user = userEvent.setup();
    render(<TrackListHarness />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    const houseFilter = screen.getByRole("button", { name: "House" });
    expect(screen.queryByText("Must not have")).not.toBeInTheDocument();

    await user.click(houseFilter);
    await waitFor(() => {
      expect(screen.getByText("House Track")).toBeInTheDocument();
      expect(screen.queryByText("Chill Track")).not.toBeInTheDocument();
    });
    expect(houseFilter).toHaveAccessibleName("MATCH House");
    const appliedMatchFilter = within(
      screen.getByLabelText("Applied tag filters"),
    ).getByRole("button", {
      name: "MATCH House applied filter",
    });
    expect(appliedMatchFilter).toBeEnabled();
    expect(within(appliedMatchFilter).queryByText("MATCH")).not.toBeInTheDocument();
    expect(within(houseFilter).queryByText("MATCH")).not.toBeInTheDocument();

    await user.click(houseFilter);
    await waitFor(() => {
      expect(screen.queryByText("House Track")).not.toBeInTheDocument();
      expect(screen.getByText("Chill Track")).toBeInTheDocument();
    });
    await user.unhover(houseFilter);
    expect(houseFilter).toHaveAccessibleName("NOT House");
    const appliedNotFilter = within(
      screen.getByLabelText("Applied tag filters"),
    ).getByRole("button", {
        name: "NOT House applied filter",
      });
    expect(appliedNotFilter).toBeEnabled();
    expect(within(appliedNotFilter).queryByText("NOT")).not.toBeInTheDocument();
    expect(appliedNotFilter).toHaveStyle({
      backgroundColor: "#b91c1c",
      textDecoration: "line-through",
    });
    const excludedLibraryTag = screen.getByRole("button", {
      name: "NOT House",
    });
    expect(within(excludedLibraryTag).queryByText("NOT")).not.toBeInTheDocument();
    expect(["rgb(185, 28, 28)", "rgb(153, 27, 27)"]).toContain(
      window.getComputedStyle(excludedLibraryTag).backgroundColor,
    );
    expect(excludedLibraryTag).toHaveStyle({
      textDecoration: "line-through",
    });

    await user.click(houseFilter);
    await waitFor(() => {
      expect(screen.getByText("House Track")).toBeInTheDocument();
      expect(screen.getByText("Chill Track")).toBeInTheDocument();
    });
    expect(houseFilter).toHaveAccessibleName("House");
    expect(
      within(screen.getByLabelText("Applied tag filters")).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("uses the same click cycle inside a complex filter group", async () => {
    const user = userEvent.setup();
    render(<TrackListHarness />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    await user.click(screen.getByRole("button", { name: "Complex" }));

    const houseFilter = screen.getByRole("button", { name: "House" });
    await user.click(houseFilter);
    expect(houseFilter).toHaveAccessibleName("MATCH House");
    expect(
      within(screen.getByLabelText("Applied tag filters")).getByRole("button", {
        name: "MATCH House applied filter",
      }),
    ).toBeEnabled();

    await user.click(houseFilter);
    expect(houseFilter).toHaveAccessibleName("NOT House");
    expect(
      within(screen.getByLabelText("Applied tag filters")).getByRole("button", {
        name: "NOT House applied filter",
      }),
    ).toBeEnabled();

    await user.click(houseFilter);
    expect(houseFilter).toHaveAccessibleName("House");
    expect(screen.queryByText("Must not have")).not.toBeInTheDocument();
  });

  it("turns an applied MATCH or NOT filter off with one click", async () => {
    const user = userEvent.setup();
    render(<TrackListHarness />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    const houseFilter = screen.getByRole("button", { name: "House" });
    await user.click(houseFilter);
    await user.click(
      within(screen.getByLabelText("Applied tag filters")).getByRole("button", {
        name: "MATCH House applied filter",
      }),
    );

    expect(houseFilter).toHaveAccessibleName("House");
    expect(screen.getByText("House Track")).toBeInTheDocument();
    expect(screen.getByText("Chill Track")).toBeInTheDocument();

    await user.click(houseFilter);
    await user.click(houseFilter);
    await user.click(
      within(screen.getByLabelText("Applied tag filters")).getByRole("button", {
        name: "NOT House applied filter",
      }),
    );

    expect(houseFilter).toHaveAccessibleName("House");
    expect(screen.getByText("House Track")).toBeInTheDocument();
    expect(screen.getByText("Chill Track")).toBeInTheDocument();
  });
});
