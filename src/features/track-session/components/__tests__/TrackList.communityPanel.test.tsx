import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilterState } from "@/features/filter-state";
import { TagTaxonomy } from "@/types/tagData";
import type { TaggedByOthersItem } from "@/features/community/taggedByOthers/taggedByOthersScan";
import type { TrackListCommunity } from "@/features/track-session/hooks/useTrackListCommunity";
import type { CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import TrackList from "../TrackList";

const community = vi.hoisted(() => ({ current: null as unknown as TrackListCommunity }));
vi.mock("@/features/track-session/hooks/useTrackListCommunity", () => ({
  useTrackListCommunity: () => community.current,
}));

const entity = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("@/features/community/communityEntityCache", () => ({
  lookupCommunityEntity: entity.lookup,
  peekCommunityEntity: () => undefined,
}));

const analytics = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: analytics.record,
}));

vi.mock("@/services/sync/SyncLocalState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sync/SyncLocalState")>()),
  getDesktopSyncConfiguration: () => ({ profile: { handle: "me" } }),
}));

const taxonomy: TagTaxonomy = {
  categoryOrder: ["genre"],
  categoriesById: { genre: { id: "genre", name: "Genre", subcategoryIds: ["style"] } },
  subcategoriesById: { style: { id: "style", name: "Style", categoryId: "genre", tagIds: ["house", "jazz"] } },
  tagsById: {
    house: { id: "house", name: "House", subcategoryId: "style", accentId: null },
    jazz: { id: "jazz", name: "Jazz", subcategoryId: "style", accentId: null },
  },
  customAccentsById: {},
  colorThemesById: {},
  ungroupedColorIds: [],
};

const SONG = "spotify:track:songWithOthers0";
const tag = (label: string, people: number, path = `Mood / ${label}`): CommunityMatchTag => ({ label, paths: [path], people });
const others: TaggedByOthersItem = {
  providerId: "songWithOthers0", people: 2, peopleCapped: false, sample: ["ana", "sam"],
  tags: [tag("House", 2, "Genre / Style / House"), tag("Jazz", 2, "Genre / Style / Jazz"), tag("Night", 1, "Mood / Time / Night")],
};

function Harness({ onAddCommunityTags }: { onAddCommunityTags?: (uri: string, tags: CommunityMatchTag[]) => Promise<void> }) {
  const filters = useFilterState("tracks");
  return (
    <TrackList
      tracks={{ [SONG]: { name: "What A Wonderful World", artists: "Louis Armstrong", rating: 5, energy: 0, bpm: null, tagIds: ["house"], dateModified: 1 } }}
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
      onAddCommunityTags={onAddCommunityTags}
    />
  );
}

function setCommunity(available: boolean) {
  const map = new Map(available ? [[SONG, others]] : []);
  community.current = { others: map, people: new Map([...map].map(([uri, item]) => [uri, item.people])), available, status: available ? "done" : "off" };
}

describe("TrackList: other members' tags on a row", () => {
  beforeAll(() => {
    vi.stubGlobal("IntersectionObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  });

  beforeEach(() => {
    localStorage.clear();
    analytics.record.mockClear();
    setCommunity(true);
    entity.lookup.mockResolvedValue({
      found: true,
      entity: {
        contributors: [
          { handle: "ana", displayName: "Ana", ratingHalfStars: 9, tags: [{ label: "House", path: "Genre / Style / House" }, { label: "Night", path: "Mood / Time / Night" }], isFollowing: false },
          { handle: "sam", displayName: "Sam", ratingHalfStars: 10, tags: [{ label: "Jazz", path: "Genre / Style / Jazz" }], isFollowing: false },
          { handle: "me", displayName: "Me", ratingHalfStars: 2, tags: [{ label: "Mine", path: "Mine" }], isFollowing: false },
        ],
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens from the count, shows who rated it, and adds a tag to the song", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<Harness onAddCommunityTags={onAdd} />);

    const toggle = screen.getByRole("button", { name: /2 others/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(analytics.record).toHaveBeenCalledWith("track_list_others_opened");

    const panel = await screen.findByRole("region", { name: "Other members' tags on What A Wonderful World" });
    expect(entity.lookup).toHaveBeenCalledWith("track", "songWithOthers0");
    // Ana rated 4.5 and Sam 5; the member's own contribution is left out.
    expect(await within(panel).findByText("@ana")).toBeInTheDocument();
    expect(within(panel).getByText("@sam")).toBeInTheDocument();
    expect(within(panel).queryByText("@me")).not.toBeInTheDocument();
    expect(within(panel).getByText(/4\.8 average · 2 ratings/)).toBeInTheDocument();

    // The song already has House; Night isn't in the library yet, so it's marked new.
    expect(within(panel).getByRole("button", { name: "House added to What A Wonderful World" })).toBeDisabled();
    const night = within(panel).getByRole("button", { name: "Add Night to What A Wonderful World" });
    expect(within(panel).getByRole("button", { name: "See music tagged Night on tagify.fm" })).toHaveTextContent("new");
    // The library has no Mood category, so Night would go in From Community.
    expect(night).toHaveAttribute("title", expect.stringContaining("goes in From Community"));

    await user.click(within(panel).getByRole("button", { name: "Add Jazz to What A Wonderful World" }));
    expect(onAdd).toHaveBeenCalledWith(SONG, [others.tags[1]]);
    // Jazz is already in the library; Night isn't.
    expect(analytics.record).toHaveBeenCalledWith("track_list_members_tag_added", { members_add: "tag", new_to_library: "no" });
    expect(within(panel).getByRole("button", { name: "Jazz added to What A Wonderful World" })).toBeDisabled();

    // Tags are added one at a time; there's no Add all.
    expect(within(panel).queryByRole("button", { name: /Add all|All added/ })).not.toBeInTheDocument();
    await user.click(night);
    expect(onAdd).toHaveBeenLastCalledWith(SONG, [others.tags[2]]);
    expect(analytics.record).toHaveBeenLastCalledWith("track_list_members_tag_added", { members_add: "tag", new_to_library: "yes" });
    expect(within(panel).getByRole("button", { name: "Night added to What A Wonderful World" })).toBeDisabled();

    // The name opens the tag's page instead of adding it.
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    onAdd.mockClear();
    await user.click(within(panel).getByRole("button", { name: "See music tagged Jazz on tagify.fm" }));
    expect(open).toHaveBeenCalledWith("https://tagify.fm/tags/jazz", "_blank", "noopener,noreferrer");
    expect(analytics.record).toHaveBeenLastCalledWith("track_list_community_link_opened", { target: "tag" });
    expect(onAdd).not.toHaveBeenCalled();
    open.mockRestore();

    analytics.record.mockClear();
    await user.click(toggle);
    expect(screen.queryByRole("region", { name: /Other members' tags/ })).not.toBeInTheDocument();
    // Closing isn't counted as opening.
    expect(analytics.record).not.toHaveBeenCalled();
  });

  it("opens the song and each member on Community", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<Harness onAddCommunityTags={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /2 others/ }));
    const panel = await screen.findByRole("region", { name: /Other members' tags/ });

    await user.click(within(panel).getByRole("button", { name: /Open on Community/ }));
    expect(open).toHaveBeenLastCalledWith("https://tagify.fm/entity/track/songWithOthers0", "_blank", "noopener,noreferrer");
    expect(analytics.record).toHaveBeenLastCalledWith("track_list_community_link_opened", { target: "song" });
    await user.click(await within(panel).findByRole("button", { name: "@sam" }));
    expect(open).toHaveBeenLastCalledWith("https://tagify.fm/@sam", "_blank", "noopener,noreferrer");
    expect(analytics.record).toHaveBeenLastCalledWith("track_list_community_link_opened", { target: "member" });
  });

  it("keeps the tags when Community can't say who rated it, and shows an add that failed", async () => {
    entity.lookup.mockResolvedValue({ found: false, entity: null, unavailable: true });
    const user = userEvent.setup();
    render(<Harness onAddCommunityTags={vi.fn().mockRejectedValue(new Error("Your account changed. Reopen your music before adding tags."))} />);
    await user.click(screen.getByRole("button", { name: /2 others/ }));
    const panel = await screen.findByRole("region", { name: /Other members' tags/ });

    expect(await within(panel).findByText(/Community can't be reached right now\. Tagged by @ana, @sam/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Add Jazz to What A Wonderful World" }));
    expect(analytics.record).not.toHaveBeenCalledWith("track_list_members_tag_added", expect.anything());
    expect(within(panel).getByRole("alert")).toHaveTextContent("Your account changed. Reopen your music before adding tags.");
    expect(within(panel).getByRole("button", { name: "Add Jazz to What A Wonderful World" })).toBeEnabled();
  });
});

describe("TrackList: the sort dropdown's one-time highlight", () => {
  beforeAll(() => {
    vi.stubGlobal("IntersectionObserver", class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  });

  beforeEach(() => {
    localStorage.clear();
    // Someone updating from before these features: New marks are for them, not new installations.
    localStorage.setItem("tagify:lastSeenVersion", "3.3.6");
    analytics.record.mockClear();
  });

  it("points out the new sort until the member picks a sort, then never again", async () => {
    setCommunity(true);
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    expect(screen.getByRole("option", { name: "Most tagged by others (new)" })).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();

    await user.selectOptions(screen.getByDisplayValue("Last updated"), "communityPeople");
    expect(analytics.record).toHaveBeenCalledWith("track_list_sort_changed", { sort: "community_people", after_highlight: "yes" });
    expect(screen.getByRole("option", { name: "Most tagged by others" })).toBeInTheDocument();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(localStorage.getItem("tagify:new-feature-seen:track-list-sort-community-people")).not.toBeNull();

    unmount();
    render(<Harness />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByDisplayValue("Most tagged by others"), "dateModified");
    await user.selectOptions(screen.getByDisplayValue("Last updated"), "communityPeople");
    expect(analytics.record).toHaveBeenLastCalledWith("track_list_sort_changed", { sort: "community_people", after_highlight: "no" });
  });

  it("isn't shown on a computer that isn't connected to Community", () => {
    setCommunity(false);
    render(<Harness />);
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Most tagged by others/ })).not.toBeInTheDocument();
  });
});
