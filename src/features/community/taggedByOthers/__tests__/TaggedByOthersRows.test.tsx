import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CommunityMatch, CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import { TAGS_SHOWN, TaggedByOthersRows, mergeSameTags, type MergedTag } from "../TaggedByOthersRows";

const tag = (label: string, people = 1): CommunityMatchTag => ({ label, paths: [`Genre / ${label}`], people });
const song = (tags: CommunityMatchTag[]): CommunityMatch => ({
  track: { uri: "spotify:track:1", name: "Bring Me To Life", artists: [{ name: "Evanescence" }], album: { name: "Fallen" }, duration_ms: 1 },
  tags,
});

describe("members' tags on a song", () => {
  it("merges the same tag in different spellings, counts them together and names it the most-used way", () => {
    const merged = mergeSameTags([tag("Rock", 3), tag("nu metal", 2), tag("Nu Metal", 2), tag("Nu-metal", 1), tag("Angry"), tag("angry")]);
    expect(merged.map((item) => [item.label, item.people])).toEqual([["nu metal", 5], ["Rock", 3], ["Angry", 2]]);
    expect(merged[0].spellings).toEqual(["nu metal", "Nu Metal", "Nu-metal"]);
    expect(merged[0].paths).toEqual(["Genre / nu metal", "Genre / Nu Metal", "Genre / Nu-metal"]);
  });

  it("shows the most-used tags first, with counts, and the rest behind +N more", () => {
    const tags = [tag("Rock", 8), tag("Metal", 5), ...Array.from({ length: 20 }, (_, index) => tag(`Tag ${index}`))];
    render(<TaggedByOthersRows matches={[song(tags)]} onToggleTag={vi.fn()} coverOf={() => undefined} hasTag={() => false} detailOf={() => "Tagged by @ana +7"} />);

    const row = screen.getByRole("listitem");
    expect(within(row).getAllByRole("button", { name: /^Add / })).toHaveLength(TAGS_SHOWN);
    expect(within(row).getByRole("button", { name: "Add Rock to Bring Me To Life" })).toHaveTextContent("Rock8");
    expect(within(row).getByText("Evanescence")).toBeInTheDocument();
    expect(within(row).getByText("Tagged by @ana +7")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Show 16 more tags for Bring Me To Life" }));
    expect(within(row).getAllByRole("button", { name: /^Add / })).toHaveLength(22);
    fireEvent.click(within(row).getByRole("button", { name: "Show fewer tags for Bring Me To Life" }));
    expect(within(row).getAllByRole("button", { name: /^Add / })).toHaveLength(TAGS_SHOWN);
  });

  it("turns a members' tag on and off again under the name most members used", async () => {
    const onToggleTag = vi.fn().mockResolvedValue(undefined);
    const on = new Set<string>(["Nu Metal"]);
    const props = { matches: [song([tag("Nu Metal", 3), tag("nu-metal"), tag("Rock", 2)])], onToggleTag, coverOf: () => undefined,
      hasTag: (_match: CommunityMatch, item: MergedTag) => on.has(item.label), detailOf: () => "" };
    const { rerender } = render(<TaggedByOthersRows {...props} />);

    const nuMetal = screen.getByRole("button", { name: "Remove Nu Metal from Bring Me To Life" });
    expect(nuMetal).toHaveAttribute("aria-pressed", "true");
    expect(nuMetal).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add Rock to Bring Me To Life" }));
    await waitFor(() => expect(onToggleTag).toHaveBeenCalledTimes(1));
    expect(onToggleTag.mock.calls[0][1]).toMatchObject({ label: "Rock", paths: ["Genre / Rock"], people: 2 });
    expect(onToggleTag.mock.calls[0][2]).toBe(true);

    on.add("Rock");
    rerender(<TaggedByOthersRows {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove Rock from Bring Me To Life" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Remove Rock from Bring Me To Life" }));
    await waitFor(() => expect(onToggleTag).toHaveBeenCalledTimes(2));
    expect(onToggleTag.mock.calls[1][2]).toBe(false);
    expect(screen.queryByRole("button", { name: /Add all/ })).not.toBeInTheDocument();
  });

  it("keeps a tag that's on when it can't be taken off here", () => {
    render(<TaggedByOthersRows matches={[song([tag("Rock", 2)])]} onToggleTag={vi.fn()} coverOf={() => undefined} canRemove={false}
      hasTag={() => true} detailOf={() => ""} />);
    expect(screen.getByRole("button", { name: "Rock added to Bring Me To Life" })).toBeDisabled();
  });

  it("locks a song when its row is clicked, but not when its Play, tags or Hide are", () => {
    const onLock = vi.fn();
    const onPlay = vi.fn();
    const onHide = vi.fn();
    const onToggleTag = vi.fn().mockResolvedValue(undefined);
    render(<TaggedByOthersRows matches={[song([tag("Rock", 2)])]} onToggleTag={onToggleTag} coverOf={() => undefined} hasTag={() => false}
      onLock={onLock} onPlay={onPlay} onHide={onHide} ratingOf={() => 4} detailOf={() => ""} />);

    fireEvent.click(screen.getByRole("button", { name: "Play Bring Me To Life" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Rock to Bring Me To Life" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide Bring Me To Life" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onLock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Evanescence"));
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Your rating: 4 stars")).toBeInTheDocument();
  });

  it("marks the locked song and doesn't lock it again", () => {
    const onLock = vi.fn();
    render(<TaggedByOthersRows matches={[song([tag("Rock")])]} onToggleTag={vi.fn()} coverOf={() => undefined} hasTag={() => false}
      onLock={onLock} activeUri="spotify:track:1" detailOf={() => ""} />);
    expect(screen.getByRole("button", { name: "Bring Me To Life, open in the editor" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("Evanescence"));
    expect(onLock).not.toHaveBeenCalled();
  });
});
