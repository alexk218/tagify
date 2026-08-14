import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateChecker } from "@/features/update-check/hooks/useUpdateChecker";

const serviceMocks = vi.hoisted(() => {
  return {
    checkForUpdates: vi.fn(),
    isDismissed: vi.fn(),
    dismissVersion: vi.fn(),
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

    static isDismissed = serviceMocks.isDismissed;

    static dismissVersion = serviceMocks.dismissVersion;
  }

  return {
    VersionCheckerService: MockVersionCheckerService,
  };
});

describe("useUpdateChecker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    serviceMocks.checkForUpdates.mockReset();
    serviceMocks.isDismissed.mockReset();
    serviceMocks.dismissVersion.mockReset();
    serviceMocks.isDismissed.mockReturnValue(false);
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
      result.current.dismissUpdate(false);
    });

    expect(result.current.updateInfo).toBeNull();

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.updateInfo).toBeNull();
    expect(serviceMocks.dismissVersion).not.toHaveBeenCalled();
  });

  it("supports permanent dismiss via VersionCheckerService", async () => {
    serviceMocks.checkForUpdates.mockResolvedValue({
      hasUpdate: true,
      latestVersion: "2.1.0",
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

    act(() => {
      result.current.dismissUpdate(true);
    });

    expect(serviceMocks.dismissVersion).toHaveBeenCalledWith("2.1.0");
    expect(result.current.updateInfo).toBeNull();
  });

  it("does not surface updates that are already permanently dismissed", async () => {
    serviceMocks.checkForUpdates.mockResolvedValue({
      hasUpdate: true,
      latestVersion: "2.2.0",
    });
    serviceMocks.isDismissed.mockReturnValue(true);

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

    expect(result.current.updateInfo).toBeNull();
  });
});
