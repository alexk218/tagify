import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useFilterState } from "@/features/filter-state";
import { TagTaxonomy } from "@/types/tagData";
import type { TaggedByOthersItem } from "@/features/community/taggedByOthers/taggedByOthersScan";
import type { TrackListCommunity } from "@/features/track-session/hooks/useTrackListCommunity";
import TrackList from "../TrackList";

const community = vi.hoisted(() => ({ current: null as unknown as TrackListCommunity }));
vi.mock("@/features/track-session/hooks/useTrackListCommunity", () => ({
  useTrackListCommunity: () => community.current,
}));

const taxonomy: TagTaxonomy = {
  categoryOrder: ["genre"],
  categoriesById: { genre: { id: "genre", name: "Genre", subcategoryIds: ["style"] } },
  subcategoriesById: { style: { id: "style", name: "Style", categoryId: "genre", tagIds: ["house"] } },
  tagsById: { house: { id: "house", name: "House", subcategoryId: "style", accentId: null } },
  customAccentsById: {},
  colorThemesById: {},
  ungroupedColorIds: [],
};

const OLD = "spotify:track:oldSong0000", NEW = "spotify:track:newSong0000";
const tag = (label: string, people = 1) => ({ label, paths: [label], people });
const others: TaggedByOthersItem = {
  providerId: "oldSong0000", people: 50, peopleCapped: true, sample: ["ana"],
  tags: [tag("House", 9), tag("Deep", 5), tag("Warm", 2), tag("Late", 1), tag("Club", 1)],
};

function setCommunity(available: boolean) {
  const map = new Map(available ? [[OLD, others]] : []);
  community.current = { others: map, people: new Map([...map].map(([uri, item]) => [uri, item.people])), available, status: available ? "done" : "off" };
}

function Harness() {
  const filters = useFilterState("tracks");
  return (
    <TrackList
      tracks={{
        [OLD]: { name: "Old Song", artists: "A", rating: 3, energy: 0, bpm: null, tagIds: ["house"], dateModified: 1 },
        [NEW]: { name: "New Song", artists: "B", rating: 3, energy: 0, bpm: null, tagIds: ["house"], dateModified: 2 },
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
      onExportSmartPlaylists={vi.fn()}
      onImportSmartPlaylists={vi.fn()}
    />
  );
}

const titles = () => screen.getAllByText(/(Old|New) Song$/).map((element) => element.textContent?.replace(/^\W+/, ""));

describe("TrackList Community data", () => {
  beforeAll(() => {
    vi.stubGlobal("IntersectionObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  });

  it("sorts by most tagged by others and shows the count and top three tags on the row", async () => {
    localStorage.clear();
    localStorage.setItem("tagify:new-feature-seen:track-list-sort-community-people", "2026-11-14");
    setCommunity(true);
    const user = userEvent.setup();
    render(<Harness />);
    expect(titles()).toEqual(["New Song", "Old Song"]);

    await user.selectOptions(screen.getByDisplayValue("Last updated"), "Most tagged by others");
    expect(titles()).toEqual(["Old Song", "New Song"]);

    const row = screen.getByText("Old Song").closest("[id^='track-item-']") as HTMLElement;
    expect(within(row).getByText("50+ others")).toBeInTheDocument();
    for (const label of ["Deep", "Warm"]) expect(within(row).getByText(label)).toBeInTheDocument();
    expect(within(row).queryByText("Late")).not.toBeInTheDocument();
    expect(within(row).getByText("+2")).toBeInTheDocument();
    // The song already has House, so others' House is dimmed rather than hidden.
    const houses = within(row).getAllByText("House");
    expect(houses).toHaveLength(2);
    expect(houses.some((element) => /trackItemCommunityTagOwned/.test(element.className))).toBe(true);

    const newRow = screen.getByText("New Song").closest("[id^='track-item-']") as HTMLElement;
    expect(within(newRow).queryByText(/others?$/)).not.toBeInTheDocument();
  });

  it("hides the option without a Community connection and falls back to Last updated", () => {
    localStorage.clear();
    localStorage.setItem("tagify:trackListSortBy", "communityPeople");
    setCommunity(false);
    render(<Harness />);
    expect(screen.queryByRole("option", { name: "Most tagged by others" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Last updated")).toBeInTheDocument();
    expect(titles()).toEqual(["New Song", "Old Song"]);
    expect(localStorage.getItem("tagify:trackListSortBy")).toBe("communityPeople");
  });
});
