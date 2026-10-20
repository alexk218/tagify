import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMUNITY_SHARING_CHANGED_EVENT,
  fetchPublicationPolicy,
  hiddenBranchNames,
  isRevisionConflict,
  keepTagsPrivate,
  publicTagSummary,
  publishTags,
} from "../communityPublication";
import { policyFixture, taxonomyFixture, tracksFixture } from "./sharingFixtures";

const mocks = vi.hoisted(() => ({ communityRequest: vi.fn(), notePublicationReviewed: vi.fn(), recordProductInteraction: vi.fn() }));
vi.mock("@/services/sync/SyncRuntime", () => ({
  syncRuntime: { communityRequest: mocks.communityRequest, notePublicationReviewed: mocks.notePublicationReviewed },
}));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: mocks.recordProductInteraction }));
vi.mock("@/features/discovery-survey/services/tagifyUsage", () => ({ getUsageAccountDigest: vi.fn().mockResolvedValue(null) }));

describe("community publication", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("counts only Spotify songs, since local files never leave this device", () => {
    expect(publicTagSummary(tracksFixture(), taxonomyFixture())).toEqual({ tags: 3, songs: 3 });
    expect(publicTagSummary(tracksFixture(), taxonomyFixture(), { hiddenTagIds: ["happy"], hiddenNodeIds: [] })).toEqual({ tags: 2, songs: 2 });
    expect(publicTagSummary(tracksFixture(), taxonomyFixture(), { hiddenTagIds: [], hiddenNodeIds: ["mood", "workout"] })).toEqual({ tags: 0, songs: 0 });
  });

  it("names the top-most hidden folders and tags in the member's order", () => {
    expect(hiddenBranchNames(taxonomyFixture(), { hiddenTagIds: ["rain", "run"], hiddenNodeIds: ["calm"] })).toEqual(["Calm", "Run"]);
  });

  it("publishes with updates running again and tells every open view", async () => {
    const paused = policyFixture({ enabled: false, paused: true, revision: 3 });
    mocks.communityRequest.mockImplementation(async (_path, options) => ({ policy: { ...options.body.policy, revision: 4 } }));
    const changed = vi.fn();
    window.addEventListener(COMMUNITY_SHARING_CHANGED_EVENT, changed);
    try {
      const saved = await publishTags(paused, "workspace");
      expect(mocks.communityRequest).toHaveBeenCalledWith("/api/v2/publication-policy", {
        method: "PUT",
        body: { expectedRevision: 3, policy: expect.objectContaining({ enabled: true, paused: false, reviewedAt: expect.any(String) }) },
      });
      expect(saved.revision).toBe(4);
      expect((changed.mock.calls[0][0] as CustomEvent).detail.policy).toEqual(saved);
      expect(mocks.notePublicationReviewed).toHaveBeenCalledOnce();
      expect(mocks.recordProductInteraction).toHaveBeenCalledWith("community_profile_published", { surface: "workspace" });
    } finally {
      window.removeEventListener(COMMUNITY_SHARING_CHANGED_EVENT, changed);
    }
  });

  it("keeps a private choice private and never counts it as publishing", async () => {
    mocks.communityRequest.mockImplementation(async (_path, options) => ({ policy: options.body.policy }));
    await keepTagsPrivate(policyFixture({ reviewedAt: null }));
    expect(mocks.communityRequest.mock.calls[0][1].body.policy).toMatchObject({ enabled: false });
    expect(mocks.recordProductInteraction.mock.calls).toEqual([["community_publish_kept_private"]]);
  });

  it("stops Sync asking once a fetched choice exists, and only then", async () => {
    mocks.communityRequest.mockResolvedValueOnce({ policy: policyFixture({ reviewedAt: null }) });
    await fetchPublicationPolicy();
    expect(mocks.notePublicationReviewed).not.toHaveBeenCalled();
    mocks.communityRequest.mockResolvedValueOnce({ policy: policyFixture() });
    await fetchPublicationPolicy();
    expect(mocks.notePublicationReviewed).toHaveBeenCalledOnce();
  });

  it("recognizes a save refused because the choices changed elsewhere", () => {
    expect(isRevisionConflict(Object.assign(new Error("Publication policy revision conflict"), { status: 409 }))).toBe(true);
    expect(isRevisionConflict(Object.assign(new Error("Server unavailable"), { status: 503 }))).toBe(false);
    expect(isRevisionConflict(new Error("revision"))).toBe(false);
  });
});
