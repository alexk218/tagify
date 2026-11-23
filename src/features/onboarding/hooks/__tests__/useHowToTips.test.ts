import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const record = vi.hoisted(() => vi.fn());
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: record }));

import { useHowToTips, HOW_TO_WAIT_MS, type HowToTipsInput } from "../useHowToTips";
import { FIRST_RUN_TIPS_KEY, markTipDone, markTipShown, readFirstRunTips, updateFirstRunTips, type FirstRunTipsState } from "../../firstRunTips";
import { notePlaylistMade } from "../../howToTips";

const STARTED_AT_KEY = "tagify:first-run-tips:started-at";

const input = (overrides: Partial<HowToTipsInput> = {}): HowToTipsInput => ({
  enabled: true, coreTipPending: false, mostSongsOnOneTag: 1, smartPlaylists: 0, ...overrides,
});

const seed = (state: Partial<FirstRunTipsState>) =>
  localStorage.setItem(FIRST_RUN_TIPS_KEY, JSON.stringify({ shown: ["tag"], done: { play: "action", tag: "action", rate: "got_it", manage: "got_it", tagged: "got_it", others: "got_it" }, skipped: false, ...state }));

const render = (initial: HowToTipsInput) =>
  renderHook((props: HowToTipsInput) => useHowToTips(props), { initialProps: initial });

beforeEach(() => {
  // The tips started on this device well over a minute ago.
  localStorage.setItem(STARTED_AT_KEY, String(Date.now() - 10 * HOW_TO_WAIT_MS));
  seed({});
});
afterEach(() => {
  localStorage.clear();
  record.mockReset();
  vi.useRealTimers();
});

it("shows each later tip at its moment, and doing the thing finishes it", () => {
  const { result, rerender } = render(input({ mostSongsOnOneTag: 4 }));
  expect(result.current).toBeNull();

  // 5 songs share a tag: a playlist from tags. Making one finishes it.
  rerender(input({ mostSongsOnOneTag: 5 }));
  expect(result.current).toBe("playlist");
  act(() => { updateFirstRunTips((current) => markTipShown(current, "playlist")); });

  // The first playlist made from the filters: Smart Playlists. Making one finishes it.
  act(() => notePlaylistMade());
  rerender(input({ mostSongsOnOneTag: 5 }));
  expect(result.current).toBe("smart");
  rerender(input({ mostSongsOnOneTag: 5, smartPlaylists: 1 }));
  expect(result.current).toBeNull();

  expect(readFirstRunTips().done).toMatchObject({ playlist: "action", smart: "action" });
  // Only the tip that was on screen sends events.
  expect(record.mock.calls.map(([, details]) => details.tip)).toEqual(["playlist", "playlist"]);
});

it("waits for the tour and for the first minute after the tips started", () => {
  vi.useFakeTimers();
  localStorage.setItem(STARTED_AT_KEY, String(Date.now()));
  const { result, rerender } = render(input({ mostSongsOnOneTag: 5, coreTipPending: true }));
  expect(result.current).toBeNull();
  rerender(input({ mostSongsOnOneTag: 5 }));
  expect(result.current).toBeNull();
  act(() => { vi.advanceTimersByTime(HOW_TO_WAIT_MS); });
  expect(result.current).toBe("playlist");
  rerender(input({ mostSongsOnOneTag: 5, coreTipPending: true }));
  expect(result.current).toBeNull();
});

it("Skip tips ends them, a library from before the tips gets none, and each shows once per device", () => {
  seed({ skipped: true });
  expect(render(input({ mostSongsOnOneTag: 20 })).result.current).toBeNull();

  seed({ shown: [] });
  expect(render(input({ mostSongsOnOneTag: 20 })).result.current).toBeNull();
  // Show tips again lets them run for that library too.
  seed({ shown: [], done: { tag: "action" }, again: true });
  expect(render(input({ mostSongsOnOneTag: 20 })).result.current).toBe("playlist");

  seed({ shown: ["tag", "playlist"], done: { play: "action", tag: "action" } });
  const { result } = render(input({ mostSongsOnOneTag: 5 }));
  expect(result.current).toBe("playlist");
  // Got it on a tip another hook saved keeps this one in step.
  act(() => { updateFirstRunTips((current) => markTipDone(current, "playlist", "got_it")); });
  expect(result.current).toBeNull();
});
