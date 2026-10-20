import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { CommunityPublishPrompt } from "../CommunityPublishPrompt";
import { publishTags } from "../communityPublication";
import { canAskToPublish, COMMUNITY_PUBLISH_PROMPT_PREFIX } from "../communityPublishPromptHistory";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";

vi.mock("@/features/discovery-survey/services/tagifyUsage", () => ({
  getUsageAccountDigest: vi.fn(),
}));
vi.mock("@/features/product-analytics/productAnalytics", () => ({
  recordProductInteraction: vi.fn(),
}));

const ACCOUNT = "a".repeat(64);
const HISTORY_KEY = `${COMMUNITY_PUBLISH_PROMPT_PREFIX}${ACCOUNT}`;
const DAY = 86_400_000;
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const settle = async () => { await advance(0); await advance(1100); };
const invitation = () => screen.queryByRole("region", { name: "Your tags aren't public yet" });

const taxonomy = {
  categoryOrder: ["mood"],
  categoriesById: { mood: { id: "mood", name: "Mood", childIds: ["happy", "calm", "secret"], subcategoryIds: [] } },
  tagsById: {
    happy: { id: "happy", name: "Happy", parentId: "mood", subcategoryId: "mood" },
    calm: { id: "calm", name: "Calm", parentId: "mood", subcategoryId: "mood" },
    secret: { id: "secret", name: "Secret", parentId: "mood", subcategoryId: "mood" },
  },
  foldersById: {}, childrenByParentId: { mood: ["happy", "calm", "secret"] }, subcategoriesById: {},
  customAccentsById: {}, colorThemesById: {}, colorThemeOrder: [], ungroupedColorIds: [],
} as unknown as TagTaxonomy;

const track = (tagIds: string[]) => ({ rating: 0, energy: 0, bpm: null, tagIds }) as TrackData;
// Five songs show public tags; the sixth carries only a hidden tag and stays off the profile.
const tracks: Record<string, TrackData> = {
  "spotify:track:1": track(["happy"]),
  "spotify:track:2": track(["happy", "calm"]),
  "spotify:track:3": track(["calm", "secret"]),
  "spotify:track:4": track(["happy"]),
  "spotify:track:5": track(["calm"]),
  "spotify:track:6": track(["secret"]),
};

function policy(overrides: Record<string, unknown> = {}) {
  return {
    revision: 4,
    reviewedAt: null,
    enabled: true,
    paused: false,
    shareTaxonomy: true,
    hiddenTagIds: ["secret"],
    hiddenNodeIds: [],
    entities: { track: { tags: true, rating: false }, album: { tags: true, rating: false }, artist: { tags: true, rating: false } },
    ...overrides,
  };
}

function renderPrompt(props: Partial<React.ComponentProps<typeof CommunityPublishPrompt>> = {}) {
  const onReview = vi.fn();
  const base = {
    enabled: true,
    connected: true,
    status: "publication-review-required" as const,
    taggedTrackCount: 6,
    lastUserTrackAddedEvent: null,
    tracks,
    taxonomy,
    onReview,
  };
  const view = render(<CommunityPublishPrompt {...base} {...props} />);
  const tagSong = (eventId: number, extra: Partial<React.ComponentProps<typeof CommunityPublishPrompt>> = {}) =>
    view.rerender(<CommunityPublishPrompt {...base} {...props} {...extra} lastUserTrackAddedEvent={{ eventId }} />);
  return { ...view, onReview, tagSong };
}

let communityRequest: MockInstance<Parameters<typeof syncRuntime.communityRequest>, ReturnType<typeof syncRuntime.communityRequest>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  localStorage.clear();
  vi.mocked(recordProductInteraction).mockReset();
  vi.mocked(getUsageAccountDigest).mockResolvedValue(ACCOUNT);
  communityRequest = vi.spyOn(syncRuntime, "communityRequest").mockResolvedValue({ policy: policy() });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Community publish invitation", () => {
  it("appears only after a newly tagged song, with what would be public", async () => {
    const { tagSong } = renderPrompt();
    await settle();
    expect(invitation()).toBeNull();
    expect(communityRequest).not.toHaveBeenCalled();

    tagSong(1);
    await settle();

    expect(invitation()).toBeInTheDocument();
    expect(invitation()).toHaveAccessibleDescription(
      "Tagify is backing up your library, but your Community profile stays empty until you choose what to share. 2 tags on 5 songs would appear. Private notes and ratings stay private. You can hide any tag or folder first.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(recordProductInteraction).toHaveBeenCalledWith("community_publish_prompt_shown");
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    expect(history.asks).toBe(1);
    expect(Date.parse(history.lastAskedAt) - Date.parse("2026-10-17T12:00:00Z")).toBeLessThan(5000);
  });

  it("counts the invitation only once it scrolls into view", async () => {
    const observers: Array<{ callback: IntersectionObserverCallback; disconnect: () => void }> = [];
    vi.stubGlobal("IntersectionObserver", class {
      callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) { this.callback = callback; observers.push(this); }
      observe() {}
      disconnect() {}
    });
    try {
      const { tagSong } = renderPrompt();
      tagSong(1);
      await settle();
      expect(invitation()).toBeInTheDocument();
      expect(recordProductInteraction).not.toHaveBeenCalled();
      expect(localStorage.getItem(HISTORY_KEY)).toBeNull();

      act(() => observers[0].callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(recordProductInteraction).toHaveBeenCalledWith("community_publish_prompt_shown");
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}").asks).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("credits a publish to the invitation only when sharing opened from it", async () => {
    const { tagSong, onReview } = renderPrompt();
    tagSong(1);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    expect(onReview).toHaveBeenCalledOnce();
    expect(invitation()).toBeNull();

    communityRequest.mockImplementation(async (_path, options) => ({ policy: { ...(options?.body as { policy: object }).policy, revision: 5 } }));
    await publishTags(policy() as never, "invitation");
    expect(recordProductInteraction).toHaveBeenCalledWith("community_publish_prompt_published");
    expect(recordProductInteraction).not.toHaveBeenCalledWith("community_profile_published", expect.anything());

    // A later publish opened from Sync on its own is counted separately, with where it came from.
    await publishTags(policy({ enabled: false, reviewedAt: "2026-10-17T12:00:00Z" }) as never, "sync");
    expect(recordProductInteraction).toHaveBeenCalledWith("community_profile_published", { surface: "sync" });
  });

  it("waits for five tagged songs", async () => {
    const { tagSong } = renderPrompt({ taggedTrackCount: 4 });
    tagSong(1);
    await settle();
    expect(invitation()).toBeNull();
    expect(communityRequest).not.toHaveBeenCalled();

    tagSong(2, { taggedTrackCount: 5 });
    await settle();
    expect(invitation()).toBeInTheDocument();
  });

  it("never asks a member who already chose, and stops checking", async () => {
    communityRequest.mockResolvedValue({ policy: policy({ reviewedAt: "2026-10-01T00:00:00Z", enabled: false }) });
    const { tagSong } = renderPrompt({ status: "idle" });
    tagSong(1);
    await settle();
    tagSong(2);
    await settle();

    expect(invitation()).toBeNull();
    expect(communityRequest).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}")).toMatchObject({ decided: true });
  });

  it("stays out of the way while Sync needs attention or another dialog is open", async () => {
    const reconnecting = renderPrompt({ status: "reauthorize" });
    reconnecting.tagSong(1);
    await settle();
    expect(communityRequest).not.toHaveBeenCalled();
    reconnecting.unmount();

    const busy = renderPrompt({ enabled: false });
    busy.tagSong(1);
    await settle();
    expect(invitation()).toBeNull();
    busy.tagSong(1, { enabled: true });
    await settle();
    expect(invitation()).toBeInTheDocument();
  });

  it("Not now hides it for the session and the reminder comes after two weeks, once", async () => {
    const first = renderPrompt();
    first.tagSong(1);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(invitation()).toBeNull();
    expect(recordProductInteraction).toHaveBeenCalledWith("community_publish_prompt_snoozed");
    first.tagSong(2);
    await settle();
    expect(invitation()).toBeNull();
    first.unmount();

    vi.setSystemTime(Date.parse("2026-10-17T12:00:00Z") + 13 * DAY);
    const tooSoon = renderPrompt();
    tooSoon.tagSong(1);
    await settle();
    expect(invitation()).toBeNull();
    tooSoon.unmount();

    vi.setSystemTime(Date.parse("2026-10-17T12:00:00Z") + 15 * DAY);
    const reminder = renderPrompt();
    reminder.tagSong(1);
    await settle();
    expect(invitation()).toBeInTheDocument();
    expect(recordProductInteraction).toHaveBeenCalledWith("community_publish_prompt_reminder_shown");
    reminder.unmount();

    vi.setSystemTime(Date.parse("2026-10-17T12:00:00Z") + 60 * DAY);
    communityRequest.mockClear();
    const never = renderPrompt();
    never.tagSong(1);
    await settle();
    expect(invitation()).toBeNull();
    expect(communityRequest).not.toHaveBeenCalled();
  });

  it("keeps tags private after confirming, and never asks again", async () => {
    const { tagSong } = renderPrompt();
    tagSong(1);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Keep my tags private" }));
    expect(screen.getByRole("region", { name: "Keep your tags private?" })).toHaveAccessibleDescription(
      "Tagify keeps backing up your library and won't ask again. You can publish any time from Community in Tagify.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(invitation()).toBeInTheDocument();

    communityRequest.mockImplementation(async (_path, options) => ({ policy: { ...(options?.body as { policy: object }).policy, revision: 5 } }));
    fireEvent.click(screen.getByRole("button", { name: "Keep my tags private" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep private" }));
    await advance(0);

    expect(communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy", expect.objectContaining({
      method: "PUT",
      body: expect.objectContaining({ expectedRevision: 4, policy: expect.objectContaining({ enabled: false, reviewedAt: expect.any(String), hiddenTagIds: ["secret"] }) }),
    }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(recordProductInteraction).toHaveBeenCalledWith("community_publish_kept_private");
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}")).toMatchObject({ decided: true });
  });

  it("explains a failed choice and lets the member try again", async () => {
    const { tagSong } = renderPrompt();
    tagSong(1);
    await settle();
    communityRequest.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Keep my tags private" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep private" }));
    await advance(0);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep private" })).toBeEnabled();
    expect(localStorage.getItem(HISTORY_KEY)).not.toContain("decided");
  });
});

describe("publish invitation cadence", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  it.each([
    [{ asks: 0 }, true],
    [{ asks: 1, lastAskedAt: new Date(now - 14 * DAY).toISOString() }, true],
    [{ asks: 1, lastAskedAt: new Date(now - 13 * DAY).toISOString() }, false],
    [{ asks: 1 }, false],
    [{ asks: 1, lastAskedAt: new Date(now + DAY).toISOString() }, false],
    [{ asks: 2, lastAskedAt: new Date(now - 90 * DAY).toISOString() }, false],
    [{ asks: 0, decided: true }, false],
  ])("%o → %s", (history, expected) => {
    expect(canAskToPublish(history, now)).toBe(expected);
  });
});
