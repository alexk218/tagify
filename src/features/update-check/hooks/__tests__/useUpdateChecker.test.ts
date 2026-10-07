import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateChecker } from "@/features/update-check/hooks/useUpdateChecker";

const serviceMocks = vi.hoisted(() => {
  return {
    checkForUpdates: vi.fn(),
  };
});

vi.mock("@/services/VersionCheckerService", () => {
  class MockVersionCheckerService {
    constructor(
      public _currentVersion: string,
      public _repoOwner: string,
      public _repoName: string,
    ) {}

    checkForUpdates = serviceMocks.checkForUpdates;
  }

  return {
    VersionCheckerService: MockVersionCheckerService,
  };
});

describe("useUpdateChecker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    serviceMocks.checkForUpdates.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks updates on mount after delay", async () => {
    serviceMocks.checkForUpdates.mockResolvedValue({
      hasUpdate: true,
      latestVersion: "2.0.0",
    });

    const { result } = renderHook(() =>
      useUpdateChecker({
        currentVersion: "1.0.0",
        repoOwner: "owner",
        repoName: "repo",
        checkOnMount: true,
        delayMs: 250,
      }),
    );

    expect(serviceMocks.checkForUpdates).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.updateInfo?.latestVersion).toBe("2.0.0");
    });
  });

  it("supports temporary dismiss for current session", async () => {
    serviceMocks.checkForUpdates.mockResolvedValue({
      hasUpdate: true,
      latestVersion: "2.0.0",
    });

    const { result } = renderHook(() =>
      useUpdateChecker({
        currentVersion: "1.0.0",
        repoOwner: "owner",
        repoName: "repo",
        checkOnMount: false,
      }),
    );

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.updateInfo?.latestVersion).toBe("2.0.0");

    act(() => {
      result.current.dismissUpdate();
    });

    expect(result.current.updateInfo).toBeNull();

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.updateInfo).toBeNull();
  });

  it("shows a previously hidden update despite the old saved preference", async () => {
    localStorage.setItem("tagify:dismissedVersions", JSON.stringify(["3.1.0"]));
    serviceMocks.checkForUpdates.mockResolvedValue({
      hasUpdate: true,
      latestVersion: "3.1.0",
    });

    const { result } = renderHook(() =>
      useUpdateChecker({
        currentVersion: "3.0.0",
        repoOwner: "owner",
        repoName: "repo",
        checkOnMount: false,
      }),
    );

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.updateInfo?.latestVersion).toBe("3.1.0");
  });

  it("shows the update again after reopening the app", async () => {
    serviceMocks.checkForUpdates.mockResolvedValue({
      hasUpdate: true,
      latestVersion: "3.1.0",
    });
    const renderChecker = () => renderHook(() =>
      useUpdateChecker({
        currentVersion: "3.0.0",
        repoOwner: "owner",
        repoName: "repo",
        checkOnMount: false,
      }),
    );
    const firstSession = renderChecker();
    await act(async () => {
      await firstSession.result.current.checkForUpdates();
    });
    act(() => {
      firstSession.result.current.dismissUpdate();
    });
    expect(firstSession.result.current.updateInfo).toBeNull();
    firstSession.unmount();

    const nextSession = renderChecker();
    await act(async () => {
      await nextSession.result.current.checkForUpdates();
    });
    expect(nextSession.result.current.updateInfo?.latestVersion).toBe("3.1.0");
  });

  it("shows a newer release after closing an earlier one in the same session", async () => {
    serviceMocks.checkForUpdates.mockResolvedValueOnce({
      hasUpdate: true,
      latestVersion: "3.1.0",
    }).mockResolvedValueOnce({
      hasUpdate: true,
      latestVersion: "3.2.0",
    });
    const { result } = renderHook(() =>
      useUpdateChecker({
        currentVersion: "3.0.0",
        repoOwner: "owner",
        repoName: "repo",
        checkOnMount: false,
      }),
    );
    await act(async () => {
      await result.current.checkForUpdates();
    });
    act(() => {
      result.current.dismissUpdate();
    });
    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(result.current.updateInfo?.latestVersion).toBe("3.2.0");
  });
});
