import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiscoverySurvey } from "@/features/discovery-survey/hooks/useDiscoverySurvey";

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("shows survey when no prior state exists", async () => {
    const { result } = renderHook(() => useDiscoverySurvey("1.2.3"));

    await waitFor(() => {
      expect(result.current.shouldShowSurvey).toBe(true);
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
    const fetchMock = vi.mocked(fetch);

    const { result } = renderHook(() => useDiscoverySurvey("2.0.0"));

    act(() => {
      result.current.completeSurvey("friend", "discord");
    });

    await waitFor(() => {
      expect(result.current.shouldShowSurvey).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const saved = JSON.parse(store.get(SURVEY_STORAGE_KEY) || "{}");
    expect(saved.hasCompletedSurvey).toBe(true);
    expect(saved.source).toBe("friend");
    expect(saved.otherDetails).toBe("discord");
    expect(saved.surveyVersion).toBe("2.0.0");
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
});
