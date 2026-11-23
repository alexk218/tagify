import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const record = vi.hoisted(() => vi.fn());
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: record }));

import { useFirstRunTips, type FirstRunTipsInput } from "../useFirstRunTips";
import { FIRST_RUN_TIPS_KEY, showFirstRunTipsAgain } from "../../firstRunTips";

const input = (overrides: Partial<FirstRunTipsInput> = {}): FirstRunTipsInput => ({
  enabled: true, songShowing: false, songLocked: false, taggedSongs: 0, ratedSongs: 0, tagManagerOpen: false, othersTab: true, ...overrides,
});

afterEach(() => {
  localStorage.clear();
  record.mockReset();
});

it("asks for a song first, then rating once one plays, then the tag buttons, and on to Manage Tags once a song is tagged", () => {
  const { result, rerender } = renderHook((props: FirstRunTipsInput) => useFirstRunTips(props), { initialProps: input() });
  expect(result.current.tip).toBe("play");
  act(() => result.current.shown("play"));

  rerender(input({ songShowing: true }));
  expect(result.current.tip).toBe("rate");
  expect(record).toHaveBeenCalledWith("first_run_tip_done", { tip: "play", how: "action" });
  rerender(input({ songShowing: true, ratedSongs: 1 }));
  expect(result.current.tip).toBe("tag");
  act(() => result.current.shown("tag"));

  rerender(input({ songShowing: true, ratedSongs: 1, taggedSongs: 1 }));
  expect(result.current.tip).toBe("manage");
  expect(record).toHaveBeenCalledWith("first_run_tip_done", { tip: "tag", how: "action" });
});

it("runs the tour back to back on Got it: rating, tag, Manage Tags, Tagged Tracks, Tagged by others last", () => {
  const { result } = renderHook(() => useFirstRunTips(input({ songShowing: true })));
  for (const tip of ["rate", "tag", "manage", "tagged", "others"] as const) {
    expect(result.current.tip).toBe(tip);
    act(() => result.current.shown(tip));
    act(() => result.current.gotIt(tip));
  }
  expect(result.current.tip).toBeNull();
});

it("rating a song, opening Manage Tags and clicking a song finish their tips", () => {
  const { result, rerender } = renderHook((props: FirstRunTipsInput) => useFirstRunTips(props), { initialProps: input({ songShowing: true }) });
  expect(result.current.tip).toBe("rate");
  rerender(input({ songShowing: true, ratedSongs: 1 }));
  expect(result.current.tip).toBe("tag");
  act(() => result.current.shown("tag"));
  act(() => result.current.gotIt("tag"));
  expect(result.current.tip).toBe("manage");
  rerender(input({ songShowing: true, ratedSongs: 1, tagManagerOpen: true }));
  expect(result.current.tip).toBe("tagged");
  rerender(input({ songShowing: true, ratedSongs: 1, songLocked: true }));
  expect(result.current.tip).toBe("others");
});

it("ends with Tagged Tracks when there is no Tagged by others tab", () => {
  const { result } = renderHook(() => useFirstRunTips(input({ songShowing: true, othersTab: false })));
  for (const tip of ["rate", "tag", "manage", "tagged"] as const) {
    act(() => result.current.shown(tip));
    act(() => result.current.gotIt(tip));
  }
  expect(result.current.tip).toBeNull();
});

it("Got it on Play any song moves on to the list tips; the song tips come once a song plays", () => {
  const { result, rerender } = renderHook((props: FirstRunTipsInput) => useFirstRunTips(props), { initialProps: input() });
  act(() => result.current.shown("play"));
  act(() => result.current.gotIt("play"));
  expect(result.current.tip).toBe("tagged");
  rerender(input({ songShowing: true }));
  expect(result.current.tip).toBe("rate");
});

it("Skip tips ends every tip on this device, and nothing shows while prompts are held back", () => {
  const { result, rerender } = renderHook((props: FirstRunTipsInput) => useFirstRunTips(props), {
    initialProps: input({ songShowing: true }),
  });
  rerender(input({ enabled: false, songShowing: true }));
  expect(result.current.tip).toBeNull();
  rerender(input({ songShowing: true }));
  act(() => result.current.shown("rate"));
  act(() => result.current.skip("rate"));
  expect(result.current.tip).toBeNull();
  expect(JSON.parse(localStorage.getItem(FIRST_RUN_TIPS_KEY) ?? "{}").skipped).toBe(true);
  expect(record).toHaveBeenCalledWith("first_run_tip_done", { tip: "rate", how: "skipped" });
});

it("never runs the tour for a library from before the tips, even with a song showing", () => {
  const before = renderHook(() => useFirstRunTips(input({ taggedSongs: 30 })));
  expect(before.result.current.tip).toBeNull();
  localStorage.clear();
  // A song in track details on the very first render: no rating tip flashes up for an existing library.
  const playing = renderHook(() => useFirstRunTips(input({ taggedSongs: 30, songShowing: true })));
  expect(playing.result.current.tip).toBeNull();
  expect(JSON.parse(localStorage.getItem(FIRST_RUN_TIPS_KEY) ?? "{}").shown ?? []).toEqual([]);
  expect(record).not.toHaveBeenCalled();
});

it("Show tips again starts over, and songs tagged before it don't finish tip 1", () => {
  const { result, rerender } = renderHook((props: FirstRunTipsInput) => useFirstRunTips(props), {
    initialProps: input({ songShowing: true, taggedSongs: 30 }),
  });
  expect(result.current.tip).toBeNull();

  act(() => showFirstRunTipsAgain());
  rerender(input({ songShowing: true, taggedSongs: 30 }));
  expect(result.current.tip).toBe("rate");
  expect(JSON.parse(localStorage.getItem(FIRST_RUN_TIPS_KEY) ?? "{}").baseline).toBe(30);

  rerender(input({ songShowing: true, taggedSongs: 31 }));
  expect(result.current.tip).toBe("rate");
});
