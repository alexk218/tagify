import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityVisibilityReview } from "../CommunityPublicVisibilityReview";
import styles from "../CloudSyncModal.module.css";

const mocks = vi.hoisted(() => ({
  communityRequest: vi.fn(),
  getTaxonomy: vi.fn(),
  syncNow: vi.fn(),
}));

vi.mock("@/services/sync/SyncRuntime", () => ({
  syncRuntime: {
    communityRequest: mocks.communityRequest,
    syncNow: mocks.syncNow,
  },
}));

vi.mock("@/services/storage/StorageService", () => ({
  storageService: { getTaxonomy: mocks.getTaxonomy },
}));

describe("CommunityVisibilityReview", () => {
  beforeEach(() => {
    mocks.communityRequest.mockReset();
    mocks.getTaxonomy.mockReset();
    mocks.syncNow.mockReset();
  });

  it("keeps visibility controls and taxonomy collapsed until requested", async () => {
    mocks.communityRequest.mockResolvedValue({
      policy: {
        revision: 1,
        reviewedAt: "2026-08-21T00:00:00.000Z",
        enabled: true,
        shareTaxonomy: true,
        hiddenTagIds: [],
        hiddenNodeIds: [],
        entities: {
          track: { tags: true },
          album: { tags: true },
          artist: { tags: true },
        },
      },
    });
    mocks.getTaxonomy.mockResolvedValue({
      categoryOrder: ["mood"],
      categoriesById: {
        mood: { id: "mood", name: "Mood", subcategoryIds: ["healing"], childIds: ["healing"] },
      },
      foldersById: {
        healing: { id: "healing", name: "Healing", parentId: "mood", categoryId: "mood", tagIds: ["recovery"], childIds: ["recovery"] },
      },
      childrenByParentId: { mood: ["healing"], healing: ["recovery"] },
      subcategoriesById: {
        healing: { id: "healing", name: "Healing", parentId: "mood", categoryId: "mood", tagIds: ["recovery"], childIds: ["recovery"] },
      },
      tagsById: {
        recovery: { id: "recovery", name: "Recovery", parentId: "healing", subcategoryId: "healing" },
      },
      customAccentsById: {},
      colorThemesById: {},
      colorThemeOrder: [],
      ungroupedColorIds: [],
    });

    render(<CommunityVisibilityReview connected />);

    const disclosure = screen.getByRole("button", { name: /Public visibility Sharing all tags/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByPlaceholderText("Search tags and folders")).not.toBeInTheDocument();
    expect(screen.queryByText("Mood")).not.toBeInTheDocument();

    fireEvent.click(disclosure);
    const categoryToggle = await screen.findByRole("button", { name: "Expand Mood" });
    const exclusionTree = screen.getByRole("region", { name: "Tag exclusion choices" });
    const categoryCheckbox = screen.getByRole("checkbox", { name: /Exclude Mood/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(exclusionTree).toHaveAttribute("tabindex", "0");
    expect(categoryCheckbox).toHaveClass(styles.visibilityCheckbox);
    expect(screen.getByPlaceholderText("Search tags and folders")).toBeInTheDocument();
    expect(screen.queryByText("Healing")).not.toBeInTheDocument();
    expect(screen.queryByText("Recovery")).not.toBeInTheDocument();

    fireEvent.click(categoryToggle);
    expect(screen.getByText("Healing")).toBeInTheDocument();
    expect(screen.queryByText("Recovery")).not.toBeInTheDocument();

    fireEvent.click(disclosure);
    expect(screen.queryByPlaceholderText("Search tags and folders")).not.toBeInTheDocument();
  });

  it("opens an unreviewed policy and requires saving it before first publication", async () => {
    const unreviewedPolicy = {
      revision: 0,
      reviewedAt: null,
      enabled: true,
      shareTaxonomy: true,
      hiddenTagIds: [],
      hiddenNodeIds: [],
      entities: {
        track: { tags: true },
        album: { tags: true },
        artist: { tags: true },
      },
    };
    mocks.communityRequest
      .mockResolvedValueOnce({ policy: unreviewedPolicy })
      .mockResolvedValueOnce({ policy: { ...unreviewedPolicy, revision: 1, reviewedAt: "2026-08-22T15:30:00.000Z" } });
    mocks.getTaxonomy.mockResolvedValue({
      categoryOrder: [], categoriesById: {}, foldersById: {}, childrenByParentId: {},
      subcategoriesById: {}, tagsById: {}, customAccentsById: {}, colorThemesById: {},
      colorThemeOrder: [], ungroupedColorIds: [],
    });
    const onReviewStateChange = vi.fn();

    render(<CommunityVisibilityReview connected onReviewStateChange={onReviewStateChange} />);

    const disclosure = await screen.findByRole("button", { name: /Public visibility Review required/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Review what will be public, then save once to publish your profile.")).toBeInTheDocument();
    expect(onReviewStateChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));

    await waitFor(() => expect(onReviewStateChange).toHaveBeenCalledWith(true));
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy", expect.objectContaining({
      method: "PUT",
      body: expect.objectContaining({ expectedRevision: 0, policy: expect.objectContaining({ reviewedAt: expect.any(String) }) }),
    }));
    expect(mocks.syncNow).toHaveBeenCalledOnce();
  });
});
