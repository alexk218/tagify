import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useFirstRun } from "../useFirstRun";

type Options = Parameters<typeof useFirstRun>[0];
const taxonomy = { tagsById: { rock: { id: "rock", name: "Rock" } } } as unknown as Options["tagData"]["taxonomy"];
const library = (songs: number): Options["tagData"] => ({
  taxonomy,
  tracks: Object.fromEntries(Array.from({ length: songs }, (_, index) => [`spotify:track:${index}`, { tagIds: ["rock"] }])) as Options["tagData"]["tracks"],
});
const render = (initial: Options) => renderHook((options: Options) => useFirstRun(options), { initialProps: initial });

beforeEach(() => localStorage.clear());

it("never starts a first run or shows either card for a tagged library that loads after the first render", () => {
  const hook = render({ tagData: library(0), isLoading: true, isMultiTagging: false });
  expect(hook.result.current.showFirstSongCard).toBe(false);
  hook.rerender({ tagData: library(845), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.showFirstSongCard).toBe(false);
  expect(hook.result.current.payoffTag).toBeNull();
  expect(Object.keys(localStorage).filter((key) => key.startsWith("tagify:first-run"))).toEqual([]);
});

it("drops a 3.3.3 first-run marker, so an existing library no longer gets the payoff", () => {
  localStorage.setItem("tagify:first-run:v1", "started");
  const hook = render({ tagData: library(845), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.payoffTag).toBeNull();
  expect(localStorage.getItem("tagify:first-run:v1")).toBeNull();
});

it("shows the payoff after an empty library picks its first song and tags three", () => {
  const hook = render({ tagData: library(0), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.showFirstSongCard).toBe(true);
  act(() => hook.result.current.startFirstRun());
  expect(hook.result.current.showFirstSongCard).toBe(false);
  hook.rerender({ tagData: library(2), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.payoffTag).toBeNull();
  hook.rerender({ tagData: library(3), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.payoffTag).toEqual({ id: "rock", name: "Rock", songs: 3 });
  act(() => hook.result.current.finishFirstRun());
  expect(hook.result.current.payoffTag).toBeNull();
});

it("only counts an empty library once its tag data has loaded", () => {
  const hook = render({ tagData: library(0), isLoading: true, isMultiTagging: false });
  expect(hook.result.current.showFirstSongCard).toBe(false);
  hook.rerender({ tagData: library(0), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.showFirstSongCard).toBe(true);
  // Seeing the card is not starting: someone who tags elsewhere never gets the payoff.
  hook.rerender({ tagData: library(3), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.payoffTag).toBeNull();
});

it("keeps the card open while members' tags go on songs, then hands over to the payoff", () => {
  const hook = render({ tagData: library(0), isLoading: false, isMultiTagging: false });
  act(() => hook.result.current.startWithMembersTags());
  hook.rerender({ tagData: library(2), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.showFirstSongCard).toBe(true);
  expect(hook.result.current.payoffTag).toBeNull();
  hook.rerender({ tagData: library(3), isLoading: false, isMultiTagging: false });
  expect(hook.result.current.showFirstSongCard).toBe(false);
  expect(hook.result.current.payoffTag).toMatchObject({ id: "rock", songs: 3 });
});
