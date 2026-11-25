import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityTagResults, SONGS_BEFORE_LOCK, foundText, tagSearchQuery } from "../CommunityTagResults";
import { forgetCommunityTagSearches, searchCompletedDetails, useCommunityTagSearch, type CommunityTagSearchState } from "../useCommunityTagSearch";
import type { TagSearchPage, TagSearchSong } from "../tagSearchClient";

const analytics = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: analytics.record,
}));

const song = (index: number): TagSearchSong => ({
  uri: `spotify:track:${String(index).padStart(22, "0")}`, title: `Song ${index}`, artists: ["Artist"], imageUrl: null, people: 2, tags: ["Deep House"],
});
const songs = (count: number) => Array.from({ length: count }, (_, index) => song(index + 1));
const state = (overrides: Partial<CommunityTagSearchState>): CommunityTagSearchState => ({
  phase: "done", songs: [], total: 0, capped: false, locked: null, failure: null, hasMore: false, loadingMore: false, loadMore: vi.fn(), ...overrides,
});
const noLikes = () => ({ contain: vi.fn(async (uris: string[]) => uris.map(() => false)), save: vi.fn(async () => {}), remove: vi.fn(async () => {}) });
const view = (search: CommunityTagSearchState, handlers = { onConnect: vi.fn(), onShare: vi.fn(), onPlay: vi.fn() }) => {
  render(<CommunityTagResults tags={["Deep House"]} match="any" search={search} likedSongs={noLikes()} onSaved={vi.fn()} {...handlers} />);
  return handlers;
};

describe("On Community results", () => {
  it("not connected: the first songs, the total and Create account or sign in", () => {
    const handlers = view(state({ songs: songs(SONGS_BEFORE_LOCK), total: 312, locked: "connect" }));
    expect(screen.getByRole("heading", { name: "On Community" })).toBeInTheDocument();
    expect(screen.getByText("312 songs tagged Deep House")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(SONGS_BEFORE_LOCK);
    expect(screen.getByText("292 more songs on Community")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create account or sign in to see all 312" }));
    expect(handlers.onConnect).toHaveBeenCalledTimes(1);
    expect(handlers.onShare).not.toHaveBeenCalled();
  });

  it("connected but not sharing: the same limit, asking them to share their tags", () => {
    const handlers = view(state({ songs: songs(SONGS_BEFORE_LOCK + 3), total: 40, locked: "share" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(SONGS_BEFORE_LOCK);
    expect(screen.getByText("Others get to see your tags in return.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share your tags on Community to see all 40" }));
    expect(handlers.onShare).toHaveBeenCalledTimes(1);
    expect(handlers.onConnect).not.toHaveBeenCalled();
  });

  it("says \"at least\" when Community stopped counting", () => {
    view(state({ songs: songs(5), total: 5000, capped: true, locked: "connect" }));
    expect(screen.getByText("More on Community")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account or sign in to see all 5,000+" })).toBeInTheDocument();
  });

  it("sharing: every song, no lock, and Show more while pages remain", () => {
    const loadMore = vi.fn();
    view(state({ songs: songs(12), total: 60, hasMore: true, loadMore }));
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /Create account|Share your tags/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more (48 more)" }));
    expect(loadMore).toHaveBeenCalled();
  });

  it("plays a song and saves it to Liked Songs, crediting the tags that found it", async () => {
    const likedSongs = noLikes();
    const onSaved = vi.fn();
    const onPlay = vi.fn();
    const showNotification = vi.fn();
    (globalThis as { Spicetify?: unknown }).Spicetify = { showNotification };
    render(<CommunityTagResults tags={["Deep House", "Minimal"]} match="any" search={state({ songs: songs(1), total: 1 })} onPlay={onPlay} onConnect={vi.fn()} onShare={vi.fn()}
      likedSongs={likedSongs} onSaved={onSaved} />);
    const row = screen.getByRole("listitem");
    fireEvent.click(within(row).getByRole("button", { name: /Play Song 1/ }));
    expect(onPlay).toHaveBeenCalledWith(song(1).uri);
    await waitFor(() => expect(likedSongs.contain).toHaveBeenCalledWith([song(1).uri]));
    fireEvent.click(within(row).getByRole("button", { name: "Add to Liked Songs: Song 1" }));
    await waitFor(() => expect(likedSongs.save).toHaveBeenCalledWith(song(1).uri));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(song(1).uri, ["Deep House", "Minimal"]));
    expect(showNotification).toHaveBeenCalledWith("Added Song 1 to Liked Songs");
    const saved = await within(row).findByRole("button", { name: "Remove from Liked Songs: Song 1" });
    await waitFor(() => expect((saved as HTMLButtonElement).disabled).toBe(false));
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(saved);
    await waitFor(() => expect(likedSongs.remove).toHaveBeenCalledWith(song(1).uri));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("shows songs already in Liked Songs as saved, and puts a failed save back", async () => {
    const likedSongs = { ...noLikes(), contain: vi.fn(async () => [true, false]), save: vi.fn(async () => { throw new Error("busy"); }) };
    const onSaved = vi.fn();
    const showNotification = vi.fn();
    (globalThis as { Spicetify?: unknown }).Spicetify = { showNotification };
    render(<CommunityTagResults tags={["Deep House"]} match="any" search={state({ songs: songs(2), total: 2 })} onPlay={vi.fn()} onConnect={vi.fn()} onShare={vi.fn()}
      likedSongs={likedSongs} onSaved={onSaved} />);
    expect(await screen.findByRole("button", { name: "Remove from Liked Songs: Song 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to Liked Songs: Song 2" }));
    await waitFor(() => expect(showNotification).toHaveBeenCalledWith("Spotify couldn't add Song 2 to Liked Songs. Please try again.", true));
    expect(screen.getByRole("button", { name: "Add to Liked Songs: Song 2" }).getAttribute("aria-pressed")).toBe("false");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("in words: Save to Liked Songs under each song, counted once Spotify saved it", async () => {
    const likedSongs = noLikes();
    const afterSave = vi.fn();
    likedSongs.save.mockRejectedValueOnce(new Error("offline"));
    render(<CommunityTagResults tags={["Deep House"]} match="any" search={state({ songs: songs(1), total: 1 })} likedSongs={likedSongs} onSaved={vi.fn()} afterSave={afterSave}
      saveInWords onConnect={vi.fn()} onShare={vi.fn()} onPlay={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Add to Liked Songs: Song 1" });
    expect(save).toHaveTextContent("Save to Liked Songs");
    fireEvent.click(save);
    await waitFor(() => expect(likedSongs.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(save).not.toBeDisabled());
    expect(afterSave).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(afterSave).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Remove from Liked Songs: Song 1" })).toHaveTextContent("In Liked Songs");
  });

  it("says so when asked to and nothing was found", () => {
    render(<CommunityTagResults tags={["Deep House"]} match="any" search={state({ total: 0 })} likedSongs={noLikes()} emptyText="No songs tagged Deep House by other members yet."
      onConnect={vi.fn()} onShare={vi.fn()} onPlay={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("No songs tagged Deep House by other members yet.");
  });

  it("shows up to four of each song's tags, the searched ones marked", () => {
    view(state({ songs: [{ ...song(1), tags: ["deep house", "Minimal", "Groovy", "Warm up", "Late night"] }], total: 1 }));
    const pills = screen.getByLabelText("Tags: deep house, Minimal, Groovy, Warm up, Late night");
    expect(within(pills).getAllByText(/./).map((pill) => pill.textContent)).toEqual(["deep house", "Minimal", "Groovy", "Warm up"]);
    expect(within(pills).getByText("deep house").className).toMatch(/tilePillOn/);
    expect(within(pills).getByText("Minimal").className).not.toMatch(/tilePillOn/);
  });

  it("stays out of the way when Community has no search or found nothing", () => {
    const { container, rerender } = render(<CommunityTagResults tags={["X"]} match="any" search={state({ phase: "failed", failure: "not-available" })} onPlay={vi.fn()} onConnect={vi.fn()} onShare={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CommunityTagResults tags={["X"]} match="any" search={state({ phase: "failed", failure: "paused" })} onPlay={vi.fn()} onConnect={vi.fn()} onShare={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CommunityTagResults tags={["X"]} match="any" search={state({ total: 0 })} onPlay={vi.fn()} onConnect={vi.fn()} onShare={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the tags as the filter combines them", () => {
    expect(foundText(1, ["Deep House"], "any")).toBe("1 song tagged Deep House");
    expect(foundText(1200, ["A", "B", "C"], "all")).toBe("1,200 songs tagged A, B and C");
    expect(foundText(2, ["A", "B"], "any")).toBe("2 songs tagged A or B");
    expect(foundText(5000, ["A"], "any", true)).toBe("5,000+ songs tagged A");
  });
});

describe("the track list's filter as a search", () => {
  const names: Record<string, string> = { a: "Deep House", b: "deep house", c: "Techno" };
  it("asks for every included tag once, matching all only for one AND group", () => {
    expect(tagSearchQuery([{ tagIds: ["a", "b", "c"], operator: "AND" }], (id) => names[id])).toEqual({ tags: ["Deep House", "Techno"], match: "all" });
    expect(tagSearchQuery([{ tagIds: ["a"], operator: "AND" }, { tagIds: ["c"], operator: "AND" }], (id) => names[id])).toEqual({ tags: ["Deep House", "Techno"], match: "any" });
    expect(tagSearchQuery([], (id) => names[id])).toEqual({ tags: [], match: "any" });
  });
});

describe("useCommunityTagSearch", () => {
  beforeEach(() => forgetCommunityTagSearches());
  afterEach(() => { vi.useRealTimers(); });

  const page = (overrides: Partial<TagSearchPage> = {}): TagSearchPage => ({ songs: songs(2), total: 2, capped: false, locked: null, nextCursor: null, ...overrides });

  it("asks once the filter settles, and again when who is asking changes", async () => {
    const search = vi.fn(async () => page({ locked: "connect" }));
    const { result, rerender } = renderHook((props: { viewer: string }) => useCommunityTagSearch({ tags: ["Rock"], match: "any", enabled: true, viewer: props.viewer, search, nameSongs: async (s) => s, settleMs: 0 }), { initialProps: { viewer: "signed-out" } });
    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.locked).toBe("connect");
    search.mockResolvedValueOnce(page({ total: 50, nextCursor: "n" }));
    rerender({ viewer: "acct:sharing" });
    await waitFor(() => expect(result.current.total).toBe(50));
    expect(result.current.hasMore).toBe(true);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("adds the next page to the songs shown", async () => {
    const search = vi.fn(async (_tags: readonly string[], options: { cursor?: string | null }) => (options.cursor ? page({ songs: [song(3)], total: 3 }) : page({ total: 3, nextCursor: "n" })));
    const { result } = renderHook(() => useCommunityTagSearch({ tags: ["Rock"], match: "any", enabled: true, viewer: "v", search, nameSongs: async (s) => s, settleMs: 0 }));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.songs).toHaveLength(3));
    expect(result.current.hasMore).toBe(false);
  });

  it("counts each answer from Community by size, never by tag, and not a kept answer shown again", async () => {
    analytics.record.mockClear();
    const search = vi.fn(async () => page({ total: 312, locked: "share" }));
    const ask = () => renderHook(() => useCommunityTagSearch({ tags: ["Rock", "Deep House"], match: "any", enabled: true, viewer: "v", search, nameSongs: async (s) => s, settleMs: 0 }));
    const first = ask();
    await waitFor(() => expect(first.result.current.phase).toBe("done"));
    first.unmount();
    const again = ask();
    await waitFor(() => expect(again.result.current.phase).toBe("done"));
    const counted = analytics.record.mock.calls.filter(([event]) => event === "community_tag_search_completed");
    expect(counted).toEqual([["community_tag_search_completed", { result_bucket: "100+", locked: "share", tags_bucket: "2-3" }]]);
    expect(searchCompletedDetails(0, null, 1)).toEqual({ result_bucket: "0", locked: "none", tags_bucket: "1" });
    expect(searchCompletedDetails(9, "connect", 4)).toEqual({ result_bucket: "1-9", locked: "connect", tags_bucket: "4+" });
    expect(searchCompletedDetails(99, null, 3).result_bucket).toBe("10-99");
  });

  it("counts nothing when Community can't be reached", async () => {
    analytics.record.mockClear();
    const { result } = renderHook(() => useCommunityTagSearch({ tags: ["Rock"], match: "any", enabled: true, viewer: "v", search: async () => { throw new Error("offline"); }, settleMs: 0 }));
    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(analytics.record).not.toHaveBeenCalled();
  });

  it("asks nothing without tags", () => {
    const search = vi.fn();
    const { result } = renderHook(() => useCommunityTagSearch({ tags: [], match: "any", enabled: true, viewer: "v", search, settleMs: 0 }));
    expect(result.current.phase).toBe("idle");
    expect(search).not.toHaveBeenCalled();
  });
});
