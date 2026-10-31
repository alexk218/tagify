import { beforeEach, expect, it } from "vitest";
import { isFirstRunInProgress, markFirstRunDone, markFirstRunStarted, mostUsedTag } from "../firstRun";

beforeEach(() => localStorage.clear());

it("is in progress only after the first-song card started it, and stays finished", () => {
  expect(isFirstRunInProgress()).toBe(false);
  markFirstRunStarted();
  expect(isFirstRunInProgress()).toBe(true);
  markFirstRunDone();
  markFirstRunStarted();
  expect(isFirstRunInProgress()).toBe(false);
});

it("picks the tag on the most songs and ignores deleted tags", () => {
  const tag = (id: string, name: string) => ({ id, name });
  const tagData = {
    taxonomy: { tagsById: { rock: tag("rock", "Rock"), calm: tag("calm", "Calm") } },
    tracks: {
      a: { tagIds: ["calm", "rock"] },
      b: { tagIds: ["rock", "rock", "gone"] },
      c: { tagIds: ["gone"] },
      d: { tagIds: ["gone"] },
    },
  } as unknown as Parameters<typeof mostUsedTag>[0];
  expect(mostUsedTag(tagData)).toEqual({ id: "rock", name: "Rock", songs: 2 });
  expect(mostUsedTag({ ...tagData, tracks: {} })).toBeNull();
});
