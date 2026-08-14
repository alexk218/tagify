import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PlaylistDetails from "../PlaylistDetails";
import { PlaylistData, TagTaxonomy } from "@/types/tagData";

const taxonomy: TagTaxonomy = {
  categoryOrder: ["genre", "context"],
  categoriesById: {
    genre: {
      id: "genre",
      name: "Genre",
      subcategoryIds: ["style"],
    },
    context: {
      id: "context",
      name: "Context",
      subcategoryIds: ["activity"],
    },
  },
  subcategoriesById: {
    style: {
      id: "style",
      name: "Style",
      categoryId: "genre",
      tagIds: ["rock", "ambient"],
    },
    activity: {
      id: "activity",
      name: "Activity",
      categoryId: "context",
      tagIds: ["workout"],
    },
  },
  tagsById: {
    rock: {
      id: "rock",
      name: "Rock",
      subcategoryId: "style",
      accentId: null,
    },
    ambient: {
      id: "ambient",
      name: "Ambient",
      subcategoryId: "style",
      accentId: null,
    },
    workout: {
      id: "workout",
      name: "Workout",
      subcategoryId: "activity",
      accentId: null,
    },
  },
  customAccentsById: {},
  colorThemesById: {},
  ungroupedColorIds: [],
};

const playlistData: PlaylistData = {
  name: "Taxonomy Ordered Playlist",
  ownerName: "Owner",
  rating: 0,
  energy: 0,
  tagIds: ["workout", "ambient", "rock"],
};

function renderDetails() {
  render(
    <PlaylistDetails
      playlistUri="spotify:playlist:123"
      playlistData={playlistData}
      playlistMetadata={null}
      taxonomy={taxonomy}
      activeTagFilters={[]}
      excludedTagFilters={[]}
      onSetRating={vi.fn()}
      onSetEnergy={vi.fn()}
      onRemoveTag={vi.fn()}
      onToggleTagIncludeOff={vi.fn()}
      onOpenPlaylist={vi.fn()}
      onRefreshMetadata={vi.fn()}
      onApplyTagsToTracks={vi.fn().mockResolvedValue(undefined)}
      isApplyingTagsToTracks={false}
    />,
  );
}

describe("PlaylistDetails", () => {
  it("shows playlist tags in taxonomy order", () => {
    renderDetails();

    const tags = within(screen.getByLabelText("Playlist tags")).getAllByRole(
      "button",
      { name: /rock|ambient|workout/i },
    );

    expect(tags.map((tag) => tag.textContent).filter(Boolean)).toEqual([
      "Rock",
      "Ambient",
      "Workout",
    ]);
  });
});
