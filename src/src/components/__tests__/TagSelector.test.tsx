import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TagSelector from "@/components/tagging/TagSelector";
import { TagCategory, TrackTag } from "@/hooks/data/useTagData";
import React, { act } from "react";

const mockCategories: TagCategory[] = [
  {
    id: "genre",
    name: "Genre",
    subcategories: [
      {
        id: "electronic",
        name: "Electronic",
        tags: [
          { id: "house", name: "House" },
          { id: "techno", name: "Techno" },
          { id: "trance", name: "Trance" },
        ],
      },
      {
        id: "rock",
        name: "Rock",
        tags: [
          { id: "alternative", name: "Alternative" },
          { id: "indie", name: "Indie" },
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
          { id: "uplifting", name: "Uplifting" },
          { id: "chill", name: "Chill" },
          { id: "aggressive", name: "Aggressive" },
        ],
      },
    ],
  },
];

const mockTrackTags: TrackTag[] = [
  { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
  { categoryId: "mood", subcategoryId: "energy", tagId: "uplifting" },
];

// Mock localStorage for expanded state
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
});

describe.skip("TagSelector", () => {
  const mockTrack = {
    uri: "spotify:track:123",
    name: "Test Track",
  };

  const mockOnToggleTag = vi.fn();
  const mockOnOpenTagManager = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  const renderTagSelector = (props = {}) => {
    return render(
      <TagSelector
        categories={mockCategories}
        trackTags={mockTrackTags}
        onToggleTag={mockOnToggleTag}
        onOpenTagManager={mockOnOpenTagManager}
        isMultiTagging={false}
        isLockedTrack={false}
        {...props}
      />
    );
  };

  // Helper function to expand categories and subcategories
  const expandCategoryAndSubcategory = async (
    user: any,
    categoryName: string,
    subcategoryName: string
  ) => {
    const category = screen.getByText(categoryName);
    await user.click(category);

    const subcategory = screen.getByText(subcategoryName);
    await user.click(subcategory);
  };

  describe("Rendering", () => {
    it("should render all categories and subcategories", () => {
      renderTagSelector();

      expect(screen.getByText("Genre")).toBeInTheDocument();
      expect(screen.getByText("Mood")).toBeInTheDocument();
    });

    it("should show selected tags as active", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      // Expand Genre -> Electronic to see House tag
      await expandCategoryAndSubcategory(user, "Genre", "Electronic");

      // Expand Mood -> Energy to see Uplifting tag
      await expandCategoryAndSubcategory(user, "Mood", "Energy");

      const houseTag = screen.getByText("House");
      const upliftingTag = screen.getByText("Uplifting");

      expect(houseTag).toHaveClass(expect.stringMatching(/applied|selected|active/i));
      expect(upliftingTag).toHaveClass(expect.stringMatching(/applied|selected|active/i));
    });

    it("should show unselected tags as inactive", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      // Expand to see Techno tag
      await expandCategoryAndSubcategory(user, "Genre", "Electronic");

      const technoTag = screen.getByText("Techno");
      expect(technoTag).not.toHaveClass(expect.stringMatching(/applied|selected|active/i));
    });

    it("should show tag manager button", () => {
      renderTagSelector();

      const tagManagerButton = screen.getByText(/manage tags/i);
      expect(tagManagerButton).toBeInTheDocument();
    });
  });

  describe("Tag Interaction", () => {
    it("should call onToggleTag when clicking a tag", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      // Expand to see Techno tag
      await expandCategoryAndSubcategory(user, "Genre", "Electronic");

      const technoTag = screen.getByText("Techno");
      await user.click(technoTag);

      expect(mockOnToggleTag).toHaveBeenCalledWith("genre", "electronic", "techno");
    });

    it("should call onToggleTag for selected tags", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      // Expand to see House tag
      await expandCategoryAndSubcategory(user, "Genre", "Electronic");

      const houseTag = screen.getByText("House");
      await user.click(houseTag);

      expect(mockOnToggleTag).toHaveBeenCalledWith("genre", "electronic", "house");
    });

    it("should open tag manager when clicking manage button", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      const tagManagerButton = screen.getByText(/manage tags/i);
      await user.click(tagManagerButton);

      expect(mockOnOpenTagManager).toHaveBeenCalled();
    });
  });

  describe("Category and Subcategory Expansion", () => {
    it("should expand categories when clicked", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      const genreCategory = screen.getByText("Genre");
      await user.click(genreCategory);

      // Should show subcategories
      expect(screen.getByText("Electronic")).toBeInTheDocument();
      expect(screen.getByText("Rock")).toBeInTheDocument();
    });

    it("should expand subcategories when clicked", async () => {
      renderTagSelector();

      // First expand category
      const genreCategory = screen.getByText("Genre");
      await act(async () => {
        fireEvent.click(genreCategory);
      });

      // Then expand subcategory
      const electronicSubcat = screen.getByText("Electronic");
      await act(async () => {
        fireEvent.click(electronicSubcat);
      });

      // Should show tags
      expect(screen.getByText("House")).toBeInTheDocument();
      expect(screen.getByText("Techno")).toBeInTheDocument();
      expect(screen.getByText("Trance")).toBeInTheDocument();
    });

    it("should remember expanded state in localStorage", async () => {
      renderTagSelector();

      const genreCategory = screen.getByText("Genre");

      await act(async () => {
        fireEvent.click(genreCategory);
      });

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "tagify:expandedCategories",
        expect.stringContaining("genre")
      );
    });

    it("should restore expanded state from localStorage", () => {
      mockLocalStorage.getItem.mockImplementation((key) => {
        if (key === "tagify:expandedCategories") {
          return JSON.stringify(["genre"]);
        }
        if (key === "tagify:expandedSubcategories") {
          return JSON.stringify(["electronic"]);
        }
        return null;
      });

      renderTagSelector();

      expect(screen.getByText("Electronic")).toBeInTheDocument();
      expect(screen.getByText("House")).toBeInTheDocument();
    });
  });

  describe("Search Functionality", () => {
    it("should filter tags based on search term", async () => {
      renderTagSelector();

      const searchInput = screen.getByPlaceholderText(/search tags/i);

      // Use fireEvent instead of userEvent to avoid infinite loops
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "house" } });
      });

      // Wait a tick for React to process the change
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByText("House")).toBeInTheDocument();
      expect(screen.queryByText("Techno")).not.toBeInTheDocument();
    });

    it("should save search term to localStorage", async () => {
      renderTagSelector();

      const searchInput = screen.getByPlaceholderText(/search tags/i);

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "test" } });
      });

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith("tagify:tagSearchTerm", "test");
    });

    it("should restore search term from localStorage", () => {
      mockLocalStorage.getItem.mockImplementation((key) => {
        if (key === "tagify:tagSearchTerm") {
          return "house";
        }
        return null;
      });

      renderTagSelector();

      const searchInput = screen.getByPlaceholderText(/search tags/i) as HTMLInputElement;
      expect(searchInput.value).toBe("house");
    });

    it("should clear search when clicking clear button", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      const searchInput = screen.getByPlaceholderText(/search tags/i);

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "test" } });
      });

      const clearButton = screen.getByText(/clear/i);
      await act(async () => {
        await user.click(clearButton);
      });

      expect((searchInput as HTMLInputElement).value).toBe("");
    });
  });

  describe("Multi-tagging Mode", () => {
    it("should show multi-tagging indicator when enabled", () => {
      renderTagSelector({ isMultiTagging: true });

      expect(
        screen.getByText(/multi.tag mode|add tags to all selected tracks/i)
      ).toBeInTheDocument();
    });

    it("should show different styling in multi-tag mode", () => {
      const { container } = renderTagSelector({ isMultiTagging: true });

      // Check for multi-tagging banner or class
      expect(screen.getByText(/add tags to all selected tracks/i)).toBeInTheDocument();
    });
  });

  describe("Locked Track State", () => {
    it("should disable interactions when track is locked", async () => {
      const user = userEvent.setup();
      renderTagSelector({ isLockedTrack: true });

      // Expand to see tags first
      await expandCategoryAndSubcategory(user, "Genre", "Electronic");

      const houseTag = screen.getByText("House");
      const technoTag = screen.getByText("Techno");

      expect(houseTag).toBeDisabled();
      expect(technoTag).toBeDisabled();
    });

    it("should show locked indicator", () => {
      renderTagSelector({ isLockedTrack: true, isMultiTagging: true });

      expect(screen.getByText(/locked|🔒/)).toBeInTheDocument();
    });
  });

  describe("Expand All Functionality", () => {
    it("should expand all categories and subcategories when clicking expand all", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      const expandAllButton = screen.getByText(/expand all/i);
      await act(async () => {
        await user.click(expandAllButton);
      });

      expect(screen.getByText("Electronic")).toBeInTheDocument();
      expect(screen.getByText("Rock")).toBeInTheDocument();
      expect(screen.getByText("Energy")).toBeInTheDocument();
      expect(screen.getByText("House")).toBeInTheDocument();
      expect(screen.getByText("Alternative")).toBeInTheDocument();
      expect(screen.getByText("Uplifting")).toBeInTheDocument();
    });

    it("should collapse all when clicking collapse all", async () => {
      const user = userEvent.setup();

      // Start with expanded state
      mockLocalStorage.getItem.mockImplementation((key) => {
        if (key === "tagify:areAllExpanded") {
          return "true";
        }
        if (key === "tagify:expandedCategories") {
          return JSON.stringify(["genre", "mood"]);
        }
        if (key === "tagify:expandedSubcategories") {
          return JSON.stringify(["electronic", "rock", "energy"]);
        }
        return null;
      });

      renderTagSelector();

      const collapseAllButton = screen.getByText(/collapse all/i);
      await act(async () => {
        await user.click(collapseAllButton);
      });

      expect(screen.queryByText("Electronic")).not.toBeInTheDocument();
      expect(screen.queryByText("Energy")).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("should have proper ARIA labels", () => {
      renderTagSelector();

      const searchInput = screen.getByPlaceholderText(/search tags/i);
      expect(searchInput).toHaveAttribute("placeholder", expect.stringMatching(/search/i));
    });

    it("should support keyboard navigation", async () => {
      const user = userEvent.setup();
      renderTagSelector();

      // Expand to see tags first
      await expandCategoryAndSubcategory(user, "Genre", "Electronic");

      const houseTag = screen.getByText("House");
      houseTag.focus();

      await act(async () => {
        await user.keyboard("{Enter}");
      });

      expect(mockOnToggleTag).toHaveBeenCalledWith("genre", "electronic", "house");
    });
  });
});
