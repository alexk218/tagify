import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useFilterState } from "@/features/filter-state";
import { usePlaylistState } from "@/features/playlist-state";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
import { TagTaxonomy } from "@/types/tagData";
import TrackList from "../TrackList";
import type { TrackListTrackData } from "@/features/track-session/model/trackList.types";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { emptyPrivateNote } from "@/services/sync/PrivateNotes";
import { setAdvancedFilters } from "@/features/filter-state/advancedFiltersSetting";

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

interface TrackListHarnessProps {
  tracks?: Record<string, TrackListTrackData>;
  smartPlaylists?: SmartPlaylistCriteria[];
  requestedSmartPlaylistEditId?: string | null;
  onSmartPlaylistEditRequestHandled?: () => void;
  useRealPlaylistCreation?: boolean;
  onCreateSmartPlaylist?: (criteria: SmartPlaylistCriteria) => Promise<void>;
  onSetSmartPlaylists?: (value: React.SetStateAction<SmartPlaylistCriteria[]>) => Promise<void>;
  onSyncPlaylist?: (criteria: SmartPlaylistCriteria) => Promise<void>;
  onTagTrack?: (uri: string) => void;
  statsTrackSet?: { id: number; label: string; trackUris: string[]; reveal?: "list" | "track" } | null;
  onClearStatsTrackSet?: () => void;
  onReturnToStats?: () => void;
}

function TrackListHarness({
  tracks,
  smartPlaylists = [],
  requestedSmartPlaylistEditId = null,
  onSmartPlaylistEditRequestHandled,
  useRealPlaylistCreation = false,
  onCreateSmartPlaylist = vi.fn(),
  onSetSmartPlaylists = vi.fn(),
  onSyncPlaylist = vi.fn().mockResolvedValue(undefined),
  onTagTrack = vi.fn(),
  statsTrackSet = null,
  onClearStatsTrackSet = vi.fn(),
  onReturnToStats = vi.fn(),
}: TrackListHarnessProps = {}) {
  const filters = useFilterState("tracks");
  const { createPlaylistFromFilters } = usePlaylistState();

  return (
    <TrackList
      tracks={tracks || {
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
      onTagTrack={onTagTrack}
      onClearTagFilters={filters.clearTagFilters}
      onCreatePlaylist={useRealPlaylistCreation ? createPlaylistFromFilters : vi.fn().mockResolvedValue(null)}
      onCreateSmartPlaylist={onCreateSmartPlaylist}
      smartPlaylists={smartPlaylists}
      onSetSmartPlaylists={onSetSmartPlaylists}
      onSyncPlaylist={onSyncPlaylist}
      onExportSmartPlaylists={vi.fn()}
      onImportSmartPlaylists={vi.fn()}
      requestedSmartPlaylistEditId={requestedSmartPlaylistEditId}
      onSmartPlaylistEditRequestHandled={onSmartPlaylistEditRequestHandled}
      statsTrackSet={statsTrackSet}
      onClearStatsTrackSet={onClearStatsTrackSet}
      onReturnToStats={onReturnToStats}
    />
  );
}

describe("TrackList tag filtering", () => {
  it("shows exactly the tracks opened from Stats, as their own list with a clear way out", async () => {
    const user = userEvent.setup();
    const onReturnToStats = vi.fn(), onClearStatsTrackSet = vi.fn();
    const { rerender } = render(<TrackListHarness />);
    await user.type(screen.getByPlaceholderText("Search tracks..."), "Chill");
    expect(screen.queryByText("House Track")).not.toBeInTheDocument();

    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    rerender(<TrackListHarness statsTrackSet={{ id: 1, label: "Tagged House", trackUris: ["spotify:track:house"] }}
      onReturnToStats={onReturnToStats} onClearStatsTrackSet={onClearStatsTrackSet} />);
    const title = screen.getByRole("heading", { name: "Tagged House" });
    // The list comes into view and takes focus, so it's clear where the tracks went.
    await waitFor(() => expect(title).toHaveFocus());
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0]).toBe(title.closest("div[class*='container']"));
    scroll.mockRestore();
    expect(await screen.findByText("House Track")).toBeInTheDocument();
    expect(screen.queryByText("Chill Track")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search tracks...")).toHaveValue("");
    expect(screen.getByText("1 track")).toBeInTheDocument();
    // The list is the filter: no filter or smart playlist controls compete with it.
    expect(screen.queryByRole("button", { name: /^Filters/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/^Smart Playlists/)).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search tracks..."), "Nothing");
    expect(screen.getByText("0 of 1 tracks")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to Stats" }));
    expect(onReturnToStats).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Show all tracks" }));
    expect(onClearStatsTrackSet).toHaveBeenCalledTimes(1);

    rerender(<TrackListHarness />);
    expect(screen.getByRole("tab", { name: "Tagged Tracks" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByPlaceholderText("Search tracks...")).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Filters/ })).toBeInTheDocument();
  });

  it("leaves the view on the song when a song was opened from Stats", async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(<TrackListHarness statsTrackSet={{ id: 2, label: "Tagged House", trackUris: ["spotify:track:house"], reveal: "track" }} />);
    expect(await screen.findByText("House Track")).toBeInTheDocument();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Tagged House" })).not.toHaveFocus();
    scroll.mockRestore();
  });

  it("keeps notes on every release accessible from a single confirmed song row", async () => {
    const first = `spotify:track:${"a".repeat(22)}`, second = `spotify:track:${"b".repeat(22)}`;
    const recordingIdentity = { isrc: "USABC2400001", artistIds: ["c".repeat(22)], durationMs: 210000, name: "Shared Song" };
    const data = { name: "Shared Song", artists: "Artist", rating: 5, energy: 8, bpm: 120, tagIds: ["house"], recordingGroupId: "copies", recordingIdentity };
    const read = vi.spyOn(indexedDBStorage, "getPrivateNotesForUris").mockImplementation(async uris =>
      uris.map(uri => ({ ...emptyPrivateNote(uri), text: uri === second ? "Note on the compilation" : "Note on the original" })));
    const onTagTrack = vi.fn();
    try {
      render(<TrackListHarness tracks={{ [first]: data, [second]: data }} onTagTrack={onTagTrack} />);
      await screen.findByText("Note on the compilation");
      expect(screen.getAllByText("Shared Song")).toHaveLength(1);
      expect(read.mock.calls.at(-1)?.[0]).toEqual([first, second]);
      await userEvent.setup().click(screen.getByText("Note on the compilation"));
      expect(onTagTrack).toHaveBeenLastCalledWith(second);
      await userEvent.setup().click(screen.getByText("Note on the original"));
      expect(onTagTrack).toHaveBeenLastCalledWith(first);
    } finally { read.mockRestore(); }
  });
  it("shows a compact private note, hides whitespace notes, and opens the existing track editor", async () => {
    const text = "Build slowly.\nDrop comes after the long intro. ".repeat(40);
    const read = vi.spyOn(indexedDBStorage, "getPrivateNotesForUris").mockResolvedValue([
      { ...emptyPrivateNote("spotify:track:house"), text },
      { ...emptyPrivateNote("spotify:track:chill"), text: " \n " },
    ]);
    const onTagTrack = vi.fn();
    try {
      render(<TrackListHarness onTagTrack={onTagTrack} />);
      const preview = await screen.findByRole("button", { name: "Open private note for House Track" });
      expect(preview).toHaveAttribute("title", `Your private note\n${text}`);
      expect(preview.textContent).not.toContain("\n");
      expect(screen.queryByRole("button", { name: "Open private note for Chill Track" })).not.toBeInTheDocument();
      await userEvent.setup().click(preview);
      expect(onTagTrack).toHaveBeenCalledWith("spotify:track:house");
    } finally { read.mockRestore(); }
  });
  beforeAll(() => {
    class IntersectionObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }

    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  });

  it("saves a new smart-playlist rule before opening its Spotify playlist", async () => {
    const user = userEvent.setup();
    const historyPush = vi.spyOn(Spicetify.Platform.History, "push");
    const createSpotifyPlaylist = vi.spyOn(Spicetify.Platform.RootlistAPI as unknown as { createPlaylist: (...args: unknown[]) => Promise<string> }, "createPlaylist")
      .mockResolvedValue("spotify:playlist:new-smart-playlist");
    const addSpotifyTracks = vi.spyOn(Spicetify.Platform.PlaylistAPI as unknown as { add: (...args: unknown[]) => Promise<void> }, "add")
      .mockResolvedValue(undefined);
    let finishSavingRule!: () => void;
    const savingRule = new Promise<void>((resolve) => { finishSavingRule = resolve; });
    const onCreateSmartPlaylist = vi.fn().mockReturnValue(savingRule);

    try {
      render(<TrackListHarness useRealPlaylistCreation onCreateSmartPlaylist={onCreateSmartPlaylist} />);
      await user.click(screen.getByRole("button", { name: /^Filters/ }));
      await user.click(screen.getByRole("button", { name: "House" }));
      await waitFor(() => expect(screen.getByText("House Track")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Create Playlist" }));
      await screen.findByRole("heading", { name: "Create Playlist" });
      await user.click(screen.getByLabelText(/Smart playlist/i));
      await user.click(screen.getAllByRole("button", { name: "Create Playlist" })[1]);

      await waitFor(() => expect(onCreateSmartPlaylist).toHaveBeenCalledTimes(1));
      expect(createSpotifyPlaylist).toHaveBeenCalledTimes(1);
      // "Public playlist" is unticked, so the new playlist is made private.
      expect((Spicetify.Platform as unknown as { PlaylistPermissionsAPI: { setBasePermission: unknown } }).PlaylistPermissionsAPI.setBasePermission).toHaveBeenCalledWith("spotify:playlist:new-smart-playlist", "BLOCKED");
      expect(addSpotifyTracks).toHaveBeenCalledTimes(1);
      expect(historyPush).not.toHaveBeenCalled();

      finishSavingRule();
      await waitFor(() => expect(historyPush).toHaveBeenCalledWith("/playlist/new-smart-playlist"));
    } finally {
      historyPush.mockRestore();
      createSpotifyPlaylist.mockRestore();
      addSpotifyTracks.mockRestore();
    }
  });

  it("filters by a whole category from the menu next to the tag search", async () => {
    const user = userEvent.setup();
    render(<TrackListHarness tracks={{
      "spotify:track:house": { name: "House Track", artists: "A", rating: 5, energy: 8, bpm: 124, tagIds: ["house"] },
      "spotify:track:plain": { name: "Plain Track", artists: "B", rating: 3, energy: 0, bpm: 90, tagIds: [] },
    }} />);
    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    const menu = screen.getByRole("combobox", { name: "Filter by category" });
    const option = (label: string) => within(menu).getAllByRole("option").find((node) => node.textContent?.trim() === label) as HTMLOptionElement;

    await user.selectOptions(menu, option("No Genre"));
    expect(await screen.findByText("Plain Track")).toBeInTheDocument();
    expect(screen.queryByText("House Track")).not.toBeInTheDocument();
    expect(menu).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /Clear/i }));
    await user.selectOptions(menu, option("Any Genre"));
    expect(await screen.findByText("House Track")).toBeInTheDocument();
    expect(screen.queryByText("Plain Track")).not.toBeInTheDocument();
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
    // With nothing applied, the applied-filters row is gone.
    expect(screen.queryByLabelText("Applied tag filters")).not.toBeInTheDocument();
  });

  it("has no Basic/Complex switch or Advanced button; Settings decides", async () => {
    const user = userEvent.setup();
    render(<TrackListHarness />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    expect(screen.queryByRole("button", { name: "Complex" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Advanced" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Group" })).not.toBeInTheDocument();
    expect(screen.queryByText("Camelot Keys")).not.toBeInTheDocument();

    act(() => setAdvancedFilters(true));
    expect(screen.getByRole("button", { name: "Add Group" })).toBeInTheDocument();
    expect(screen.getByText("Camelot Keys")).toBeInTheDocument();
  });

  it("keeps a saved multi-group formula applied when advanced filters are off", async () => {
    const user = userEvent.setup();
    setAdvancedFilters(true);
    render(<TrackListHarness />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    await user.click(screen.getByRole("button", { name: "Start Filtering" }));
    await user.click(screen.getByRole("button", { name: "House" }));
    await user.click(screen.getByRole("button", { name: "Add Group" }));
    await user.click(screen.getByRole("button", { name: "Chill" }));

    act(() => setAdvancedFilters(false));
    expect(screen.getByText(/These tag filters use groups/)).toBeInTheDocument();
    expect(screen.queryByText("House Track")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Turn on advanced filters" }));
    expect(screen.getByRole("button", { name: "Add Group" })).toBeInTheDocument();
  });

  it("uses the same click cycle inside a complex filter group", async () => {
    const user = userEvent.setup();
    setAdvancedFilters(true);
    render(<TrackListHarness />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    await user.click(screen.getByRole("button", { name: "Start Filtering" }));

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

  it("adds a tag that is already in another group to the selected group too", async () => {
    const user = userEvent.setup();
    setAdvancedFilters(true);
    render(<TrackListHarness />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    await user.click(screen.getByRole("button", { name: "Start Filtering" }));
    await user.click(screen.getByRole("button", { name: "House" }));
    await user.click(screen.getByRole("button", { name: "Add Group" }));
    await user.click(screen.getByRole("button", { name: "Chill" }));
    await user.click(screen.getByRole("button", { name: "G1 MATCH House" }));

    // Group 2 is selected: House is in it now, and still in group 1.
    expect(screen.getByRole("button", { name: "MATCH House" })).toBeInTheDocument();
    const groupTwoApplied = screen.getByLabelText("Applied tag filters");
    expect(
      within(groupTwoApplied).getByRole("button", { name: "MATCH House applied filter" }),
    ).toBeInTheDocument();
    // House AND (Chill OR House): only the House song matches.
    expect(screen.getByText("House Track")).toBeInTheDocument();
    expect(screen.queryByText("Chill Track")).not.toBeInTheDocument();

    // Removing House from group 2 leaves it in group 1.
    await user.click(
      within(groupTwoApplied).getByRole("button", { name: "MATCH House applied filter" }),
    );
    expect(screen.getByRole("button", { name: "G1 MATCH House" })).toBeInTheDocument();
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

  it("opens a prominent edit state from a playlist indicator request", async () => {
    const onRequestHandled = vi.fn();
    const smartPlaylist: SmartPlaylistCriteria = {
      playlistId: "smart-house",
      playlistName: "Smart House",
      criteria: {
        includeTagClauses: [
          {
            tagIds: ["house"],
            excludedTagIds: [],
            operator: "OR",
          },
        ],
        clauseConnectors: [],
        ratingFilters: [5],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
        camelotKeyFilters: [],
      },
      isActive: true,
      createdAt: 1,
      lastSyncAt: 1,
      smartPlaylistTrackUris: ["spotify:track:house"],
    };

    render(
      <TrackListHarness
        smartPlaylists={[smartPlaylist]}
        requestedSmartPlaylistEditId={smartPlaylist.playlistId}
        onSmartPlaylistEditRequestHandled={onRequestHandled}
      />,
    );

    expect(
      await screen.findByRole("status", { name: "Editing Smart House" }),
    ).toHaveTextContent("Editing Smart House");
    expect(
      screen.getByRole("button", { name: "Save Smart Playlist" }),
    ).toHaveAttribute("title", "Save filters to Smart House");
    expect(screen.getByRole("button", { name: "MATCH House" })).toBeEnabled();
    expect(onRequestHandled).toHaveBeenCalledTimes(1);
  });

  it("waits for edited smart-playlist rules to save before syncing", async () => {
    const user = userEvent.setup();
    const smartPlaylist: SmartPlaylistCriteria = {
      playlistId: "smart-house",
      playlistName: "Smart House",
      criteria: {
        includeTagClauses: [{ tagIds: ["house"], excludedTagIds: [], operator: "OR" }],
        clauseConnectors: [],
        ratingFilters: [],
        energyMinFilter: null,
        energyMaxFilter: null,
        bpmMinFilter: null,
        bpmMaxFilter: null,
      },
      isActive: true,
      createdAt: 1,
      lastSyncAt: 1,
      smartPlaylistTrackUris: [],
    };
    let finishSaving!: () => void;
    const saving = new Promise<void>((resolve) => { finishSaving = resolve; });
    const onSetSmartPlaylists = vi.fn().mockReturnValue(saving);
    const onSyncPlaylist = vi.fn().mockResolvedValue(undefined);

    render(<TrackListHarness
      smartPlaylists={[smartPlaylist]}
      requestedSmartPlaylistEditId={smartPlaylist.playlistId}
      onSetSmartPlaylists={onSetSmartPlaylists}
      onSyncPlaylist={onSyncPlaylist}
    />);
    await user.click(await screen.findByRole("button", { name: "Save Smart Playlist" }));
    await user.click(screen.getByRole("button", { name: "Save Filter Changes" }));
    await waitFor(() => expect(onSetSmartPlaylists).toHaveBeenCalledTimes(1));
    expect(onSyncPlaylist).not.toHaveBeenCalled();
    finishSaving();
    await waitFor(() => expect(onSyncPlaylist).toHaveBeenCalledWith(expect.objectContaining({
      playlistId: "smart-house",
    })));
  });
});
