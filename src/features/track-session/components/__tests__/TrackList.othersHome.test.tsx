import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilterState } from "@/features/filter-state";
import type { CommunityTagSearchState } from "@/features/community/tagSearch/useCommunityTagSearch";
import type { TrackListCommunity } from "@/features/track-session/hooks/useTrackListCommunity";
import { TagTaxonomy } from "@/types/tagData";
import TrackList from "../TrackList";

const community = vi.hoisted(() => ({ current: null as unknown as TrackListCommunity }));
vi.mock("@/features/track-session/hooks/useTrackListCommunity", () => ({
  useTrackListCommunity: () => community.current,
}));
const tagSearch = vi.hoisted(() => ({ current: null as unknown as CommunityTagSearchState }));
vi.mock("@/features/community/tagSearch/useCommunityTagSearch", () => ({
  useCommunityTagSearch: () => tagSearch.current,
}));
vi.mock("@/features/community/tagSearch/CommunityTagResults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/community/tagSearch/CommunityTagResults")>()),
  CommunityTagSearch: ({ tags, afterSave }: { tags: readonly string[]; afterSave?: () => void }) => (
    <div>
      <p>Songs members tagged {tags.join(" + ")}</p>
      <button type="button" onClick={afterSave}>Save the first song</button>
    </div>
  ),
}));
const analytics = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: analytics.record,
}));

const taxonomy = {
  categoryOrder: ["mood"],
  categoriesById: { mood: { id: "mood", name: "Mood", subcategoryIds: ["feel"] } },
  subcategoriesById: { feel: { id: "feel", name: "Feel", categoryId: "mood", tagIds: ["funky"] } },
  tagsById: { funky: { id: "funky", name: "Funky", subcategoryId: "feel", accentId: null } },
  customAccentsById: {}, colorThemesById: {}, ungroupedColorIds: [],
} as unknown as TagTaxonomy;
const SONG = "spotify:track:mySong0";

function Harness(props: Partial<React.ComponentProps<typeof TrackList>>) {
  const filters = useFilterState("tracks");
  return (
    <TrackList
      tracks={{ [SONG]: { name: "Diskoteka", artists: "Wawda & Mulo", rating: 5, energy: 0, bpm: null, tagIds: ["funky"], dateModified: 1 } }}
      taxonomy={taxonomy}
      includeTagClauses={[{ tagIds: ["funky"], excludedTagIds: [], operator: "AND" }] as typeof filters.includeTagClauses} clauseConnectors={filters.clauseConnectors} activeTagFilters={["funky"]}
      excludedTagFilters={filters.excludedTagFilters} selectedClauseIndex={filters.selectedClauseIndex} activeTrackUri={null}
      onAddIncludeClause={filters.addIncludeClause} onRemoveIncludeClause={filters.removeIncludeClause} onSelectClause={filters.setSelectedClauseIndex}
      onSetIncludeClauseOperator={filters.setIncludeClauseOperator} onSetClauseConnector={filters.setClauseConnector} onRemoveTagFilter={filters.removeTagFilter}
      onToggleTagIncludeOff={filters.toggleTagIncludeOff} onMoveTagToClauseLane={filters.moveTagToClauseLane} onReplaceTagFilterFormula={filters.replaceTagFilterFormula}
      onPlayTrack={vi.fn()} onTagTrack={vi.fn()} onClearTagFilters={filters.clearTagFilters} onCreatePlaylist={vi.fn().mockResolvedValue(null)}
      onCreateSmartPlaylist={vi.fn()} smartPlaylists={[]} onSetSmartPlaylists={vi.fn()} onSyncPlaylist={vi.fn().mockResolvedValue(undefined)}
      onExportSmartPlaylists={vi.fn()} onImportSmartPlaylists={vi.fn()} onAddCommunityTags={vi.fn().mockResolvedValue(undefined)}
      communityTagSearch={{ viewer: "me", onConnect: vi.fn(), onShare: vi.fn(), onPlay: vi.fn() }}
      taggedByOthersView={<p>Your songs others tagged</p>}
      {...props}
    />
  );
}

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("tagify:lastSeenVersion", "3.4.1");
  analytics.record.mockClear();
  community.current = { others: new Map(), people: new Map(), available: true, status: "done" };
  tagSearch.current = { phase: "done", songs: [], total: 1, capped: false, locked: null, failure: null, hasMore: false, loadingMore: false, loadMore: vi.fn() };
});

const viewOpened = () => analytics.record.mock.calls.filter(([event]) => event === "tagged_by_others_view_opened").map(([, details]) => details);

describe("TrackList: one home for other members' songs", () => {
  it("keeps Tagged Tracks to the member's own songs, with one line leading to the songs others tagged that way", () => {
    render(<Harness />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual(["Tagged Tracks", "Tagged by others", "To Tag"]);
    expect(screen.getByRole("button", { name: /^1 song tagged Funky by others/ })).toBeInTheDocument();
    expect(screen.getByText("Diskoteka")).toBeVisible();
    expect(screen.queryByRole("tab", { name: /On Community/ })).not.toBeInTheDocument();
    expect(viewOpened()).toEqual([]);
  });

  it("says nothing when no other member tagged songs that way, or Community can't be reached", () => {
    tagSearch.current = { ...tagSearch.current, total: 0 };
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole("button", { name: /by others/ })).not.toBeInTheDocument();
    unmount();
    tagSearch.current = { ...tagSearch.current, phase: "failed", failure: "unreachable", total: 0 };
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /by others/ })).not.toBeInTheDocument();
  });

  it("has no line without Community's tag search, on a list opened from Stats, or without the Tagged by others tab", () => {
    const { unmount } = render(<Harness communityTagSearch={undefined} />);
    expect(screen.queryByRole("button", { name: /by others/ })).not.toBeInTheDocument();
    unmount();
    const stats = render(<Harness statsTrackSet={{ id: 1, label: "Top rated", trackUris: [SONG] }} />);
    expect(screen.queryByRole("button", { name: /by others/ })).not.toBeInTheDocument();
    stats.unmount();
    render(<Harness taggedByOthersView={undefined} />);
    expect(screen.queryByRole("button", { name: /by others/ })).not.toBeInTheDocument();
  });

  it("opens Tagged by others on New to you with the filter's tags, and counts a song saved from there", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^1 song tagged Funky by others/ }));
    expect(screen.getByRole("tab", { name: /^Tagged by others/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "New to you" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Songs members tagged Funky")).toBeVisible();
    expect(screen.queryByText("Diskoteka")).not.toBeInTheDocument();
    expect(viewOpened()).toEqual([{ view: "new_to_you", entry: "filter_link" }]);

    await user.click(screen.getByRole("button", { name: "Save the first song" }));
    expect(analytics.record).toHaveBeenCalledWith("community_song_saved_to_liked", { entry: "filter_link" });
  });

  it("switches between Your songs and New to you, and remembers which was showing", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole("tab", { name: /^Tagged by others/ }));
    expect(screen.getByRole("tab", { name: "Your songs" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Your songs others tagged")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "New to you" }));
    expect(screen.getByText(/^Choose a tag to see songs other members tagged that way/)).toBeVisible();
    // The member's own tags are offered in Filters; choosing one asks Community.
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("button", { name: "Funky" }));
    expect(screen.getByText("Songs members tagged Funky")).toBeVisible();
    expect(viewOpened()).toEqual([{ view: "your_songs", entry: "tab" }, { view: "new_to_you", entry: "tab" }]);

    unmount();
    analytics.record.mockClear();
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "New to you" })).toHaveAttribute("aria-selected", "true");
    expect(viewOpened()).toEqual([{ view: "new_to_you", entry: "restored" }]);
  });

  it("is only the member's songs while Community's tag search is off", async () => {
    const user = userEvent.setup();
    render(<Harness communityTagSearch={undefined} />);
    await user.click(screen.getByRole("tab", { name: /^Tagged by others/ }));
    expect(screen.getByText("Your songs others tagged")).toBeVisible();
    expect(screen.queryByRole("tab", { name: "New to you" })).not.toBeInTheDocument();
    expect(viewOpened()).toEqual([{ view: "your_songs", entry: "tab" }]);
  });
});
