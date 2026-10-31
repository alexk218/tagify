import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstRunPayoffCard } from "../FirstRunPayoffCard";
const { recordProductInteraction } = vi.hoisted(() => ({ recordProductInteraction: vi.fn() }));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction }));
const rock = { id: "rock", name: "Rock", songs: 3 };
const handlers = () => ({ onShowSongs: vi.fn(), onMakePlaylist: vi.fn(), onDismiss: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); });

it("offers the most-used tag as a filter, then a playlist", async () => {
  const props = handlers();
  const { rerender } = render(<FirstRunPayoffCard taggedSongs={3} tag={rock} filtered={false} {...props} />);
  expect(screen.getByRole("heading", { name: "3 songs tagged. Now find them again" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Show my Rock songs" }));
  expect(props.onShowSongs).toHaveBeenCalledTimes(1);
  expect(recordProductInteraction).toHaveBeenCalledWith("first_run_payoff_reached", { payoff_action: "filter" });

  rerender(<FirstRunPayoffCard taggedSongs={3} tag={rock} filtered {...props} />);
  expect(screen.getByRole("button", { name: "Showing Rock" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Make a playlist" }));
  expect(props.onMakePlaylist).toHaveBeenCalledTimes(1);
  expect(recordProductInteraction).toHaveBeenCalledWith("first_run_payoff_reached", { payoff_action: "playlist" });
  expect(recordProductInteraction.mock.calls.filter(([event]) => event === "first_run_payoff_shown")).toHaveLength(1);
});

it("can be hidden", async () => {
  const props = handlers();
  render(<FirstRunPayoffCard taggedSongs={4} tag={rock} filtered={false} {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Hide this tip" }));
  expect(props.onDismiss).toHaveBeenCalledTimes(1);
  expect(props.onMakePlaylist).not.toHaveBeenCalled();
});
