import { beforeEach, expect, it } from "vitest";
import { isFirstRunInProgress, markFirstRunDone, markFirstRunStarted, mostUsedTag, quickTags } from "../firstRun";
import { defaultTagData } from "@/constants/defaultTagData";

it("offers starter moods the library still has for one-click tagging, else its first tags", () => {
  expect(quickTags(defaultTagData.taxonomy).map((tag) => tag.name)).toEqual(["Chill", "Upbeat", "Happy", "Sad", "Party"]);
  const own = { ...defaultTagData.taxonomy, tagsById: {
    a: { id: "a", name: "Late night", subcategoryId: "s" },
    b: { id: "b", name: "chill", subcategoryId: "s" },
  } };
  expect(quickTags(own)).toEqual([{ id: "b", name: "chill" }, { id: "a", name: "Late night" }]);
});

beforeEach(() => localStorage.clear());

it("is in progress only after the first-song card started it, and stays finished", () => {
  expect(isFirstRunInProgress()).toBe(false);
  markFirstRunStarted();
  expect(isFirstRunInProgress()).toBe(true);
  markFirstRunDone();
  markFirstRunStarted();
  expect(isFirstRunInProgress()).toBe(false);
});

it("ignores and removes first-run markers saved by 3.3.3", () => {
  localStorage.setItem("tagify:first-run:v1", "started");
  expect(isFirstRunInProgress()).toBe(false);
  expect(localStorage.getItem("tagify:first-run:v1")).toBeNull();
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
