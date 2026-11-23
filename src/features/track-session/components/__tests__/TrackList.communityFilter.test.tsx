import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const MISSING = "spotify:track:missingSong00", OWNED = "spotify:track:ownedSong000", ALONE = "spotify:track:aloneSong000";
const item = (providerId: string, labels: string[]): TaggedByOthersItem => ({
  providerId, people: 2, peopleCapped: false, sample: ["ana"], tags: labels.map((label) => ({ label, paths: [label], people: 1 })),
});

function setCommunity(available: boolean) {
  // Others used Jazz on Missing Song (which only has House); on Owned Song they only used House.
  const map = new Map(available ? [[MISSING, item("missingSong00", ["house", "Jazz"])], [OWNED, item("ownedSong000", ["House"])]] : []);
  community.current = { others: map, people: new Map([...map].map(([uri, entry]) => [uri, entry.people])), available, status: available ? "done" : "off" };
}

function Harness() {
  const filters = useFilterState("tracks");
  return (
    <TrackList
      tracks={{
        [MISSING]: { name: "Missing Song", artists: "A", rating: 3, energy: 0, bpm: null, tagIds: ["house"], dateModified: 1 },
        [OWNED]: { name: "Owned Song", artists: "B", rating: 3, energy: 0, bpm: null, tagIds: ["house"], dateModified: 2 },
        [ALONE]: { name: "Alone Song", artists: "C", rating: 3, energy: 0, bpm: null, tagIds: ["house"], dateModified: 3 },
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

const titles = () => screen.queryAllByText(/(Missing|Owned|Alone) Song$/).map((element) => element.textContent?.replace(/^\W+/, "")).sort();

describe("TrackList: Filters without a Community section", () => {
  beforeAll(() => {
    vi.stubGlobal("IntersectionObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("tagify:showFilterOptions", "true");
  });

  it("has no Community section in Filters, and a filter saved before it was removed shows every song", () => {
    localStorage.setItem("tagify:trackListCommunityFilter", "tagged");
    setCommunity(true);
    render(<Harness />);
    expect(screen.queryByRole("heading", { name: "Community" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Has tags I don't/ })).not.toBeInTheDocument();
    expect(titles()).toEqual(["Alone Song", "Missing Song", "Owned Song"]);
  });
});
