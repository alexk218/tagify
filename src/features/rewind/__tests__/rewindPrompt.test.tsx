import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewindPrompt } from "../RewindPrompt";
import { useRewindPrompt } from "../useRewindPrompt";
import { isRewindPromptSeason, REWIND_PROMPT_ANSWERED_PREFIX, REWIND_PROMPT_OPENS_AT, REWIND_URL } from "../rewindPromptRules";
import { COMMUNITY_UPDATES_CHECKED_EVENT, communityUpdateService } from "@/features/community-updates/communityUpdateService";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import type { TrackData } from "@/types/tagData";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

vi.mock("@/features/discovery-survey/services/tagifyUsage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/discovery-survey/services/tagifyUsage")>()),
  getUsageAccountDigest: vi.fn(),
}));

const ACCOUNT_A = "a".repeat(64);
const ACCOUNT_B = "b".repeat(64);
const DECEMBER_10 = new Date(2026, 11, 10, 15).getTime();
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
/** Lets the account lookup finish, then waits out the delay that keeps the prompt from flashing. */
const settle = async () => { await advance(0); await advance(1100); };
const prompt = () => screen.queryByRole("region", { name: "Your Rewind 2026 is ready" });
const events = () => vi.mocked(recordProductInteraction).mock.calls;

/** A library with `count` songs first tagged in June 2026, and a few that don't count. */
function library(count: number): Record<string, TrackData> {
  const tracks: Record<string, TrackData> = {};
  const song = (overrides: Partial<TrackData>): TrackData => ({ rating: 0, energy: 0, bpm: null, tagIds: ["tag"], ...overrides });
  for (let index = 0; index < count; index++) tracks[`spotify:track:${index}`] = song({ dateCreated: new Date(2026, 5, 1 + (index % 28), 12).getTime() });
  tracks["spotify:track:last-year"] = song({ dateCreated: new Date(2025, 11, 31, 23, 59).getTime() });
  tracks["spotify:track:rated-only"] = song({ tagIds: [], rating: 5, dateCreated: new Date(2026, 5, 1).getTime() });
  tracks["spotify:track:undated"] = song({});
  return tracks;
}

/** The feed every Tagify already reads says whether Rewind is open. */
function feedSays(open: boolean, checked = true) {
  vi.spyOn(communityUpdateService, "isRewindOpen").mockImplementation((year) => open && year === 2026);
  vi.spyOn(communityUpdateService, "hasChecked").mockReturnValue(checked);
}

function Harness({ songs = 40, enabled = true, connected = false, onOpen = vi.fn() }: { songs?: number; enabled?: boolean; connected?: boolean; onOpen?: () => void }) {
  const [tracks] = React.useState(() => library(songs));
  const rewind = useRewindPrompt({ enabled, tracks });
  return <>
    <output data-testid="holds">{String(rewind.holdsPlace)}</output>
    {rewind.shown ? <RewindPrompt songs={rewind.songs} connected={connected} onOpen={() => { rewind.open(); onOpen(); }} onDismiss={rewind.dismiss} /> : null}
  </>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(DECEMBER_10);
  localStorage.clear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.mocked(getUsageAccountDigest).mockResolvedValue(ACCOUNT_A);
  vi.mocked(recordProductInteraction).mockClear();
  feedSays(true);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("the season the Rewind prompt may show in", () => {
  it("starts at noon UTC on December 8, 2026 and not a moment before", () => {
    expect(REWIND_PROMPT_OPENS_AT).toBe(Date.parse("2026-12-08T12:00:00.000Z"));
    expect(isRewindPromptSeason(REWIND_PROMPT_OPENS_AT - 1)).toBe(false);
    expect(isRewindPromptSeason(REWIND_PROMPT_OPENS_AT)).toBe(true);
    expect(isRewindPromptSeason(Date.parse("2026-11-11T12:00:00.000Z"))).toBe(false);
  });

  it("ends when December 31 ends on this device", () => {
    expect(isRewindPromptSeason(new Date(2026, 11, 31, 23, 59, 59, 999).getTime())).toBe(true);
    expect(isRewindPromptSeason(new Date(2027, 0, 1).getTime())).toBe(false);
    expect(isRewindPromptSeason(new Date(2027, 11, 10).getTime())).toBe(false);
  });

  it("sends people to their Rewind on Community, marked as coming from this prompt", () => {
    expect(REWIND_URL).toBe("https://tagify.fm/library/rewind?from=desktop_prompt");
  });
});

describe("Your Rewind 2026 is ready", () => {
  it("shows the number counted on this device and the way to the rest", async () => {
    render(<Harness songs={312} />);
    await settle();

    expect(prompt()).toBeInTheDocument();
    expect(screen.getByText("312")).toBeInTheDocument();
    expect(screen.getByText("songs tagged in 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account or sign in" })).toBeInTheDocument();
    expect(screen.getByText(/with a free Tagify account. Everything you've tagged here comes with you./)).toBeInTheDocument();
    expect(events()).toEqual([["rewind_prompt_shown"]]);
  });

  it("tells a connected member only where their Rewind is", async () => {
    render(<Harness connected />);
    await settle();
    expect(screen.getByText("Your top tags, busiest month and longest streak are on Community.")).toBeInTheDocument();
    expect(screen.queryByText(/Everything you've tagged here/)).toBeNull();
  });

  it("stays away before noon UTC on December 8 and after December 31", async () => {
    vi.setSystemTime(REWIND_PROMPT_OPENS_AT - 60_000);
    const early = render(<Harness />);
    await settle();
    expect(prompt()).toBeNull();
    expect(screen.getByTestId("holds")).toHaveTextContent("false");
    early.unmount();

    vi.setSystemTime(new Date(2027, 0, 1, 0, 0, 1));
    render(<Harness />);
    await settle();
    expect(prompt()).toBeNull();
    expect(events()).toEqual([]);
  });

  it("appears in a Tagify left open across the opening moment", async () => {
    vi.setSystemTime(REWIND_PROMPT_OPENS_AT - 5 * 60_000);
    render(<Harness />);
    await settle();
    expect(prompt()).toBeNull();

    await advance(11 * 60_000);
    await advance(1100);
    expect(prompt()).toBeInTheDocument();
  });

  it("stays away until Community says Rewind is open", async () => {
    feedSays(false);
    render(<Harness />);
    await settle();
    expect(prompt()).toBeNull();
    expect(screen.getByTestId("holds")).toHaveTextContent("false");

    feedSays(true);
    act(() => { window.dispatchEvent(new Event(COMMUNITY_UPDATES_CHECKED_EVENT)); });
    await advance(1100);
    expect(prompt()).toBeInTheDocument();
  });

  it("keeps the Community invitations waiting while the feed hasn't answered, without showing itself", async () => {
    feedSays(false, false);
    render(<Harness />);
    await settle();
    expect(prompt()).toBeNull();
    expect(screen.getByTestId("holds")).toHaveTextContent("true");
    expect(events()).toEqual([]);
  });

  it("is not shown for a year under 20 songs", async () => {
    const small = render(<Harness songs={19} />);
    await settle();
    expect(prompt()).toBeNull();
    expect(screen.getByTestId("holds")).toHaveTextContent("false");
    small.unmount();

    render(<Harness songs={20} />);
    await settle();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("waits while Tagify is busy with something else", async () => {
    const { rerender } = render(<Harness enabled={false} />);
    await settle();
    expect(prompt()).toBeNull();
    expect(events()).toEqual([]);

    rerender(<Harness enabled />);
    await settle();
    expect(prompt()).toBeInTheDocument();
  });

  it("never returns after Not now, in this session or the next", async () => {
    const first = render(<Harness />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(prompt()).toBeNull();
    expect(screen.getByTestId("holds")).toHaveTextContent("false");
    expect(localStorage.getItem(`${REWIND_PROMPT_ANSWERED_PREFIX}${ACCOUNT_A}`)).toBe("1");
    first.unmount();

    vi.setSystemTime(new Date(2026, 11, 20, 9));
    render(<Harness />);
    await settle();
    expect(prompt()).toBeNull();
    // "Not now" is not counted: only the two approved events exist.
    expect(events()).toEqual([["rewind_prompt_shown"]]);
  });

  it("counts the button press and never returns after it", async () => {
    const onOpen = vi.fn();
    const first = render(<Harness onOpen={onOpen} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Create account or sign in" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(prompt()).toBeNull();
    expect(events()).toEqual([["rewind_prompt_shown"], ["rewind_prompt_opened"]]);
    first.unmount();

    render(<Harness />);
    await settle();
    expect(prompt()).toBeNull();
  });

  it("reports being shown at most once a day for each account", async () => {
    const first = render(<Harness />);
    await settle();
    first.unmount();
    const second = render(<Harness />);
    await settle();
    expect(prompt()).toBeInTheDocument();
    expect(events()).toEqual([["rewind_prompt_shown"]]);
    second.unmount();

    vi.setSystemTime(new Date(2026, 11, 12, 15));
    render(<Harness />);
    await settle();
    expect(events()).toEqual([["rewind_prompt_shown"], ["rewind_prompt_shown"]]);
  });

  it("remembers the answer per Spotify account", async () => {
    localStorage.setItem(`${REWIND_PROMPT_ANSWERED_PREFIX}${ACCOUNT_A}`, "1");
    vi.mocked(getUsageAccountDigest).mockResolvedValue(ACCOUNT_B);
    render(<Harness />);
    await settle();
    expect(prompt()).toBeInTheDocument();
  });

  it("stays away when the Spotify account can't be identified, since an answer couldn't be remembered", async () => {
    vi.mocked(getUsageAccountDigest).mockResolvedValue(null);
    render(<Harness />);
    await settle();
    expect(prompt()).toBeNull();
  });

  it("sends nothing anywhere: no request is made for the prompt", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<Harness />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
