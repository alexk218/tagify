import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import CreatePlaylistModal from "@/components/modals/CreatePlaylistModal";
import styles from "@/components/CreatePlaylistModal.module.css";

describe("CreatePlaylistModal", () => {
  const mockProps = {
    trackCount: 25,
    localTrackCount: 3,
    activeTagDisplayNames: ["House", "Uplifting"],
    excludedTagDisplayNames: ["Chill"],
    isOrFilterMode: false,
    ratingFilters: [4, 5],
    energyMinFilter: 6,
    energyMaxFilter: null,
    bpmMinFilter: 120,
    bpmMaxFilter: 130,
    currentSearchTerm: "",
    onCreatePlaylist: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderModal = (props = {}) => {
    return render(<CreatePlaylistModal {...mockProps} {...props} />);
  };

  describe("Rendering", () => {
    it("should render modal with correct title", () => {
      renderModal();
      expect(screen.getByRole("heading", { name: "Create Playlist" })).toBeInTheDocument();
    });

    it("should show track count information", () => {
      renderModal();
      expect(
        screen.getByText((_, el) => el?.textContent === "Creating playlist with 25 tracks")
      ).toBeInTheDocument();
    });
  });

  describe("Form Inputs", () => {
    it("should allow editing playlist name", async () => {
      const user = userEvent.setup();
      renderModal();

      const nameInput = screen.getByLabelText(/playlist name/i);

      // No need for act() - userEvent handles this automatically
      await user.clear(nameInput);
      await user.type(nameInput, "My Custom Playlist");

      expect(nameInput).toHaveValue("My Custom Playlist");
    });

    it("should allow editing playlist description", async () => {
      const user = userEvent.setup();
      renderModal();

      const descriptionInput = screen.getByLabelText(/description/i);

      // Clean approach without act()
      await user.clear(descriptionInput);
      await user.type(descriptionInput, "My custom description");

      expect(descriptionInput).toHaveValue("My custom description");
    });

    it("should respect input length limits", async () => {
      const user = userEvent.setup();
      renderModal();

      const nameInput = screen.getByLabelText(/playlist name/i);
      const longName = "a".repeat(150);

      await user.clear(nameInput);
      await user.type(nameInput, longName);

      // Should be truncated to 100 characters
      expect(nameInput).toHaveValue("a".repeat(100));
    });
  });

  describe("Checkbox Options", () => {
    it("should toggle public playlist option", async () => {
      const user = userEvent.setup();
      renderModal();

      const publicCheckbox = screen.getByLabelText(/public playlist/i);
      expect(publicCheckbox).not.toBeChecked();

      await user.click(publicCheckbox);
      expect(publicCheckbox).toBeChecked();
    });

    it("should toggle smart playlist option", async () => {
      const user = userEvent.setup();
      renderModal();

      const smartCheckbox = screen.getByLabelText(/smart playlist/i);
      expect(smartCheckbox).not.toBeChecked();

      await user.click(smartCheckbox);
      expect(smartCheckbox).toBeChecked();
    });
  });

  describe("Smart Playlist Warning", () => {
    it("should show search term warning for smart playlists", async () => {
      const user = userEvent.setup();
      renderModal({ currentSearchTerm: "test search" });

      const smartCheckbox = screen.getByLabelText(/smart playlist/i);
      await user.click(smartCheckbox);

      // Use waitFor for elements that appear after state changes
      await waitFor(() => {
        expect(
          screen.getByText(/Search term "test search" will not be included/)
        ).toBeInTheDocument();
      });
    });

    it("should not show warning when no search term", async () => {
      const user = userEvent.setup();
      renderModal({ currentSearchTerm: "" });

      const smartCheckbox = screen.getByLabelText(/smart playlist/i);
      await user.click(smartCheckbox);

      expect(screen.queryByText(/Search term.*will not be included/)).not.toBeInTheDocument();
    });
  });

  describe("Form Submission", () => {
    it("should call onCreatePlaylist with auto-generated values for smart playlists", async () => {
      const user = userEvent.setup();
      renderModal();

      const nameInput = screen.getByLabelText(/playlist name/i);
      const descriptionInput = screen.getByLabelText(/description/i);
      const publicCheckbox = screen.getByLabelText(/public playlist/i);
      const smartCheckbox = screen.getByLabelText(/smart playlist/i);

      // First set custom values
      await user.clear(nameInput);
      await user.type(nameInput, "Test Playlist");
      await user.clear(descriptionInput);
      await user.type(descriptionInput, "Test Description");
      await user.click(publicCheckbox);

      // When we enable smart playlist, it should auto-generate values
      await user.click(smartCheckbox);

      const submitButton = screen.getByRole("button", { name: /create playlist/i });
      await user.click(submitButton);

      // Test the actual auto-generated values
      expect(mockProps.onCreatePlaylist).toHaveBeenCalledWith(
        "Smart Tagify - House, Uplifting 4,5★ E≥6 120-130BPM",
        "SMART PLAYLIST | Tags (ALL): House, Uplifting | Excluded: Chill | Rating: 4, 5 ★ | Energy: ≥6 | BPM: 120 - 130",
        true,
        true
      );
    });

    it("should call onCreatePlaylist with user values for regular playlists", async () => {
      const user = userEvent.setup();
      renderModal();

      const nameInput = screen.getByLabelText(/playlist name/i);
      const descriptionInput = screen.getByLabelText(/description/i);
      const publicCheckbox = screen.getByLabelText(/public playlist/i);

      // Fill out the form WITHOUT enabling smart playlist
      await user.clear(nameInput);
      await user.type(nameInput, "Test Playlist");
      await user.clear(descriptionInput);
      await user.type(descriptionInput, "Test Description");
      await user.click(publicCheckbox);

      const submitButton = screen.getByRole("button", { name: /create playlist/i });
      await user.click(submitButton);

      expect(mockProps.onCreatePlaylist).toHaveBeenCalledWith(
        "Test Playlist",
        "Test Description",
        true,
        false // smart playlist is false
      );
    });

    it("should auto-generate values when smart playlist is enabled", async () => {
      const user = userEvent.setup();
      renderModal();

      const smartCheckbox = screen.getByLabelText(/smart playlist/i);
      await user.click(smartCheckbox);

      const submitButton = screen.getByRole("button", { name: /create playlist/i });
      await user.click(submitButton);

      expect(mockProps.onCreatePlaylist).toHaveBeenCalledWith(
        "Smart Tagify - House, Uplifting 4,5★ E≥6 120-130BPM",
        "SMART PLAYLIST | Tags (ALL): House, Uplifting | Excluded: Chill | Rating: 4, 5 ★ | Energy: ≥6 | BPM: 120 - 130",
        false,
        true
      );
    });

    it("should use auto-generated default values when inputs are empty", async () => {
      const user = userEvent.setup();
      renderModal();

      const nameInput = screen.getByLabelText(/playlist name/i);
      const descriptionInput = screen.getByLabelText(/description/i);

      await user.clear(nameInput);
      await user.clear(descriptionInput);

      const submitButton = screen.getByRole("button", { name: /create playlist/i });
      await user.click(submitButton);

      expect(mockProps.onCreatePlaylist).toHaveBeenCalledWith(
        "Tagify - House, Uplifting 4,5★ E≥6 120-130BPM", // Auto-generated based on filters
        "Tags (ALL): House, Uplifting | Excluded: Chill | Rating: 4, 5 ★ | Energy: ≥6 | BPM: 120 - 130",
        false,
        false
      );
    });

    it("should submit form with enter key", async () => {
      const user = userEvent.setup();
      renderModal();

      const nameInput = screen.getByLabelText(/playlist name/i);
      await user.type(nameInput, "Test{Enter}");

      expect(mockProps.onCreatePlaylist).toHaveBeenCalled();
    });
  });

  describe("Modal Interaction", () => {
    it("should close modal when clicking close button", async () => {
      const user = userEvent.setup();
      renderModal();

      const closeButton = screen.getByRole("button", { name: "×" });
      await user.click(closeButton);

      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it("should close modal when clicking overlay", async () => {
      const user = userEvent.setup();
      const { container } = renderModal();

      // Find the overlay (usually the parent of the modal)
      const overlay =
        container.querySelector('[class*="overlay"]') ||
        container.querySelector('[class*="backdrop"]') ||
        container.firstChild;

      if (overlay && overlay !== container.querySelector('[class*="modal"]')) {
        await user.click(overlay as Element);
        expect(mockProps.onClose).toHaveBeenCalled();
      }
    });

    it("should not close modal when clicking modal content", async () => {
      const user = userEvent.setup();
      const { container } = renderModal();

      // Click on the modal content using the class selector
      const modalContent = container.querySelector(`.${styles.modal}`);

      if (modalContent) {
        await user.click(modalContent);
        expect(mockProps.onClose).not.toHaveBeenCalled();
      }
    });
  });

  // Only use act() when absolutely necessary for state updates
  describe("Advanced State Management", () => {
    it("should handle input value changes correctly", async () => {
      const user = userEvent.setup();
      renderModal();

      const nameInput = screen.getByLabelText(/playlist name/i);
      const smartCheckbox = screen.getByLabelText(/smart playlist/i);

      // Test regular input without smart playlist
      await user.clear(nameInput);
      await user.type(nameInput, "Complex Test");
      expect(nameInput).toHaveValue("Complex Test");

      // Test that smart playlist overrides the input
      await user.click(smartCheckbox);
      expect(nameInput).toHaveValue("Smart Tagify - House, Uplifting 4,5★ E≥6 120-130BPM");
      expect(smartCheckbox).toBeChecked();
    });
  });
});
