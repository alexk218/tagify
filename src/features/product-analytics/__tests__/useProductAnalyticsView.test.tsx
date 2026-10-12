import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useProductAnalyticsView } from "../useProductAnalyticsView";
import type { ProductEventName } from "../productAnalytics";

const mocks = vi.hoisted(() => ({ account: vi.fn(), record: vi.fn() }));
vi.mock("@/features/discovery-survey/services/tagifyUsage", () => ({ getUsageAccountDigest: mocks.account }));
vi.mock("../productAnalytics", () => ({ recordProductEvent: mocks.record }));
beforeEach(() => { mocks.account.mockReset().mockResolvedValue("a".repeat(64)); mocks.record.mockClear(); });

it("records feature entry once per view change, without entity or content properties", async () => {
  const { rerender } = renderHook(({ event }: { event: ProductEventName | null }) => useProductAnalyticsView(event), { initialProps: { event: "tracks_viewed" as ProductEventName | null } });
  await waitFor(() => expect(mocks.record).toHaveBeenCalledWith("a".repeat(64), "tracks_viewed"));
  rerender({ event: "tracks_viewed" });
  expect(mocks.record).toHaveBeenCalledTimes(1);
  rerender({ event: "export_requested" });
  await waitFor(() => expect(mocks.record).toHaveBeenCalledWith("a".repeat(64), "export_requested"));
  expect(mocks.record.mock.calls.every(call => call.length === 2)).toBe(true);
});

it("ignores a view closed before account lookup completes", async () => {
  let finish!: (account: string) => void;
  mocks.account.mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
  const { unmount } = renderHook(() => useProductAnalyticsView("community_opened"));
  unmount(); finish("a".repeat(64));
  await Promise.resolve();
  expect(mocks.record).not.toHaveBeenCalled();
});
