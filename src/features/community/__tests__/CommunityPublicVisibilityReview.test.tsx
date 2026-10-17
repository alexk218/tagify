import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityVisibilityReview } from "../CommunityPublicVisibilityReview";
// eslint-disable-next-line css-modules/no-unused-class -- the test checks one shared class
import styles from "../CloudSyncModal.module.css";

const mocks = vi.hoisted(() => ({
  communityRequest: vi.fn(),
  getTaxonomy: vi.fn(),
  syncNow: vi.fn(),
  recordProductInteraction: vi.fn(),
}));

vi.mock("@/features/product-analytics/productAnalytics", () => ({
  recordProductInteraction: mocks.recordProductInteraction,
}));

vi.mock("@/features/discovery-survey/services/tagifyUsage", () => ({
  getUsageAccountDigest: vi.fn().mockResolvedValue("a".repeat(64)),
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
    mocks.recordProductInteraction.mockReset();
    localStorage.clear();
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

    const disclosure = await screen.findByRole("button", { name: /Public visibility Sharing all tags/ });
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

  it("opens an unreviewed policy and publishes only when the member chooses to", async () => {
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
    expect(screen.getByText("Review what will be public, then publish. Any tag or folder you hide stays private.")).toBeInTheDocument();
    expect(onReviewStateChange).toHaveBeenCalledWith(false);
    expect(mocks.communityRequest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));

    await waitFor(() => expect(onReviewStateChange).toHaveBeenCalledWith(true));
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy", expect.objectContaining({
      method: "PUT",
      body: expect.objectContaining({ expectedRevision: 0, policy: expect.objectContaining({ enabled: true, reviewedAt: expect.any(String) }) }),
    }));
    expect(mocks.syncNow).toHaveBeenCalledOnce();
    expect(mocks.recordProductInteraction).toHaveBeenCalledWith("community_profile_published");
    expect(await screen.findByText("Publishing your tags. Your profile updates within a minute.")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(`tagify:community-publish-prompt:v1:${"a".repeat(64)}`) || "{}")).toMatchObject({ decided: true }));
  });

  it("records keeping tags private as a reviewed choice without publishing", async () => {
    const unreviewedPolicy = policyWith({ revision: 3, reviewedAt: null });
    mocks.communityRequest
      .mockResolvedValueOnce({ policy: unreviewedPolicy })
      .mockImplementationOnce(async (_path, options) => ({ policy: { ...options.body.policy, revision: 4 } }));
    mocks.getTaxonomy.mockResolvedValue(emptyTaxonomy());

    render(<CommunityVisibilityReview connected />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep my tags private" }));

    expect(await screen.findByText("Your tags stay private. You can publish them here any time.")).toBeInTheDocument();
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy", expect.objectContaining({
      method: "PUT",
      body: expect.objectContaining({ expectedRevision: 3, policy: expect.objectContaining({ enabled: false, reviewedAt: expect.any(String) }) }),
    }));
    expect(mocks.recordProductInteraction).toHaveBeenCalledWith("community_publish_kept_private");
    expect(mocks.recordProductInteraction).not.toHaveBeenCalledWith("community_profile_published");
    expect(screen.getByRole("button", { name: /Public visibility Not public/ })).toBeInTheDocument();
  });

  it("never republishes a member who stopped sharing when they change hidden tags", async () => {
    const privatePolicy = policyWith({ revision: 7, enabled: false });
    mocks.communityRequest
      .mockResolvedValueOnce({ policy: privatePolicy })
      .mockImplementation(async (_path, options) => ({ policy: { ...options.body.policy, revision: options.body.expectedRevision + 1 } }));
    mocks.getTaxonomy.mockResolvedValue(moodTaxonomy());

    render(<CommunityVisibilityReview connected />);
    const disclosure = await screen.findByRole("button", { name: /Public visibility Not public/ });
    expect(screen.queryByText(/Sharing all tags/)).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(screen.getByText(/Your tags aren't public\./)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("checkbox", { name: /Exclude Mood/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save without publishing" }));
    await waitFor(() => expect(mocks.communityRequest).toHaveBeenCalledTimes(2));
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy", expect.objectContaining({
      method: "PUT",
      body: expect.objectContaining({ policy: expect.objectContaining({ enabled: false, hiddenNodeIds: ["mood"] }) }),
    }));
    expect(mocks.recordProductInteraction).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "Publish my tags" }));
    await waitFor(() => expect(mocks.communityRequest).toHaveBeenCalledTimes(3));
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy", expect.objectContaining({
      method: "PUT",
      body: expect.objectContaining({ expectedRevision: 8, policy: expect.objectContaining({ enabled: true, hiddenNodeIds: ["mood"] }) }),
    }));
    await waitFor(() => expect(mocks.recordProductInteraction).toHaveBeenCalledWith("community_profile_published"));
  });

  it("asks before taking a public profile down", async () => {
    mocks.communityRequest
      .mockResolvedValueOnce({ policy: policyWith({ revision: 5 }) })
      .mockResolvedValueOnce({ policy: policyWith({ revision: 6, enabled: false }) });
    mocks.getTaxonomy.mockResolvedValue(emptyTaxonomy());

    render(<CommunityVisibilityReview connected />);
    fireEvent.click(await screen.findByRole("button", { name: /Public visibility Sharing all tags/ }));
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(screen.getByText("Take down your public profile?")).toBeInTheDocument();
    expect(mocks.communityRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Take down your public profile?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    expect(await screen.findByText("Your profile is no longer public. Backup keeps running.")).toBeInTheDocument();
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy/unpublish", { method: "POST", body: { expectedRevision: 5 } });
    expect(screen.getByRole("button", { name: /Public visibility Not public/ })).toBeInTheDocument();
  });

  it("resumes paused updates", async () => {
    mocks.communityRequest
      .mockResolvedValueOnce({ policy: policyWith({ revision: 2, paused: true }) })
      .mockResolvedValueOnce({ policy: policyWith({ revision: 3 }) });
    mocks.getTaxonomy.mockResolvedValue(emptyTaxonomy());

    render(<CommunityVisibilityReview connected />);
    fireEvent.click(await screen.findByRole("button", { name: /Public visibility Updates paused/ }));
    fireEvent.click(screen.getByRole("button", { name: "Resume updates" }));
    expect(await screen.findByText("Updates resumed. Your profile catches up within a minute.")).toBeInTheDocument();
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy/resume", { method: "POST", body: { expectedRevision: 2 } });
  });
});

function policyWith(overrides: Record<string, unknown>) {
  return {
    revision: 1,
    reviewedAt: "2026-10-01T00:00:00.000Z",
    enabled: true,
    paused: false,
    shareTaxonomy: true,
    hiddenTagIds: [],
    hiddenNodeIds: [],
    entities: { track: { tags: true, rating: false }, album: { tags: true, rating: false }, artist: { tags: true, rating: false } },
    ...overrides,
  };
}

function emptyTaxonomy() {
  return {
    categoryOrder: [], categoriesById: {}, foldersById: {}, childrenByParentId: {},
    subcategoriesById: {}, tagsById: {}, customAccentsById: {}, colorThemesById: {},
    colorThemeOrder: [], ungroupedColorIds: [],
  };
}

function moodTaxonomy() {
  return {
    ...emptyTaxonomy(),
    categoryOrder: ["mood"],
    categoriesById: { mood: { id: "mood", name: "Mood", childIds: ["happy"], subcategoryIds: [] } },
    tagsById: { happy: { id: "happy", name: "Happy", parentId: "mood", subcategoryId: "mood" } },
    childrenByParentId: { mood: ["happy"] },
  };
}
