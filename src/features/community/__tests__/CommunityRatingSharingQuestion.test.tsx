import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityRatingSharingQuestion, resetRatingSharingQuestionRun } from "../CommunityRatingSharingQuestion";
import {
  canOfferRatingSharing,
  COMMUNITY_RATING_SHARING_CHANGED_EVENT,
  parseRatingSharing,
  RATING_SHARING_ANSWERED_PREFIX,
  RATING_SHARING_ASKED_PREFIX,
  ratingSharingErrorMessage,
  shouldAskRatingSharing,
  withRatingSharing,
  type RatingSharing,
} from "../communityRatingSharing";
import { policyFixture } from "./sharingFixtures";

const mocks = vi.hoisted(() => ({ communityRequest: vi.fn(), recordProductInteraction: vi.fn() }));
vi.mock("@/services/sync/SyncRuntime", () => ({ syncRuntime: { communityRequest: mocks.communityRequest } }));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: mocks.recordProductInteraction }));
vi.mock("@/features/discovery-survey/services/tagifyUsage", () => ({
  getUsageAccountDigest: async () => "a".repeat(64),
  RATING_COMPLETED_EVENT: "tagify:ratingCompleted",
}));

const ACCOUNT = "a".repeat(64);
const state = (overrides: Partial<RatingSharing> = {}): RatingSharing => ({ available: true, shared: false, answered: false, profilePublic: true, rated: true, askOnDesktop: true, ...overrides });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const settle = async () => { await advance(0); await advance(0); await advance(1100); };
const question = () => screen.queryByRole("region", { name: "Help people who tag like you find great music" });
const rate = () => act(() => { window.dispatchEvent(new Event("tagify:ratingCompleted")); });

/** Community answers GET with `current`, and POST with the saved answer. */
function serve(current: RatingSharing) {
  mocks.communityRequest.mockImplementation(async (_path: string, options?: { body?: { share: boolean } }) => {
    if (options?.body) current = { ...current, shared: options.body.share, answered: true, askOnDesktop: false };
    return { ratingSharing: current };
  });
}

function renderQuestion(props: Partial<React.ComponentProps<typeof CommunityRatingSharingQuestion>> = {}) {
  return render(<CommunityRatingSharingQuestion enabled connected status="idle" {...props} />);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetRatingSharingQuestionRun();
  mocks.communityRequest.mockReset();
  mocks.recordProductInteraction.mockReset();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Rating sharing question in Tagify", () => {
  it("asks a member who shares their tags when Tagify opens, with the approved wording", async () => {
    serve(state());
    renderQuestion();
    await settle();

    expect(question()).toBeInTheDocument();
    expect(question()).toHaveAccessibleDescription("Your 5-star songs show up for people with taste like yours, and your stars appear on your profile. Only on music you've tagged.");
    expect(screen.getByRole("button", { name: "Keep them private" })).toBeInTheDocument();
    expect(mocks.communityRequest).toHaveBeenCalledWith("/api/v2/rating-sharing");
    expect(mocks.recordProductInteraction.mock.calls).toEqual([["community_rating_sharing_asked", { surface: "desktop_question" }]]);
  });

  it("saves Share my ratings on Community and confirms it", async () => {
    serve(state());
    renderQuestion();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Share my ratings" }));
    await advance(0);

    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/rating-sharing", { method: "POST", body: { share: true, surface: "desktop_question" } });
    expect(screen.getByRole("status")).toHaveTextContent("Your ratings now show on music you've tagged.Change this any time in Privacy settings.");
    expect(mocks.recordProductInteraction).toHaveBeenLastCalledWith("community_rating_sharing_answered", { answer: "yes", surface: "desktop_question" });
    expect(localStorage.getItem(`${RATING_SHARING_ANSWERED_PREFIX}${ACCOUNT}`)).toBe("answered");
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(screen.getByRole("button", { name: "Privacy settings" }));
    expect(open).toHaveBeenCalledWith("https://tagify.fm/settings/privacy", "_blank", "noopener,noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("saves Keep them private and confirms it", async () => {
    serve(state());
    renderQuestion();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Keep them private" }));
    await advance(0);

    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/rating-sharing", { method: "POST", body: { share: false, surface: "desktop_question" } });
    expect(screen.getByRole("status")).toHaveTextContent("Your ratings stay private.Change this any time in Privacy settings.");
    expect(mocks.recordProductInteraction).toHaveBeenLastCalledWith("community_rating_sharing_answered", { answer: "no", surface: "desktop_question" });
  });

  it("keeps the question with a plain message when the answer couldn't be saved", async () => {
    serve(state());
    renderQuestion();
    await settle();
    mocks.communityRequest.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: "Share my ratings" }));
    await advance(0);

    expect(question()).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save your choice. Please try again.");
    expect(mocks.recordProductInteraction).not.toHaveBeenCalledWith("community_rating_sharing_answered", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Share my ratings" }));
    await advance(0);
    expect(screen.getByRole("status")).toHaveTextContent("Your ratings now show on music you've tagged.");
  });

  it("asks after the member's next rating when opening didn't", async () => {
    serve(state({ rated: false, askOnDesktop: false }));
    renderQuestion();
    await settle();
    expect(question()).toBeNull();

    rate();
    await settle();
    expect(question()).toBeInTheDocument();
    expect(mocks.communityRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["already answered on Community", state({ answered: true, askOnDesktop: false })],
    ["without a public profile", state({ profilePublic: false, askOnDesktop: false })],
    ["while ratings are paused", state({ available: false, askOnDesktop: false })],
  ])("never asks a member %s, even after a rating", async (_label, current) => {
    serve(current);
    renderQuestion();
    await settle();
    rate();
    await settle();
    expect(question()).toBeNull();
    expect(mocks.recordProductInteraction).not.toHaveBeenCalled();
  });

  it("remembers an answer from Community on this computer, so a failed check never asks again", async () => {
    serve(state({ answered: true, askOnDesktop: false }));
    renderQuestion();
    await settle();
    expect(localStorage.getItem(`${RATING_SHARING_ANSWERED_PREFIX}${ACCOUNT}`)).toBe("answered");
  });

  it("doesn't ask or even check once this computer has an answer on note", async () => {
    localStorage.setItem(`${RATING_SHARING_ANSWERED_PREFIX}${ACCOUNT}`, "answered");
    serve(state());
    renderQuestion();
    await settle();
    rate();
    await settle();
    expect(question()).toBeNull();
    expect(mocks.communityRequest).not.toHaveBeenCalled();
  });

  it("shows nothing and no error when Community can't answer yet", async () => {
    mocks.communityRequest.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    renderQuestion();
    await settle();
    rate();
    await settle();
    expect(question()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks at most once per computer, even when the member ignores it", async () => {
    serve(state());
    const first = renderQuestion();
    await settle();
    expect(question()).toBeInTheDocument();
    expect(localStorage.getItem(`${RATING_SHARING_ASKED_PREFIX}${ACCOUNT}`)).toBe("asked");
    first.unmount();

    // A later Tagify run on the same computer.
    resetRatingSharingQuestionRun();
    mocks.communityRequest.mockClear();
    renderQuestion();
    await settle();
    rate();
    await settle();
    expect(question()).toBeNull();
    expect(mocks.communityRequest).not.toHaveBeenCalled();
  });

  it("asks at most once per Tagify run", async () => {
    serve(state());
    const first = renderQuestion();
    await settle();
    expect(question()).toBeInTheDocument();
    first.unmount();

    renderQuestion();
    await settle();
    rate();
    await settle();
    expect(question()).toBeNull();
    expect(mocks.recordProductInteraction.mock.calls.filter(([event]) => event === "community_rating_sharing_asked")).toHaveLength(1);
  });

  it("waits while Tagify shows something else, and while Sync needs attention", async () => {
    serve(state());
    const view = renderQuestion({ enabled: false });
    await settle();
    expect(question()).toBeNull();
    view.rerender(<CommunityRatingSharingQuestion enabled connected status="reauthorize" />);
    await settle();
    expect(question()).toBeNull();
    view.rerender(<CommunityRatingSharingQuestion enabled connected status="idle" />);
    await settle();
    expect(question()).toBeInTheDocument();
  });

  it("goes away when the member answers somewhere else in Tagify", async () => {
    serve(state());
    renderQuestion();
    await settle();
    act(() => { window.dispatchEvent(new CustomEvent(COMMUNITY_RATING_SHARING_CHANGED_EVENT, { detail: { ratingSharing: state({ answered: true, shared: true }) } })); });
    await settle();
    expect(question()).toBeNull();
  });
});

describe("rating sharing rules", () => {
  it("reads only a complete answer from Community", () => {
    expect(parseRatingSharing({ ratingSharing: state() })).toEqual(state());
    expect(parseRatingSharing({ ratingSharing: { ...state(), askOnDesktop: "yes" } })).toBeNull();
    expect(parseRatingSharing({})).toBeNull();
    expect(parseRatingSharing(null)).toBeNull();
  });

  it("asks only when Community says to, the profile is public, nothing was answered and ratings aren't paused", () => {
    expect(shouldAskRatingSharing(state(), false)).toBe(true);
    expect(shouldAskRatingSharing(state(), true)).toBe(false);
    expect(shouldAskRatingSharing(state({ askOnDesktop: false }), false)).toBe(false);
    expect(shouldAskRatingSharing(state({ answered: true }), false)).toBe(false);
    expect(shouldAskRatingSharing(state({ profilePublic: false }), false)).toBe(false);
    expect(shouldAskRatingSharing(state({ available: false }), false)).toBe(false);
    expect(shouldAskRatingSharing(null, false)).toBe(false);
    expect(canOfferRatingSharing(state({ askOnDesktop: false }))).toBe(true);
  });

  it("sets song and album ratings from the publish box and leaves everything else", () => {
    const policy = policyFixture();
    const shared = withRatingSharing(policy, true);
    expect(shared.entities).toEqual({ track: { tags: true, rating: true }, album: { tags: true, rating: true }, artist: { tags: true, rating: false } });
    expect(withRatingSharing(shared, false).entities).toEqual(policy.entities);
    expect({ ...shared, entities: undefined }).toEqual({ ...policy, entities: undefined });
  });

  it("explains a paused save plainly, and anything else as a retry", () => {
    expect(ratingSharingErrorMessage(Object.assign(new Error("x"), { status: 503 }))).toBe("Ratings are paused right now. Try again later.");
    expect(ratingSharingErrorMessage(new Error("internal"))).toBe("Couldn't save your choice. Please try again.");
  });
});
