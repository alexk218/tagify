import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FirstRunTip, firstRunTipCopy } from "../FirstRunTip";
import { howToTipCopy } from "../../howToTips";

vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
afterEach(() => document.body.replaceChildren());

const handlers = () => ({ onShown: vi.fn(), onGotIt: vi.fn(), onSkip: vi.fn() });

it("tip 1 says what tags can be", () => {
  expect(firstRunTipCopy("tag")).toMatchObject({
    title: "Tag the song that's playing",
    body: "Moods, genres, feelings, whatever you want. Then pick a few tags and get a playlist of exactly those songs.",
  });
});

it("tip 2 names the count only when one is known", () => {
  expect(firstRunTipCopy("others", { othersFound: 12 }).title).toBe("People already tagged 12 of your songs");
  expect(firstRunTipCopy("others").title).toBe("Songs other people tagged");
});

it("tip 1 points at the first tag button, then rating", () => {
  expect(firstRunTipCopy("tag")).toMatchObject({ anchor: "tag-button", fallback: { anchor: "tag-picker" } });
  expect(firstRunTipCopy("rate")).toMatchObject({ anchor: "rate", title: "Rate it here" });
});

it("the tour points at Manage Tags and the Tagged Tracks list", () => {
  expect(firstRunTipCopy("manage")).toMatchObject({ anchor: "manage-tags", title: "Make the tags your own" });
  expect(firstRunTipCopy("tagged")).toMatchObject({ anchor: "tagged-tab", body: "Every song you tag shows up here. Click one to change its tags." });
});

it("points at the fallback control while its own isn't on screen, and clicking it isn't the action", () => {
  const tab = document.createElement("button");
  tab.dataset.tip = "tagged-tab";
  document.body.append(tab);
  const onAnchorClick = vi.fn();
  render(<FirstRunTip {...handlers()} {...howToTipCopy("playlist")} onAnchorClick={onAnchorClick} />);
  expect(screen.getByRole("heading", { hidden: true }).textContent).toBe("Make a playlist from your tags");
  expect(screen.getByText(/^On Tagged Tracks/)).toBeTruthy();
  tab.click();
  expect(onAnchorClick).not.toHaveBeenCalled();
});
