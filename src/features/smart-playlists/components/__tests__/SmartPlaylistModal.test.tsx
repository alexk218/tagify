import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SmartPlaylistModal, {
  SMART_PLAYLIST_MOBILE_TAGGING_INTRO_KEY,
} from "@/features/smart-playlists/components/SmartPlaylistModal";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { TagCategory } from "@/types/tagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { storageService } from "@/services/storage/StorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { markConfirmedMembershipBaselines, clearConfirmedMembershipBaselines } from "../../utils/smartPlaylist.storage";
import React, { act } from "react";
import {
  buildTaxonomyFromCategoryTree,
  createLegacyTagIdentityId,
} from "@/utils/tagTaxonomy";

const { history } = vi.hoisted(() => ({ history: {
  ready: true, mobileTaggingIntroSeen: true, markSeen: vi.fn(),
} }));
vi.mock("@/features/onboarding/hooks/usePromptHistory", () => ({ usePromptHistory: () => history }));

const mockTagCategories: TagCategory[] = [
  {
    id: "genre",
    name: "Genre",
    subcategories: [
      {
        id: "electronic",
        name: "Electronic",
        tags: [
          { id: "house", name: "House", accentId: "blue" },
          { id: "techno", name: "Techno", accentId: null },
        ],
      },
    ],
  },
  {
    id: "mood",
    name: "Mood",
    subcategories: [
      {
        id: "energy",
        name: "Energy",
        tags: [
          { id: "uplifting", name: "Uplifting", accentId: null },
          { id: "chill", name: "Chill", accentId: null },
        ],
      },
    ],
  },
];

const HOUSE_TAG_ID = createLegacyTagIdentityId("genre", "electronic", "house");
const TECHNO_TAG_ID = createLegacyTagIdentityId("genre", "electronic", "techno");
const CHILL_TAG_ID = createLegacyTagIdentityId("mood", "energy", "chill");
const mockTaxonomy = buildTaxonomyFromCategoryTree(mockTagCategories);

const mockSmartPlaylists: SmartPlaylistCriteria[] = [
  {
    playlistId: "playlist1",
    playlistName: "Electronic House Mix",
    isActive: true,
    smartPlaylistTrackUris: ["spotify:track:123", "spotify:track:456"],
    lastSyncAt: Date.now(),
    criteria: {
      includeTagClauses: [
        {
          tagIds: [HOUSE_TAG_ID],
          excludedTagIds: [],
          operator: "OR",
        },
      ],
      clauseConnectors: [],
      ratingFilters: [4, 5],
      energyMinFilter: 6,
      energyMaxFilter: null,
      bpmMinFilter: 120,
      bpmMaxFilter: 130,
    },
    createdAt: 0,
  },
  {
    playlistId: "playlist2",
    playlistName: "Chill Vibes",
    isActive: false,
    smartPlaylistTrackUris: [],
    lastSyncAt: Date.now(),
    criteria: {
      includeTagClauses: [
        {
          tagIds: [CHILL_TAG_ID],
          excludedTagIds: [],
          operator: "OR",
        },
      ],
      clauseConnectors: [],
      ratingFilters: [],
      energyMinFilter: null,
      energyMaxFilter: 5,
      bpmMinFilter: null,
      bpmMaxFilter: null,
    },
    createdAt: 0,
  },
];

describe("SmartPlaylistModal", () => {
  afterEach(() => { vi.restoreAllMocks(); clearConfirmedMembershipBaselines(); });
  const mockOnUpdateSmartPlaylists = vi.fn();
  const mockOnEditPlaylist = vi.fn();
  const mockOnSyncPlaylist = vi.fn();
  const mockOnExportSmartPlaylists = vi.fn();
  const mockOnImportSmartPlaylists = vi.fn().mockResolvedValue({
    importedCount: 2,
    relinkedCount: 0,
    unresolvedCount: 0,
    verificationUnavailable: false,
  });
  const mockOnClose = vi.fn();

  beforeEach(() => {
    history.ready = true;
    history.mobileTaggingIntroSeen = true;
    history.markSeen.mockImplementation(() => { history.mobileTaggingIntroSeen = true; });
    vi.clearAllMocks();
    localStorage.setItem(SMART_PLAYLIST_MOBILE_TAGGING_INTRO_KEY, "seen");

    // Mock playlist metadata sync API used by the modal.
    (global.Spicetify.Platform as any).PlaylistAPI = {
      getMetadata: vi.fn().mockResolvedValue({
        name: "Electronic House Mix",
        description: "Test description",
      }),
    };

    vi.spyOn(spotifyApiService, "getPlaylistTrackCounts").mockResolvedValue({
      playlist1: 2,
      playlist2: 0,
    });
    vi.spyOn(
      spotifyApiService,
      "getAllUserPlaylistReferencesStrict",
    ).mockResolvedValue([]);
  });

  const renderModal = (props = {}) => {
    return render(
      <SmartPlaylistModal
        smartPlaylists={mockSmartPlaylists}
        taxonomy={mockTaxonomy}
        onEditPlaylist={mockOnEditPlaylist}
        onUpdateSmartPlaylists={mockOnUpdateSmartPlaylists}
        onSyncPlaylist={mockOnSyncPlaylist}
        onExportSmartPlaylists={mockOnExportSmartPlaylists}
        onImportSmartPlaylists={mockOnImportSmartPlaylists}
        onClose={mockOnClose}
        {...props}
      />
    );
  };

  describe("Rendering", () => {
    it.each([
      { actual: ["spotify:track:matched"], status: "In Sync" },
      { actual: ["spotify:track:matched", "spotify:local:wrong"], status: "Needs Sync" },
    ])("accounts for manual local-file additions when showing $status", async ({ actual, status }) => {
      const matched = { rating: 5, energy: 7, bpm: 125, tagIds: [HOUSE_TAG_ID] };
      vi.spyOn(storageService, "loadAllStrict").mockResolvedValue({ ...defaultTagData, tracks: { "spotify:track:matched": matched, "spotify:local:matched": matched, "spotify:local:wrong": { ...matched, rating: 1 } } });
      vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockResolvedValue(actual);
      markConfirmedMembershipBaselines(mockSmartPlaylists, new Set(["playlist1"]));
      renderModal({ smartPlaylists: [mockSmartPlaylists[0]] });
      expect(await screen.findByText(status)).toBeInTheDocument();
    });
    it("should render modal with smart playlists", () => {
      renderModal();

      expect(screen.getByRole("heading", { name: /Smart Playlists/i })).toHaveTextContent(
        "Smart Playlists (2)"
      );
      expect(screen.getByText("Electronic House Mix")).toBeInTheDocument();
      expect(screen.getByText("Chill Vibes")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Share" })).toHaveAttribute(
        "title",
        "Save your smart playlist setups to share with someone",
      );
      expect(screen.getByRole("button", { name: "Import" })).toHaveAttribute(
        "title",
        "Add smart playlist setups that someone shared with you",
      );
      expect(screen.getByText("Create, organize, and share playlists that stay up to date automatically.")).toBeInTheDocument();
      expect(screen.queryByText(/legacy|portable|recipe|binding/i)).not.toBeInTheDocument();
    });

    it("should render empty state when no smart playlists exist", () => {
      renderModal({ smartPlaylists: [] });

      expect(screen.getByText("No Smart Playlists Yet")).toBeInTheDocument();
      expect(screen.getByText(/Create a playlist with filters/)).toBeInTheDocument();
    });

    it("explains sharing on hover or keyboard focus", () => {
      renderModal();

      const infoButton = screen.getByRole("button", {
        name: "About sharing smart playlists",
      });
      const tooltip = document.getElementById("smart-playlist-share-info");
      expect(infoButton).toHaveAttribute(
        "aria-describedby",
        "smart-playlist-share-info",
      );
      expect(infoButton).not.toHaveAttribute("aria-expanded");
      expect(tooltip).toHaveAttribute("role", "tooltip");
      expect(tooltip).toHaveTextContent("What does Share include?");
      expect(screen.getByText(/does not include the songs/i)).toBeInTheDocument();
      expect(screen.getByText(/does not.*access to your Spotify account/i)).toBeInTheDocument();
      expect(screen.getByText(/create their own Spotify playlists/i)).toBeInTheDocument();
    });

    it("introduces mobile tagging once per account and keeps help accessible", async () => {
      const user = userEvent.setup();
      history.mobileTaggingIntroSeen = false;

      const firstView = renderModal();

      expect(
        screen.getByRole("heading", { name: "Tag songs from your phone" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/mobile tagging shortcuts/i)).toBeInTheDocument();
      expect(screen.getByText(/spotify on your phone/i)).toBeInTheDocument();
      expect(screen.getByText(/tells you exactly what changed/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Got it" }));
      expect(history.markSeen).toHaveBeenCalledWith("mobileTaggingIntroSeen");
      firstView.unmount();

      localStorage.clear();
      renderModal();
      expect(screen.queryByRole("heading", { name: "Tag songs from your phone" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Mobile tagging" }));
      expect(screen.getByRole("heading", { name: "Tag songs from your phone" })).toBeInTheDocument();
    });

    it("waits for account history while allowing mobile help to open manually", async () => {
      history.ready = false;
      history.mobileTaggingIntroSeen = false;
      renderModal();
      expect(screen.queryByRole("heading", { name: "Tag songs from your phone" })).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "Mobile tagging" }));
      expect(screen.getByRole("heading", { name: "Tag songs from your phone" })).toBeInTheDocument();
    });

    it("keeps imported definitions visible when their old Spotify IDs cannot be resolved", async () => {
      (global.Spicetify.Platform as any).PlaylistAPI.getMetadata = vi
        .fn()
        .mockRejectedValue(new Error("playlist not found"));

      renderModal({
        smartPlaylists: [
          { ...mockSmartPlaylists[0], playlistId: "old-4-star", playlistName: "4★" },
          { ...mockSmartPlaylists[1], playlistId: "old-4-5-star", playlistName: "4.5★" },
        ],
      });

      expect(screen.getByText("4★")).toBeInTheDocument();
      expect(screen.getByText("4.5★")).toBeInTheDocument();
      await waitFor(() => {
        expect(mockOnUpdateSmartPlaylists).not.toHaveBeenCalled();
      });
    });

    it("keeps an imported recipe unbound until the user creates its Spotify playlist", async () => {
      const user = userEvent.setup();
      const onBindRecipe = vi.fn().mockResolvedValue(undefined);
      const recipe = {
        ...mockSmartPlaylists[0],
        id: "recipe-1",
        playlistId: "",
        isActive: false,
        playlistName: "Portable House",
        smartPlaylistTrackUris: [],
      };

      renderModal({ smartPlaylists: [recipe], tracks: {}, onBindRecipe });

      expect(screen.getByText("Not Connected")).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "Create Spotify Playlist" }),
      );
      expect(onBindRecipe).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Create playlist and enable sync" }));
      expect(onBindRecipe).toHaveBeenCalledWith(recipe);
      expect(screen.queryByRole("button", { name: /Enable Sync/i })).not.toBeInTheDocument();
    });

    it("should display playlist criteria correctly", () => {
      renderModal();

      const playlistItem = screen
        .getByText("Electronic House Mix")
        .closest('[class*="playlistItem"]') as HTMLElement | null;
      expect(playlistItem).toBeTruthy();
      if (!playlistItem) {
        throw new Error("Expected Electronic House Mix playlist item");
      }

      expect(within(playlistItem).getByText("Match")).toBeInTheDocument();
      expect(within(playlistItem).getByText("House")).toBeInTheDocument();
      expect(within(playlistItem).getByText(/4, 5 ★/)).toBeInTheDocument();
      expect(within(playlistItem).getByText(/Energy: ≥6/)).toBeInTheDocument();
      expect(within(playlistItem).getByText(/120 - 130 BPM/)).toBeInTheDocument();
    });

    it("should show inactive playlist styling", () => {
      renderModal();

      const inactivePlaylist = screen.getByText("Chill Vibes").closest('[class*="playlistItem"]');

      expect(inactivePlaylist).toBeTruthy();
      if (inactivePlaylist) {
        expect(inactivePlaylist.className).toMatch(/inactive/i);
      }
    });
  });

  describe("Filter editing", () => {
    it("starts editing the selected playlist's filters", async () => {
      const user = userEvent.setup();
      renderModal();

      const playlistItem = screen
        .getByText("Electronic House Mix")
        .closest('[class*="playlistItem"]') as HTMLElement;
      await user.click(
        within(playlistItem).getByRole("button", { name: /edit filters/i }),
      );

      expect(mockOnEditPlaylist).toHaveBeenCalledWith(mockSmartPlaylists[0]);
    });
  });

  describe("Playlist Activation/Deactivation", () => {
    it("should toggle playlist active state", async () => {
      const user = userEvent.setup();
      renderModal();

      const toggleButton = screen
        .getAllByRole("button")
        .find(
          (button) =>
            button.textContent?.includes("Enable Sync") ||
            button.textContent?.includes("Disable Sync")
        );

      if (toggleButton) {
        await act(async () => {
          await user.click(toggleButton);
        });

        expect(mockOnUpdateSmartPlaylists).toHaveBeenCalled();
      }
    });

    it("should trigger sync when activating playlist", async () => {
      const user = userEvent.setup();
      mockOnSyncPlaylist.mockResolvedValue(undefined);

      renderModal();

      // Find and click the activate button for inactive playlist
      const inactivePlaylistSection = screen
        .getByText("Chill Vibes")
        .closest('[class*="playlistItem"]') as HTMLElement | null;
      const activateButton = inactivePlaylistSection
        ? within(inactivePlaylistSection).getByRole("button", {
            name: /enable sync/i,
          })
        : null;

      if (activateButton) {
        await act(async () => {
          await user.click(activateButton);
        });

        await waitFor(() => {
          expect(mockOnSyncPlaylist).toHaveBeenCalled();
        });
      }
    });

    it("should handle sync errors gracefully", async () => {
      const user = userEvent.setup();
      mockOnSyncPlaylist.mockRejectedValue(new Error("Sync failed"));

      renderModal();

      const inactivePlaylistSection = screen
        .getByText("Chill Vibes")
        .closest('[class*="playlistItem"]') as HTMLElement | null;
      const activateButton = inactivePlaylistSection
        ? within(inactivePlaylistSection).getByRole("button", {
            name: /enable sync/i,
          })
        : null;

      if (activateButton) {
        await act(async () => {
          await user.click(activateButton);
        });

        await waitFor(() => {
          expect(global.Spicetify.showNotification).toHaveBeenCalledWith(
            "Failed to sync playlist",
            true
          );
        });
      }
    });
  });

  describe("Manual Sync", () => {
    it("should trigger manual sync for active playlist", async () => {
      const user = userEvent.setup();
      mockOnSyncPlaylist.mockResolvedValue(undefined);
      renderModal();

      const syncButton = screen.queryByText(/sync now/i);

      if (syncButton) {
        await user.click(syncButton);

        await waitFor(() => {
          expect(mockOnSyncPlaylist).toHaveBeenCalledWith(mockSmartPlaylists[0]);
        });
      } else {
        // If button not found, fail with helpful message
        const activePlaylistSection = screen.getByText("Electronic House Mix").closest("div");
        console.log("Active playlist section HTML:", activePlaylistSection?.innerHTML);
        throw new Error("Sync button not found - check component rendering");
      }
    });

    it("should show loading state during sync", async () => {
      const user = userEvent.setup();
      let resolveSync: (value?: unknown) => void;
      mockOnSyncPlaylist.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSync = resolve;
          })
      );

      renderModal();

      // Use the same button-finding logic as above
      const syncButton =
        screen.queryByText(/sync now/i) ||
        screen.queryByRole("button", { name: /sync/i }) ||
        (document.querySelector('button[class*="sync"]') as HTMLElement | null);

      if (syncButton) {
        await user.click(syncButton);

        // Check for loading state - it might be text content instead of disabled state
        await waitFor(() => {
          // Check if button text changed to "Syncing..."
          expect(syncButton).toHaveTextContent(/syncing/i);
          // OR check if it's disabled
          // expect(syncButton).toBeDisabled();
        });

        // Resolve the sync
        resolveSync!();

        await waitFor(() => {
          // Check that loading state is cleared
          expect(syncButton).not.toHaveTextContent(/syncing/i);
          // expect(syncButton).not.toBeDisabled();
        });
      } else {
        throw new Error("Sync button not found");
      }
    });
  });

  describe("Tracking Removal", () => {
    it("should remove playlist from smart-playlist tracking without deleting Spotify playlist", async () => {
      const user = userEvent.setup();

      (global.Spicetify.Platform as any).PlaylistAPI = {
        getMetadata: vi.fn().mockImplementation((playlistUri: string) =>
          Promise.resolve({
            name:
              playlistUri === "spotify:playlist:playlist1"
                ? "Electronic House Mix"
                : "Chill Vibes",
          })
        ),
        remove: vi.fn(),
      };

      renderModal();

      const playlistCard = screen
        .getByText("Electronic House Mix")
        .closest('[class*="playlistItem"]') as HTMLElement | null;
      if (!playlistCard) {
        throw new Error("Could not locate playlist card");
      }

      mockOnUpdateSmartPlaylists.mockClear();

      await act(async () => {
        await user.click(
          within(playlistCard).getByRole("button", {
            name: /remove tracking/i,
          })
        );
      });

      expect(mockOnUpdateSmartPlaylists).toHaveBeenCalledWith([
        expect.objectContaining({
          playlistId: "playlist2",
          playlistName: "Chill Vibes",
        }),
      ]);
      expect(global.Spicetify.showNotification).toHaveBeenCalledWith(
        expect.stringContaining("Electronic House Mix")
      );
      expect((global.Spicetify.Platform as any).PlaylistAPI.remove).not.toHaveBeenCalled();
    });
  });

  describe("Navigation", () => {
    it("should navigate to playlist when clicking on title", async () => {
      const user = userEvent.setup();
      renderModal();

      const playlistTitle = screen.getByText("Electronic House Mix");
      await act(async () => {
        await user.click(playlistTitle);
      });

      expect(global.Spicetify.Platform.History.push).toHaveBeenCalledWith("/playlist/playlist1");
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Filter Display", () => {
    it("should format OR mode tag filters correctly", () => {
      const orModePlaylist: SmartPlaylistCriteria = {
        ...mockSmartPlaylists[0],
        criteria: {
          ...mockSmartPlaylists[0].criteria,
          includeTagClauses: [
            {
              tagIds: [HOUSE_TAG_ID, TECHNO_TAG_ID],
              excludedTagIds: [],
              operator: "OR",
            },
          ],
          clauseConnectors: [],
        },
      };

      renderModal({ smartPlaylists: [orModePlaylist] });

      expect(screen.getByText("(House OR Techno)")).toBeInTheDocument();
    });

    it("should format clause-local NOT tags correctly", () => {
      const playlistWithExclusions: SmartPlaylistCriteria = {
        ...mockSmartPlaylists[0],
        criteria: {
          ...mockSmartPlaylists[0].criteria,
          includeTagClauses: [
            {
              tagIds: [HOUSE_TAG_ID],
              excludedTagIds: [CHILL_TAG_ID],
              operator: "OR",
            },
          ],
        },
      };

      renderModal({ smartPlaylists: [playlistWithExclusions] });

      expect(screen.getByText("House AND NOT Chill")).toBeInTheDocument();
    });

    it("should format energy ranges correctly", () => {
      const playlistWithEnergyRange: SmartPlaylistCriteria = {
        ...mockSmartPlaylists[0],
        criteria: {
          ...mockSmartPlaylists[0].criteria,
          energyMinFilter: 5,
          energyMaxFilter: 8,
        },
      };

      renderModal({ smartPlaylists: [playlistWithEnergyRange] });

      expect(screen.getByText("Energy: 5 - 8")).toBeInTheDocument();
    });

    it("should show track count for playlists", () => {
      renderModal();

      // Test that both playlists show their track count structure
      const electronicPlaylist = screen
        .getByText("Electronic House Mix")
        .closest('[class*="playlistItem"]');
      const chillPlaylist = screen.getByText("Chill Vibes").closest('[class*="playlistItem"]');

      // Electronic House Mix playlist (has 2 tracks in smartPlaylistTrackUris)
      expect(electronicPlaylist).toHaveTextContent("2"); // Tracked count
      expect(electronicPlaylist).toHaveTextContent("In Playlist");
      expect(electronicPlaylist).toHaveTextContent("Tracked");

      // Chill Vibes playlist (has 0 tracks in smartPlaylistTrackUris)
      expect(chillPlaylist).toHaveTextContent("0"); // Tracked count
      expect(chillPlaylist).toHaveTextContent("In Playlist");
      expect(chillPlaylist).toHaveTextContent("Tracked");
    });
  });

  describe("Modal Interaction", () => {
    it("should close modal when clicking close button", async () => {
      const user = userEvent.setup();
      renderModal();

      const closeButton = document.querySelector(
        "button.modal-close-button"
      ) as HTMLButtonElement | null;
      if (!closeButton) {
        throw new Error("Close button not found");
      }
      await act(async () => {
        await user.click(closeButton);
      });

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("should close modal when clicking overlay", async () => {
      const user = userEvent.setup();
      renderModal();

      const overlay = document.querySelector('[class*="overlay"]');

      if (overlay) {
        await user.click(overlay);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it("should not close modal when clicking modal content", async () => {
      const user = userEvent.setup();
      renderModal();

      const modalContent = screen.getByRole("heading", { name: /Smart Playlists/i }).closest("div");

      if (modalContent) {
        await user.click(modalContent);
        expect(mockOnClose).not.toHaveBeenCalled();
      } else {
        throw new Error("Modal content not found");
      }
    });
  });

  describe("Playlist Name Sync", () => {
    it("should sync playlist names on mount", async () => {
      renderModal();

      await waitFor(() => {
        expect(
          (global.Spicetify.Platform as any).PlaylistAPI.getMetadata
        ).toHaveBeenCalledWith(
          "spotify:playlist:playlist1"
        );
      });
    });

    it("should update playlist names if they changed", async () => {
      (global.Spicetify.Platform as any).PlaylistAPI = {
        getMetadata: vi.fn().mockImplementation((playlistUri: string) =>
          Promise.resolve({
            name:
              playlistUri === "spotify:playlist:playlist1"
                ? "Updated Playlist Name"
                : "Chill Vibes",
            description: "Test description",
          }),
        ),
      };

      renderModal();

      await waitFor(() => {
        expect(mockOnUpdateSmartPlaylists).toHaveBeenCalled();
      });
    });
  });
});
