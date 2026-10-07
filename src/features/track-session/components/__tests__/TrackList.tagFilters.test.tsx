import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { useFilterState } from "@/features/filter-state";
import { usePlaylistState } from "@/features/playlist-state";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
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

interface TrackListHarnessProps {
  smartPlaylists?: SmartPlaylistCriteria[];
  requestedSmartPlaylistEditId?: string | null;
  onSmartPlaylistEditRequestHandled?: () => void;
  useRealPlaylistCreation?: boolean;
  onCreateSmartPlaylist?: (criteria: SmartPlaylistCriteria) => Promise<void>;
  onSetSmartPlaylists?: (value: React.SetStateAction<SmartPlaylistCriteria[]>) => Promise<void>;
  onSyncPlaylist?: (criteria: SmartPlaylistCriteria) => Promise<void>;
}

function TrackListHarness({
  smartPlaylists = [],
  requestedSmartPlaylistEditId = null,
  onSmartPlaylistEditRequestHandled,
  useRealPlaylistCreation = false,
  onCreateSmartPlaylist = vi.fn(),
  onSetSmartPlaylists = vi.fn(),
  onSyncPlaylist = vi.fn().mockResolvedValue(undefined),
}: TrackListHarnessProps = {}) {
  const filters = useFilterState("tracks");
  const { createPlaylistFromFilters } = usePlaylistState();

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
      onCreatePlaylist={useRealPlaylistCreation ? createPlaylistFromFilters : vi.fn().mockResolvedValue(null)}
      onCreateSmartPlaylist={onCreateSmartPlaylist}
      smartPlaylists={smartPlaylists}
      onSetSmartPlaylists={onSetSmartPlaylists}
      onSyncPlaylist={onSyncPlaylist}
      onExportSmartPlaylists={vi.fn()}
      onImportSmartPlaylists={vi.fn()}
      requestedSmartPlaylistEditId={requestedSmartPlaylistEditId}
      onSmartPlaylistEditRequestHandled={onSmartPlaylistEditRequestHandled}
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

  it("saves a new smart-playlist rule before opening its Spotify playlist", async () => {
    const user = userEvent.setup();
    const historyPush = vi.spyOn(Spicetify.Platform.History, "push");
    const createSpotifyPlaylist = vi.spyOn(Spicetify.Platform.RootlistAPI as any, "createPlaylist")
      .mockResolvedValue("spotify:playlist:new-smart-playlist");
    const addSpotifyTracks = vi.spyOn(Spicetify.Platform.PlaylistAPI as any, "add")
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
