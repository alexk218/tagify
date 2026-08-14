import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePowerUserModal } from "@/features/power-user/hooks/usePowerUserModal";

const POWER_USER_STORAGE_KEY = "tagify:powerUserModal";

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

describe("usePowerUserModal", () => {
  beforeEach(() => {
    createStorageMock();
  });

  it("shows modal once threshold is crossed on a new track-added event", async () => {
    const { result, rerender } = renderHook(
      ({ taggedTrackCount, eventId }) =>
        usePowerUserModal({
          taggedTrackCount,
          lastUserTrackAddedEvent: eventId ? { eventId } : null,
          threshold: 3,
        }),
      {
        initialProps: {
          taggedTrackCount: 2,
          eventId: 1,
        },
      },
    );

    expect(result.current.shouldShowPowerUserModal).toBe(false);

    rerender({
      taggedTrackCount: 3,
      eventId: 2,
    });

    await waitFor(() => {
      expect(result.current.shouldShowPowerUserModal).toBe(true);
    });
  });

  it("does not show when user already dismissed previously", async () => {
    createStorageMock({
      [POWER_USER_STORAGE_KEY]: JSON.stringify({ hasDismissed: true }),
    });

    const { result } = renderHook(() =>
      usePowerUserModal({
        taggedTrackCount: 100,
        lastUserTrackAddedEvent: { eventId: 1 },
        threshold: 3,
      }),
    );

    await waitFor(() => {
      expect(result.current.hasDismissedPowerUserModal).toBe(true);
    });
    expect(result.current.shouldShowPowerUserModal).toBe(false);
  });

  it("dismisses modal and persists dismissal", async () => {
    const store = createStorageMock();

    const { result } = renderHook(() =>
      usePowerUserModal({
        taggedTrackCount: 10,
        lastUserTrackAddedEvent: { eventId: 1 },
        threshold: 3,
      }),
    );

    await waitFor(() => {
      expect(result.current.shouldShowPowerUserModal).toBe(true);
    });

    act(() => {
      result.current.dismissPowerUserModal();
    });

    expect(result.current.shouldShowPowerUserModal).toBe(false);
    expect(result.current.hasDismissedPowerUserModal).toBe(true);

    const saved = JSON.parse(store.get(POWER_USER_STORAGE_KEY) || "{}");
    expect(saved.hasDismissed).toBe(true);
    expect(typeof saved.dismissedAt).toBe("string");
  });

  it("ignores repeated processing of the same event id", () => {
    const { result, rerender } = renderHook(
      ({ taggedTrackCount, eventId }) =>
        usePowerUserModal({
          taggedTrackCount,
          lastUserTrackAddedEvent: eventId ? { eventId } : null,
          threshold: 3,
        }),
      {
        initialProps: {
          taggedTrackCount: 3,
          eventId: 1,
        },
      },
    );

    expect(result.current.shouldShowPowerUserModal).toBe(true);

    act(() => {
      result.current.dismissPowerUserModal();
    });

    rerender({
      taggedTrackCount: 10,
      eventId: 1,
    });

    expect(result.current.shouldShowPowerUserModal).toBe(false);
  });
});
