import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiscoverySurvey } from "@/features/discovery-survey/hooks/useDiscoverySurvey";

const { recordDiscoveryAnswer, history } = vi.hoisted(() => ({
  recordDiscoveryAnswer: vi.fn().mockResolvedValue(true),
  history: { ready: true, accountDigest: null as string | null, discoverySurveyDismissed: false, markSeen: vi.fn() },
}));
vi.mock("../../services/tagifyUsage", () => ({ recordDiscoveryAnswer, getUsageAccountDigest: vi.fn().mockResolvedValue(null) }));
vi.mock("@/features/onboarding/hooks/usePromptHistory", () => ({ usePromptHistory: () => history }));

const SURVEY_STORAGE_KEY = "tagify:discoverySurvey";

function createStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));

  vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
    return store.has(key) ? store.get(key)! : null;
  });

  vi.mocked(localStorage.setItem).mockImplementation((key: string, value: string) => {
    store.set(key, value);
  });

  return store;
}

describe("useDiscoverySurvey", () => {
  beforeEach(() => {
    createStorageMock();
    recordDiscoveryAnswer.mockClear();
    Object.assign(history, { ready: true, accountDigest: null, discoverySurveyDismissed: false });
    history.markSeen.mockClear();
  });

  it("does not show the survey on first opening", async () => {
    const { result } = renderHook(() => useDiscoverySurvey("1.2.3"));

    await waitFor(() => {
      expect(result.current.shouldShowSurvey).toBe(false);
    });
    expect(result.current.skipCount).toBe(0);
  });

  it("hides survey when previously completed", async () => {
    createStorageMock({
      [SURVEY_STORAGE_KEY]: JSON.stringify({
        hasCompletedSurvey: true,
        surveyVersion: "1.0.0",
        skipCount: 2,
      }),
    });

    const { result } = renderHook(() => useDiscoverySurvey("1.2.3"));

    await waitFor(() => {
      expect(result.current.shouldShowSurvey).toBe(false);
    });
    expect(result.current.skipCount).toBe(2);
  });

  it("persists completion and posts discovery payload", async () => {
    const store = createStorageMock();

    const { result } = renderHook(() => useDiscoverySurvey("2.0.0"));

    act(() => {
      result.current.completeSurvey("friend", "discord");
    });

    await waitFor(() => {
      expect(result.current.shouldShowSurvey).toBe(false);
      expect(recordDiscoveryAnswer).toHaveBeenCalledTimes(1);
    });

    const saved = JSON.parse(store.get(SURVEY_STORAGE_KEY) || "{}");
    expect(saved.hasCompletedSurvey).toBe(true);
    expect(saved.source).toBe("friend");
    expect(saved.otherDetails).toBe("discord");
    expect(saved.surveyVersion).toBe("2.0.0");

    expect(recordDiscoveryAnswer).toHaveBeenCalledWith("2.0.0", { source: "friend", otherDetails: "discord" }, null);
  });

  it("increments skip count and hides survey", async () => {
    const store = createStorageMock({
      [SURVEY_STORAGE_KEY]: JSON.stringify({
        hasCompletedSurvey: false,
        surveyVersion: "1.0.0",
        skipCount: 1,
      }),
    });

    const { result } = renderHook(() => useDiscoverySurvey("2.0.0"));

    act(() => {
      result.current.skipSurvey();
    });

    await waitFor(() => {
      expect(result.current.shouldShowSurvey).toBe(false);
    });
    expect(result.current.skipCount).toBe(2);

    const saved = JSON.parse(store.get(SURVEY_STORAGE_KEY) || "{}");
    expect(saved.skipCount).toBe(2);
    expect(saved.hasCompletedSurvey).toBe(false);
    expect(saved.hasDismissedSurvey).toBe(true);
    expect(typeof saved.lastSkippedAt).toBe("string");
  });

  it("does not show the survey again after it was skipped", async () => {
    createStorageMock({
      [SURVEY_STORAGE_KEY]: JSON.stringify({
        hasCompletedSurvey: false,
        surveyVersion: "1.0.0",
        skipCount: 1,
        lastSkippedAt: "2026-08-01T12:00:00.000Z",
      }),
    });

    const { result } = renderHook(() => useDiscoverySurvey("2.0.0"));

    await waitFor(() => {
      expect(result.current.shouldShowSurvey).toBe(false);
    });
  });
  it("waits for five distinct manually added songs, including a batch", () => {
    const { result, rerender } = renderHook(({ event }) => useDiscoverySurvey("3.0.0", { lastUserTrackAddedEvent: event }), {
      initialProps: { event: null as null | { eventId: number; trackUris: string[] } },
    });
    rerender({ event: { eventId: 1, trackUris: ["one", "two", "three", "four"] } });
    expect(result.current.shouldShowSurvey).toBe(false);
    rerender({ event: { eventId: 2, trackUris: ["four"] } });
    expect(result.current.shouldShowSurvey).toBe(false);
    rerender({ event: { eventId: 3, trackUris: ["five"] } });
    expect(result.current.shouldShowSurvey).toBe(true);
  });

  it("remembers progress between visits and waits until another dialog closes", () => {
    createStorageMock({ [SURVEY_STORAGE_KEY]: JSON.stringify({ hasCompletedSurvey: false, taggedSongUris: ["one", "two", "three", "four"] }) });
    const { result, rerender } = renderHook(({ canShow }) => useDiscoverySurvey("3.0.0", {
      canShowSurvey: canShow, lastUserTrackAddedEvent: { eventId: 1, trackUris: ["five"] },
    }), { initialProps: { canShow: false } });
    expect(result.current.shouldShowSurvey).toBe(false);
    rerender({ canShow: true });
    expect(result.current.shouldShowSurvey).toBe(true);
  });

  it("does not undo an old dismissal even after the milestone", () => {
    createStorageMock({ [SURVEY_STORAGE_KEY]: JSON.stringify({ hasDismissedSurvey: true, taggedSongUris: ["one", "two", "three", "four", "five"] }) });
    const { result } = renderHook(() => useDiscoverySurvey("3.0.0"));
    expect(result.current.shouldShowSurvey).toBe(false);
  });

  it("waits for account history before showing discovery and honors a recovered skip", () => {
    createStorageMock({ [SURVEY_STORAGE_KEY]: JSON.stringify({ taggedSongUris: ["one", "two", "three", "four", "five"] }) });
    history.ready = false;
    const { result, rerender } = renderHook(() => useDiscoverySurvey("3.0.0"));
    expect(result.current.shouldShowSurvey).toBe(false);
    history.ready = true;
    history.discoverySurveyDismissed = true;
    rerender();
    expect(result.current.shouldShowSurvey).toBe(false);
    history.discoverySurveyDismissed = false;
    rerender();
    expect(result.current.shouldShowSurvey).toBe(true);
  });

  it("keeps progress and answers with the account that supplied them", () => {
    const a = "a".repeat(64), b = "b".repeat(64);
    history.accountDigest = a;
    const store = createStorageMock({ [`${SURVEY_STORAGE_KEY}:${a}`]: JSON.stringify({ taggedSongUris: ["one", "two", "three", "four", "five"] }) });
    const { result, rerender } = renderHook(() => useDiscoverySurvey("3.0.0"));
    expect(result.current.shouldShowSurvey).toBe(true);
    act(() => result.current.completeSurvey("friend"));
    expect(recordDiscoveryAnswer).toHaveBeenCalledWith("3.0.0", { source: "friend", otherDetails: undefined }, a);
    expect(history.markSeen).toHaveBeenCalledWith("discoverySurveyDismissed");
    expect(JSON.parse(store.get(`${SURVEY_STORAGE_KEY}:${a}`) || "{}").hasCompletedSurvey).toBe(true);
    history.accountDigest = b;
    rerender();
    expect(result.current.shouldShowSurvey).toBe(false);
    expect(result.current.skipCount).toBe(0);
    history.accountDigest = a;
    rerender();
    expect(result.current.shouldShowSurvey).toBe(false);
  });

  it("keeps the five-song milestone while Spotify is still resolving the account", () => {
    const store = createStorageMock();
    history.ready = false;
    const { result, rerender } = renderHook(({ event }) => useDiscoverySurvey("3.0.0", { lastUserTrackAddedEvent: event }), {
      initialProps: { event: null as null | { eventId: number; trackUris: string[] } },
    });
    const event = { eventId: 1, trackUris: ["one", "two", "three", "four", "five"] };
    rerender({ event });
    expect(result.current.shouldShowSurvey).toBe(false);
    history.accountDigest = "a".repeat(64);
    history.ready = true;
    rerender({ event });
    expect(result.current.shouldShowSurvey).toBe(true);
    expect(JSON.parse(store.get(`${SURVEY_STORAGE_KEY}:${history.accountDigest}`) || "{}").taggedSongUris).toHaveLength(5);
    expect(store.has(SURVEY_STORAGE_KEY)).toBe(false);
  });

});
