import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityUpdates } from "../CommunityUpdates";
import { communityUpdateService, type CommunityUpdate } from "../communityUpdateService";

const mocks = vi.hoisted(() => ({ communityRequest: vi.fn(), recordProductInteraction: vi.fn() }));
vi.mock("@/services/sync/SyncRuntime", () => ({ syncRuntime: { communityRequest: mocks.communityRequest } }));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: mocks.recordProductInteraction }));
vi.mock("@/features/discovery-survey/services/tagifyUsage", () => ({ getUsageAccountDigest: async () => "a".repeat(64) }));

const ratingsNotice: CommunityUpdate = { revision: 9, title: "Star ratings on Community", publishedAt: "2026-11-14T12:00:00Z", changes: ["Your star ratings can show on music you've tagged."], action: "share_ratings" };
const oldNotice: CommunityUpdate = { revision: 8, title: "More ways to discover music", publishedAt: "2026-10-01T12:00:00Z", changes: ["Browse tags on albums and artists."] };
const sharing = (overrides: Record<string, boolean> = {}) => ({ ratingSharing: { available: true, shared: false, answered: false, profilePublic: true, rated: true, askOnDesktop: true, ...overrides } });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const open = async (updates: CommunityUpdate[]) => {
  vi.spyOn(communityUpdateService, "check").mockResolvedValue(updates);
  render(<CommunityUpdates enabled />);
  await advance(3000);
  await advance(1100);
  await advance(0);
};
const shareButton = () => screen.queryByRole("button", { name: "Share my ratings" });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  mocks.communityRequest.mockReset();
  mocks.recordProductInteraction.mockReset();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(communityUpdateService, "dismiss").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Star ratings notice", () => {
  it("turns rating sharing on from the notice itself and confirms it", async () => {
    mocks.communityRequest.mockImplementation(async (_path: string, options?: { body?: unknown }) => options?.body ? sharing({ shared: true, answered: true, askOnDesktop: false }) : sharing());
    await open([ratingsNotice]);

    expect(mocks.recordProductInteraction).toHaveBeenCalledWith("community_rating_sharing_asked", { surface: "notice" });
    fireEvent.click(shareButton()!);
    await advance(0);

    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/rating-sharing", { method: "POST", body: { share: true, surface: "notice" } });
    expect(screen.getByRole("status")).toHaveTextContent("Your ratings now show on music you've tagged. Change this any time in Privacy settings.");
    expect(shareButton()).toBeNull();
    expect(mocks.recordProductInteraction).toHaveBeenCalledWith("community_rating_sharing_answered", { answer: "yes", surface: "notice" });
    expect(localStorage.getItem(`tagify:community-rating-sharing:v1:${"a".repeat(64)}`)).toBe("answered");
  });

  it("keeps the button with a plain message when ratings are paused", async () => {
    mocks.communityRequest.mockImplementation(async (_path: string, options?: { body?: unknown }) => {
      if (options?.body) throw Object.assign(new Error("Ratings are paused right now. Try again later."), { status: 503 });
      return sharing();
    });
    await open([ratingsNotice]);
    fireEvent.click(shareButton()!);
    await advance(0);

    expect(screen.getByRole("alert")).toHaveTextContent("Ratings are paused right now. Try again later.");
    expect(shareButton()).toBeEnabled();
    expect(mocks.recordProductInteraction).not.toHaveBeenCalledWith("community_rating_sharing_answered", expect.anything());
  });

  it.each([
    ["already answered", sharing({ answered: true })],
    ["without a public profile", sharing({ profilePublic: false })],
    ["while ratings are paused", sharing({ available: false })],
  ])("shows no button %s", async (_label, answer) => {
    mocks.communityRequest.mockResolvedValue(answer);
    await open([ratingsNotice]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(shareButton()).toBeNull();
    expect(mocks.recordProductInteraction).not.toHaveBeenCalled();
  });

  it("shows no button and no error when Community can't answer yet", async () => {
    mocks.communityRequest.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    await open([ratingsNotice]);
    expect(screen.getByText("Star ratings on Community")).toBeInTheDocument();
    expect(shareButton()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves notices without the action as they were", async () => {
    await open([oldNotice]);
    expect(screen.getByText("More ways to discover music")).toBeInTheDocument();
    expect(mocks.communityRequest).not.toHaveBeenCalled();
    expect(shareButton()).toBeNull();
  });
});
