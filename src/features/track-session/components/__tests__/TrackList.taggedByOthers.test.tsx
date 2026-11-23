import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const entity = vi.hoisted(() => ({ lookup: vi.fn(async () => ({ found: true, entity: { contributors: [] } })) }));
vi.mock("@/features/community/communityEntityCache", () => ({ lookupCommunityEntity: entity.lookup, peekCommunityEntity: () => undefined }));
const analytics = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: analytics.record,
}));
vi.mock("@/services/sync/SyncLocalState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sync/SyncLocalState")>()),
  getDesktopSyncConfiguration: () => ({ profile: { handle: "me" } }),
}));

const taxonomy = {
  categoryOrder: [], categoriesById: {}, subcategoriesById: {}, tagsById: {}, customAccentsById: {}, colorThemesById: {}, ungroupedColorIds: [],
} as unknown as TagTaxonomy;
const SONG = "spotify:track:songWithOthers0";
const others: TaggedByOthersItem = {
  providerId: "songWithOthers0", people: 2, peopleCapped: false, sample: ["ana"],
  tags: [{ label: "House", paths: ["House"], people: 2 }, { label: "Jazz", paths: ["Jazz"], people: 1 }],
};

function Harness(props: Partial<React.ComponentProps<typeof TrackList>>) {
  const filters = useFilterState("tracks");
  return (
    <TrackList
      tracks={{ [SONG]: { name: "What A Wonderful World", artists: "Louis Armstrong", rating: 5, energy: 0, bpm: null, tagIds: [], dateModified: 1 } }}
      taxonomy={taxonomy}
      includeTagClauses={filters.includeTagClauses} clauseConnectors={filters.clauseConnectors} activeTagFilters={filters.activeTagFilters}
      excludedTagFilters={filters.excludedTagFilters} selectedClauseIndex={filters.selectedClauseIndex} activeTrackUri={null}
      onAddIncludeClause={filters.addIncludeClause} onRemoveIncludeClause={filters.removeIncludeClause} onSelectClause={filters.setSelectedClauseIndex}
      onSetIncludeClauseOperator={filters.setIncludeClauseOperator} onSetClauseConnector={filters.setClauseConnector} onRemoveTagFilter={filters.removeTagFilter}
      onToggleTagIncludeOff={filters.toggleTagIncludeOff} onMoveTagToClauseLane={filters.moveTagToClauseLane} onReplaceTagFilterFormula={filters.replaceTagFilterFormula}
      onPlayTrack={vi.fn()} onTagTrack={vi.fn()} onClearTagFilters={filters.clearTagFilters} onCreatePlaylist={vi.fn().mockResolvedValue(null)}
      onCreateSmartPlaylist={vi.fn()} smartPlaylists={[]} onSetSmartPlaylists={vi.fn()} onSyncPlaylist={vi.fn().mockResolvedValue(undefined)}
      onExportSmartPlaylists={vi.fn()} onImportSmartPlaylists={vi.fn()} onAddCommunityTags={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />
  );
}

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
});
beforeEach(() => {
  localStorage.clear();
  // Someone updating from before these features: New marks are for them, not new installations.
  localStorage.setItem("tagify:lastSeenVersion", "3.3.6");
  analytics.record.mockClear();
  community.current = { others: new Map([[SONG, others]]), people: new Map([[SONG, 2]]), available: true, status: "done" };
});

describe("TrackList: the Tagged by others view", () => {
  it("shows only Tagged Tracks and To Tag when the view isn't offered", () => {
    render(<Harness />);
    // To Tag is always there, even with nothing on the list (Alex, 2026-11-23).
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual(["Tagged Tracks", "To Tag"]);
  });

  it("switches between Tagged Tracks and Tagged by others, and remembers the choice", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness taggedByOthersView={<p>Songs others tagged</p>} />);
    expect(screen.getByRole("tab", { name: "Tagged Tracks" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("What A Wonderful World")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Tagged by others/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Songs others tagged");
    // The member's own songs, filters and playlist actions belong to Tagged Tracks.
    expect(screen.queryByText("What A Wonderful World")).toBeNull();
    expect(screen.queryByRole("button", { name: /Create Playlist/ })).toBeNull();
    expect(screen.queryByPlaceholderText("Search tracks...")).toBeNull();

    unmount();
    render(<Harness taggedByOthersView={<p>Songs others tagged</p>} />);
    expect(screen.getByRole("tab", { name: "Tagged by others" })).toHaveAttribute("aria-selected", "true");
  });

  it("doesn't mark the tab New for someone who just installed Tagify", () => {
    localStorage.removeItem("tagify:lastSeenVersion");
    render(<Harness taggedByOthersView={<p>Songs others tagged</p>} />);
    expect(screen.getByRole("tab", { name: "Tagged by others" })).toBeInTheDocument();
  });

  it("marks the tab New for connected members until they first open it", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness taggedByOthersView={<p>Songs others tagged</p>} />);
    expect(screen.getByRole("tab", { name: "Tagged by others New" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Tagged by others/ }));
    expect(screen.getByRole("tab", { name: "Tagged by others" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Tagged Tracks" }));
    unmount();
    render(<Harness taggedByOthersView={<p>Songs others tagged</p>} />);
    expect(screen.getByRole("tab", { name: "Tagged by others" })).toBeInTheDocument();
  });

  it("doesn't mark the tab for a computer that isn't connected", () => {
    community.current = { others: new Map(), people: new Map(), available: false, status: "off" };
    render(<Harness taggedByOthersView={<p>Songs others tagged</p>} />);
    expect(screen.getByRole("tab", { name: "Tagged by others" })).toBeInTheDocument();
  });

  it("always shows Tagged Tracks for a list opened from Stats", () => {
    localStorage.setItem("tagify:trackListView", "others");
    render(<Harness taggedByOthersView={<p>Songs others tagged</p>} statsTrackSet={{ id: 1, label: "Five stars", trackUris: [SONG] }} />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("What A Wonderful World")).toBeInTheDocument();
  });
});

describe("TrackList: \"N others\" for a member who doesn't share their tags", () => {
  it("still shows the first tags, and opening it asks them to share instead of showing every tag", async () => {
    const user = userEvent.setup();
    const onShareTags = vi.fn();
    render(<Harness othersTagsLocked onShareTags={onShareTags} />);

    const toggle = screen.getByRole("button", { name: /2 others/ });
    expect(toggle).toHaveTextContent("House");
    await user.click(toggle);
    expect(screen.getByRole("group", { name: "Other members' tags" })).toHaveTextContent("Share your tags on Community to see every tag");
    expect(screen.queryByRole("button", { name: /^Add Jazz/ })).toBeNull();
    expect(entity.lookup).not.toHaveBeenCalled();
    expect(analytics.record).not.toHaveBeenCalledWith("track_list_others_opened");

    await user.click(screen.getByRole("button", { name: "Share my tags" }));
    expect(onShareTags).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("group", { name: "Other members' tags" })).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("TrackList: others' tags for someone who isn't connected", () => {
  const teaser = (onConnect = vi.fn()) => ({ others: new Map([[SONG, { ...others, sample: [] }]]), onConnect });
  beforeEach(() => {
    community.current = { others: new Map(), people: new Map(), available: false, status: "off" };
  });

  it("shows nothing while the communityTeasers switch is off", () => {
    localStorage.setItem("tagify:switch:communityTeasers", "off");
    render(<Harness communityTeaser={teaser()} />);
    expect(screen.queryByRole("button", { name: /2 others/ })).toBeNull();
  });

  it("shows the chip, and opening it asks them to connect", async () => {
    localStorage.setItem("tagify:switch:communityTeasers", "on");
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(<Harness communityTeaser={teaser(onConnect)} />);
    const toggle = screen.getByRole("button", { name: /2 others/ });
    expect(toggle).toHaveTextContent("House");
    expect(toggle.getAttribute("title")).not.toContain("@");
    await user.click(toggle);
    expect(screen.getByRole("group", { name: "Other members' tags" })).toHaveTextContent("Create a free Tagify account or sign in to add the tags others gave this song.");
    await user.click(screen.getByRole("button", { name: "Create account or sign in" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(analytics.record).not.toHaveBeenCalledWith("track_list_others_opened");
  });
});

describe("TrackList: a song row", () => {
  it("locks the song in the editor when the row is clicked, without Tag or Play buttons on the side", async () => {
    const user = userEvent.setup();
    const onTagTrack = vi.fn();
    const onPlayTrack = vi.fn();
    vi.stubGlobal("Spicetify", { Player: { data: null, isPlaying: () => false, addEventListener: vi.fn(), removeEventListener: vi.fn(), togglePlay: vi.fn() } });
    render(<Harness onTagTrack={onTagTrack} onPlayTrack={onPlayTrack} />);

    expect(screen.queryByRole("button", { name: /^(Tag|Tagging)$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Play$/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Play What A Wonderful World" }));
    expect(onPlayTrack).toHaveBeenCalledWith(SONG);
    expect(onTagTrack).not.toHaveBeenCalled();

    await user.click(screen.getByText("Louis Armstrong").closest("[aria-label='Edit What A Wonderful World']")!.querySelector("[class*='trackItemMetaContainer']")!);
    expect(onTagTrack).toHaveBeenCalledWith(SONG);
  });

  it("locks the song from the keyboard, and marks the song already locked", async () => {
    const user = userEvent.setup();
    const onTagTrack = vi.fn();
    const { rerender } = render(<Harness onTagTrack={onTagTrack} />);
    screen.getByLabelText("Edit What A Wonderful World").focus();
    await user.keyboard("{Enter}");
    expect(onTagTrack).toHaveBeenCalledWith(SONG);

    rerender(<Harness onTagTrack={onTagTrack} activeTrackUri={SONG} />);
    expect(screen.queryByLabelText("Edit What A Wonderful World")).toBeNull();
    expect(document.getElementById(`track-item-${SONG}`)).toHaveAttribute("aria-current", "true");
  });
});
