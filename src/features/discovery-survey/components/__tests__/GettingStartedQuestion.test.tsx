import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordProductEvent } from "@/features/product-analytics/productAnalytics";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { GettingStartedQuestion } from "../GettingStartedQuestion";
import { finishQuestion, noteOpeningAndCheckDue } from "../../services/gettingStartedQuestion";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductEvent: vi.fn(),
}));
vi.mock("../../services/tagifyUsage", () => ({ getUsageAccountDigest: async () => "a".repeat(64) }));

const account = "a".repeat(64);
const DAY = 86400000;

describe("getting-started question timing", () => {
  beforeEach(() => localStorage.clear());

  it("waits for a second day, then asks until answered", () => {
    const first = Date.parse("2026-10-20T10:00:00Z");
    expect(noteOpeningAndCheckDue(account, first)).toBe(false);
    expect(noteOpeningAndCheckDue(account, first + 3600000)).toBe(false);
    expect(noteOpeningAndCheckDue(account, first + DAY)).toBe(true);
    expect(noteOpeningAndCheckDue(account, first + 3 * DAY)).toBe(true);
    finishQuestion(account);
    expect(noteOpeningAndCheckDue(account, first + 4 * DAY)).toBe(false);
  });

  it("keeps accounts apart", () => {
    const first = Date.parse("2026-10-20T10:00:00Z");
    noteOpeningAndCheckDue(account, first);
    expect(noteOpeningAndCheckDue("b".repeat(64), first + DAY)).toBe(false);
  });
});

describe("GettingStartedQuestion", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(recordProductEvent).mockClear();
    localStorage.setItem(`tagify:getting-started-question:v1:${account}`, JSON.stringify({ firstDay: "2026-01-01" }));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("asks with the fixed choices, records the answer and doesn't come back", async () => {
    vi.spyOn(indexedDBStorage, "getTrackCount").mockResolvedValue(0);
    const { unmount } = render(<GettingStartedQuestion />);
    expect(await screen.findByRole("heading", { name: "What's stopping you from tagging?" })).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Not now", "I'm not sure where to start", "My library feels too big to tag", "I was just looking around", "Something didn't work", "Something else",
    ]);
    // Recorded in an effect just after the question appears, so it can land a moment after the heading.
    await waitFor(() => expect(recordProductEvent).toHaveBeenCalledWith(account, "start_reason_shown"));
    fireEvent.click(screen.getByRole("button", { name: "My library feels too big to tag" }));
    expect(recordProductEvent).toHaveBeenCalledWith(account, "start_reason_answered", { start_reason: "library_too_big" });
    expect(screen.queryByRole("heading")).toBeNull();
    unmount();
    render(<GettingStartedQuestion />);
    await waitFor(() => expect(indexedDBStorage.getTrackCount).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("records Not now as a dismissal", async () => {
    vi.spyOn(indexedDBStorage, "getTrackCount").mockResolvedValue(0);
    render(<GettingStartedQuestion />);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(recordProductEvent).toHaveBeenLastCalledWith(account, "start_reason_dismissed", {});
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it.each([["has saved songs", () => Promise.resolve(3)], ["can't be read", () => Promise.reject(new Error("unreadable"))]])(
    "stays hidden when the library %s", async (_label, count) => {
      vi.spyOn(indexedDBStorage, "getTrackCount").mockImplementation(count as () => Promise<number>);
      render(<GettingStartedQuestion />);
      await waitFor(() => expect(indexedDBStorage.getTrackCount).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByRole("heading")).toBeNull();
      expect(recordProductEvent).not.toHaveBeenCalled();
    });
});
