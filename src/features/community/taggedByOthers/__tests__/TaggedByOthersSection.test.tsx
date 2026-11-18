import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { ROWS_PER_STEP, TaggedByOthersSection, checkedSummary, checkedWhen, taggedByText } from "../TaggedByOthersSection";
import type { TaggedByOthersMatch, TaggedByOthersOutcome } from "../taggedByOthersScan";
import type { SavedCheck, TaggedByOthersStore } from "../taggedByOthersStore";
import { CHECK_AGAIN_AFTER_MS, forgetTaggedByOthers, preloadTaggedByOthers, type TaggedByOthersCheck, type TaggedByOthersPlaylistCheck } from "../useTaggedByOthers";

vi.mock("@/features/product-analytics/productAnalytics", async (original) => ({ ...(await original<typeof import("@/features/product-analytics/productAnalytics")>()), recordProductInteraction: vi.fn() }));

const match = (index: number, labels = ["Chill", "Focus"], extra: Partial<TaggedByOthersMatch> = {}): TaggedByOthersMatch => ({
  track: { uri: `spotify:track:${index}`, name: `Song ${index}`, artists: [{ name: `Artist ${index}` }], album: { name: "Album" }, duration_ms: 1 },
  tags: labels.map((label) => ({ label, paths: [`Mood / ${label}`], people: 2 })),
  people: 2, peopleCapped: false, sample: ["ana"], position: index,
  ...extra,
});
const taxonomy = { tagsById: { "tag-chill": { id: "tag-chill", name: "chill" } } } as unknown as TagTaxonomy;
const tracks = { "spotify:track:1": { tagIds: ["tag-chill"] } } as unknown as Record<string, TrackData>;
const EMPTY: TaggedByOthersOutcome = {
  scope: "liked", checked: 0, matches: [], stopped: null, playlistsRead: 0, playlists: null, skippedPlaylists: 0, capped: false,
  songIds: [], playlistIds: [], playlistsLeft: null,
};
const done = (outcome: Partial<TaggedByOthersOutcome>): TaggedByOthersCheck => async () => ({ ...EMPTY, ...outcome });

/** What this computer keeps between Spotify sessions. */
function memoryStore(initial: SavedCheck | null = null) {
  let saved = initial;
  const store: TaggedByOthersStore = {
    load: vi.fn(async (account: string) => {
      if (saved && saved.account !== account) saved = null;
      return saved;
    }),
    save: vi.fn(async (check: SavedCheck) => { saved = check; }),
    clear: vi.fn(async () => { saved = null; }),
  };
  return { store, saved: () => saved };
}

function renderSection(check: TaggedByOthersCheck, props: Partial<React.ComponentProps<typeof TaggedByOthersSection>> = {}) {
  const handlers = { onConnectCommunity: vi.fn(), onAddMembersTags: vi.fn().mockResolvedValue(undefined), onOpenSong: vi.fn() };
  const view = render(<TaggedByOthersSection connected accountId="account-a" tracks={tracks} taxonomy={taxonomy} check={check} store={memoryStore().store} {...handlers} {...props} />);
  return { ...handlers, ...view };
}
const names = () => screen.getAllByRole("listitem").map((row) => within(row).getByRole("button", { name: /^Open / }).getAttribute("aria-label"));

beforeEach(() => {
  vi.mocked(recordProductInteraction).mockClear();
});
afterEach(() => {
  forgetTaggedByOthers();
});

describe("songs other members tagged", () => {
  it("invites someone who isn't connected, through the connect action it was given, and checks nothing", () => {
    const check = vi.fn(done({}));
    const { onConnectCommunity } = renderSection(check, { connected: false, accountId: null });

    fireEvent.click(screen.getByRole("button", { name: "Connect to see them" }));
    expect(onConnectCommunity).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
  });

  describe("preview for someone who isn't connected", () => {
    const preview = { total: 42, songs: [1, 2, 3, 4, 5, 6, 7].map((index) => ({ ...match(index), people: 10 - index, sample: [] })) };
    afterEach(() => localStorage.clear());

    it("shows today's card while the communityTeasers switch is off", () => {
      renderSection(vi.fn(done({})), { connected: false, accountId: null, preview });
      expect(screen.getByRole("button", { name: "Connect to see them" })).toBeTruthy();
      expect(screen.queryByText("Song 1")).toBeNull();
    });

    it("five songs with their tags, nothing to add, no member names, then the locked rest", () => {
      localStorage.setItem("tagify:switch:communityTeasers", "on");
      const check = vi.fn(done({}));
      const { onConnectCommunity } = renderSection(check, { connected: false, accountId: null, preview });
      expect(screen.getByText("Song 1")).toBeTruthy();
      expect(screen.getByText(/Tagged by 9 members/)).toBeTruthy();
      expect(screen.queryByText(/@ana/)).toBeNull();
      expect(screen.queryByRole("button", { name: /^Add Chill/ })).toBeNull();
      expect(screen.getByText("37 more songs tagged by others")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Connect to Tagify Community to see all 42" }));
      fireEvent.click(screen.getAllByRole("button", { name: /^Connect to Tagify Community to add these tags/ })[0]);
      expect(onConnectCommunity).toHaveBeenCalledTimes(2);
      expect(check).not.toHaveBeenCalled();
    });
  });

  it("starts by itself, shows songs as they are found, and keeps going when Community closes", async () => {
    let signal: AbortSignal | undefined;
    let finish: (outcome: TaggedByOthersOutcome) => void = () => {};
    const check = vi.fn<Parameters<TaggedByOthersCheck>, ReturnType<TaggedByOthersCheck>>((options) => {
      signal = options.signal;
      options.onProgress({ ...EMPTY, checked: 500, matches: [match(2)] });
      return new Promise((resolve) => { finish = resolve; });
    });
    const { unmount } = renderSection(check);

    expect(await screen.findByText("Checked 500 of your Liked Songs · 1 found")).toBeInTheDocument();
    expect(screen.getByText("Song 2")).toBeInTheDocument();
    unmount();
    // Closing Community doesn't stop the check, and reopening shows the same one instead of reading Spotify again.
    expect(signal?.aborted).toBe(false);
    renderSection(check);
    expect(await screen.findByText("Checked 500 of your Liked Songs · 1 found")).toBeInTheDocument();
    finish({ ...EMPTY, checked: 900, matches: [match(2)] });
    expect(await screen.findByText("Checked your 900 Liked Songs · 1 found")).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);
    expect(recordProductInteraction).toHaveBeenCalledTimes(1);
  });

  it("stops the check when the member disconnects", async () => {
    let signal: AbortSignal | undefined;
    const check: TaggedByOthersCheck = (options) => { signal = options.signal; return new Promise(() => {}); };
    const view = renderSection(check);
    await screen.findByText("Checking your Liked Songs…");
    view.rerender(<TaggedByOthersSection connected={false} accountId={null} tracks={tracks} taxonomy={taxonomy} store={memoryStore().store}
      onConnectCommunity={vi.fn()} onAddMembersTags={vi.fn()} />);
    expect(signal?.aborted).toBe(true);
  });

  it("greys Check again out with a countdown for 30 minutes after a check finished", async () => {
    let now = Date.parse("2026-11-15T12:00:00Z");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const check = vi.fn(done({ checked: 120, matches: [match(4)] }));
      renderSection(check, { now: () => now });
      await screen.findByText("Checked your 120 Liked Songs · 1 found");
      expect(CHECK_AGAIN_AFTER_MS).toBe(30 * 60_000);
      expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Check again in 30 min" })).toBeDisabled();
      now += 6 * 60_000;
      await vi.advanceTimersByTimeAsync(6 * 60_000 + 100);
      expect(await screen.findByRole("button", { name: "Check again in 24 min" })).toBeDisabled();
      now += CHECK_AGAIN_AFTER_MS - 6 * 60_000;
      await vi.advanceTimersByTimeAsync(CHECK_AGAIN_AFTER_MS);
      fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
      await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the member choose their own playlists after Liked Songs, carries on from it, and offers the rest a batch at a time", async () => {
    localStorage.clear();
    const liked = { ...EMPTY, checked: 120, matches: [match(4)], songIds: ["a", "b"] };
    let finish: (outcome: TaggedByOthersOutcome) => void = () => {};
    const checkMore = vi.fn<Parameters<TaggedByOthersPlaylistCheck>, ReturnType<TaggedByOthersPlaylistCheck>>((options) => {
      options.onProgress({ ...liked, scope: "liked+playlists", checked: 300, playlistsRead: 12, playlists: 100 });
      return new Promise((resolve) => { finish = resolve; });
    });
    const own = (id: string, name: string, folders: { id: string; name: string }[] = [], songCount = 250) =>
      ({ playlistId: id, playlistName: name, folders, owned: true, ownerName: null, songCount });
    const listPlaylists = vi.fn(async () => [own("p1", "Gym"), own("p2", "Late night", [{ id: "f1", name: "Moods" }]), own("p3", "Rainy", [{ id: "f1", name: "Moods" }], 40)]);
    renderSection(done(liked), { checkMore, listPlaylists });

    fireEvent.click(await screen.findByRole("button", { name: "Also check playlists I made…" }));
    const picker = await screen.findByRole("dialog", { name: "Choose playlists to check" });
    expect(await within(picker).findByText("Gym")).toBeInTheDocument();
    // Folders start closed; ticking one ticks its playlists.
    expect(within(picker).queryByText("Late night")).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("checkbox", { name: /Moods/ }));
    expect(within(picker).getByText("2 playlists, 290 songs · about 4 Spotify reads")).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("button", { name: "Select all my playlists" }));
    fireEvent.click(within(picker).getByRole("button", { name: "Check 3 playlists" }));

    expect(checkMore.mock.calls[0][0].previous).toMatchObject({ checked: 120, songIds: ["a", "b"] });
    expect([...(checkMore.mock.calls[0][0].chosen ?? [])].sort()).toEqual(["p1", "p2", "p3"]);
    expect(recordProductInteraction).toHaveBeenCalledWith("tagged_by_others_playlists_chosen", { playlists_chosen: "2-4", folders_used: "yes" });
    expect(await screen.findByText("Checking your playlists… 12 of 100")).toBeInTheDocument();
    // Songs found in Liked Songs stay while playlists are read.
    expect(screen.getByText("Song 4")).toBeInTheDocument();
    finish({ ...liked, scope: "liked+playlists", checked: 1_400, matches: [match(4), match(800)], playlistIds: Array.from({ length: 100 }, (_, index) => `p${index}`), playlistsLeft: 1_083 });

    expect(await screen.findByText("Checked 1,400 songs from your Liked Songs and 100 playlists · 2 found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check the remaining 1,083 playlists" }));
    expect(checkMore).toHaveBeenCalledTimes(2);
    expect(checkMore.mock.calls[1][0].previous.playlistIds).toHaveLength(100);
    expect([...(checkMore.mock.calls[1][0].chosen ?? [])].sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("says when Spotify can't list playlists, and checks nothing", async () => {
    const checkMore = vi.fn();
    renderSection(done({ checked: 10 }), { checkMore, listPlaylists: vi.fn(async () => null) });
    fireEvent.click(await screen.findByRole("button", { name: "Also check playlists I made…" }));
    expect(await screen.findByText(/Spotify needs a break before Tagify can read your playlists/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check playlists" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(checkMore).not.toHaveBeenCalled();
  });

  it("offers only choosing more once every chosen playlist was checked", async () => {
    renderSection(done({ scope: "liked+playlists", checked: 1_400, playlistIds: ["p1"], playlistsLeft: 0 }));
    await screen.findByText(/from your Liked Songs and 1 playlist ·/);
    expect(screen.getByRole("button", { name: "Choose playlists…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remaining/ })).not.toBeInTheDocument();
  });

  it("explains the read limit in plain words", async () => {
    renderSection(done({ checked: 5_000, stopped: "allowance" }));
    expect(await screen.findByText(/Tagify takes a break after reading a lot for this list/)).toBeInTheDocument();
    expect(screen.getByText("Checked 5,000 of your Liked Songs · 0 found")).toBeInTheDocument();
    // Playlists are offered only once Liked Songs was checked all the way.
    expect(screen.queryByRole("button", { name: "Also check playlists I made…" })).not.toBeInTheDocument();
  });

  it("marks a tag the song already has, adds the rest through the path it was given, and reports the save", async () => {
    const { onAddMembersTags } = renderSection(done({ checked: 40, matches: [match(1)] }));

    expect(await screen.findByRole("button", { name: "Chill added to Song 1" })).toBeDisabled();
    // Tags are added one at a time; there is no "Add all".
    expect(screen.queryByRole("button", { name: /Add all/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Focus to Song 1" }));
    await waitFor(() => expect(recordProductInteraction).toHaveBeenCalledWith("community_library_tag_added", { members_add: "tag" }));
    expect(onAddMembersTags).toHaveBeenCalledTimes(1);
    expect(onAddMembersTags.mock.calls[0][0].track.uri).toBe("spotify:track:1");
    expect(onAddMembersTags.mock.calls[0][1].map((tag: { label: string }) => tag.label)).toEqual(["Focus"]);
  });

  it("reports nothing when the tag couldn't be saved", async () => {
    renderSection(done({ checked: 40, matches: [match(3, ["Dark"])] }), { onAddMembersTags: vi.fn().mockRejectedValue(new Error("Tagify couldn't add those tags. Please try again.")) });

    fireEvent.click(await screen.findByRole("button", { name: "Add Dark to Song 3" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(recordProductInteraction).not.toHaveBeenCalledWith("community_library_tag_added", expect.anything());
  });

  it("reports a finished check once, in buckets", async () => {
    const { unmount } = renderSection(done({ checked: 1_570, matches: Array.from({ length: 12 }, (_, index) => match(index + 10)) }));
    await screen.findByText("Checked your 1,570 Liked Songs · 12 found");
    expect(recordProductInteraction).toHaveBeenCalledTimes(1);
    expect(recordProductInteraction).toHaveBeenCalledWith("community_library_check_completed", { songs_checked: "1000-9999", songs_matched: "10-99", outcome: "complete" });

    // Reopening shows the same check; it is not another check.
    unmount();
    renderSection(vi.fn(done({})));
    await screen.findByText("Checked your 1,570 Liked Songs · 12 found");
    expect(recordProductInteraction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["spotify", "spotify_stopped"], ["busy", "limited"], ["paused", "community_stopped"], ["unreachable", "community_stopped"], ["not-available", "community_stopped"],
  ] as const)("reports a check that ended at %s as %s", async (stopped, outcome) => {
    renderSection(done({ stopped }));
    await waitFor(() => expect(recordProductInteraction).toHaveBeenCalledWith("community_library_check_completed", { songs_checked: "0", songs_matched: "0", outcome }));
  });

  it("shows 50 songs at a time", async () => {
    renderSection(done({ checked: 900, matches: Array.from({ length: ROWS_PER_STEP + 20 }, (_, index) => match(index + 10)) }));

    await screen.findByText("Checked your 900 Liked Songs · 70 found");
    expect(screen.getAllByRole("listitem")).toHaveLength(ROWS_PER_STEP);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(ROWS_PER_STEP + 20);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("says it is checking Liked Songs, and never reads playlists on its own", async () => {
    const check: TaggedByOthersCheck = (options) => {
      options.onProgress({ ...EMPTY, checked: 500 });
      return new Promise(() => {});
    };
    renderSection(check);
    expect(await screen.findByText("Checking your Liked Songs…")).toBeInTheDocument();
    expect(screen.getByText("Checked 500 of your Liked Songs · 0 found")).toBeInTheDocument();
    expect(screen.queryByText(/playlist/i)).not.toBeInTheDocument();
  });

  it("says which part of the library a playlist check is reading", async () => {
    const check: TaggedByOthersCheck = (options) => {
      options.onProgress({ ...EMPTY, scope: "liked+playlists", checked: 500, playlistsRead: 12, playlists: 40 });
      return new Promise(() => {});
    };
    renderSection(check);
    expect(await screen.findByText(/12 of 40/)).toBeInTheDocument();
  });

  it("says so when nobody else tagged these songs", async () => {
    renderSection(done({ checked: 120 }));
    expect(await screen.findByText("No other members have tagged your Liked Songs yet.")).toBeInTheDocument();
    expect(screen.getByText("Checked your 120 Liked Songs · 0 found")).toBeInTheDocument();
  });

  it("says so when there are no Liked Songs to check", async () => {
    renderSection(done({}));
    expect(await screen.findByText("You have no Liked Songs to check yet. Like a few songs in Spotify, then come back.")).toBeInTheDocument();
  });

  it("invites someone who isn't connected to see their Liked Songs", () => {
    renderSection(done({}), { connected: false, accountId: null });
    expect(screen.getByText(/see which of your Liked Songs other members already tagged/)).toBeInTheDocument();
  });

  it("says when playlists couldn't be read, and when the library is larger than one check", async () => {
    const { unmount } = renderSection(done({ scope: "liked+playlists", checked: 300, matches: [match(4)], skippedPlaylists: 2 }));
    expect(await screen.findByText(/couldn't open 2 playlists/)).toBeInTheDocument();
    unmount();
    forgetTaggedByOthers();

    renderSection(done({ checked: 150_000, matches: [match(4)], capped: true }));
    expect(await screen.findByText("You have more Liked Songs than Tagify checks at once, so only the first 150,000 were checked.")).toBeInTheDocument();
  });

  it("keeps what it found when Spotify stops, and doesn't check again on reopening", async () => {
    const check = vi.fn(done({ checked: 100, matches: [match(3)], stopped: "spotify" }));
    const { unmount } = renderSection(check);
    expect(await screen.findByText(/Spotify needs a break/)).toBeInTheDocument();
    expect(screen.getByText("Checked 100 of your Liked Songs · 1 found")).toBeInTheDocument();
    expect(screen.getByText("Song 3")).toBeInTheDocument();

    unmount();
    renderSection(check);
    expect(screen.getByText("Song 3")).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unreachable", "Tagify couldn't reach Community just now."],
    ["paused", "Community has paused this for now."],
    ["busy", "Community has checked as many songs as it can for now."],
    ["not-available", "This isn't available just yet."],
  ] as const)("explains %s in plain words", async (stopped, copy) => {
    renderSection(done({ stopped }));
    expect(await screen.findByText(copy, { exact: false })).toBeInTheDocument();
  });

  it("checks again when asked", async () => {
    const check = vi.fn<Parameters<TaggedByOthersCheck>, ReturnType<TaggedByOthersCheck>>()
      .mockImplementationOnce(done({ stopped: "unreachable" }))
      .mockImplementationOnce(done({ checked: 10, matches: [match(5)] }));
    renderSection(check);

    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Song 5")).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("the check saved on this computer", () => {
  const HOUR = 60 * 60_000;
  const NOW = Date.parse("2026-11-10T12:00:00Z");
  const saved = (age: number, account = "account-a"): SavedCheck => ({ account, checkedAt: NOW - age, outcome: { ...EMPTY, checked: 800, matches: [match(1), match(7)] } });

  it("shows a saved check at once, with when it was made, and doesn't check", async () => {
    const check = vi.fn(done({}));
    renderSection(check, { store: memoryStore(saved(3 * HOUR)).store, now: () => NOW });

    expect(await screen.findByText("Song 7")).toBeInTheDocument();
    expect(screen.getByText(/3 hours ago/)).toBeInTheDocument();
    // A tag added since the check shows from the library, not from what was saved.
    expect(screen.getByRole("button", { name: "Chill added to Song 1" })).toBeDisabled();
    expect(check).not.toHaveBeenCalled();
    expect(recordProductInteraction).not.toHaveBeenCalled();
  });

  it("shows a saved check read ahead of time on its first render, without an empty frame", async () => {
    const check = vi.fn(done({}));
    const { store } = memoryStore(saved(3 * HOUR));
    await preloadTaggedByOthers("account-a", store);
    renderSection(check, { store, now: () => NOW });

    // No await: the first render already has the songs.
    expect(screen.getByText("Song 7")).toBeInTheDocument();
    await waitFor(() => expect(store.load).toHaveBeenCalledTimes(2));
    expect(check).not.toHaveBeenCalled();
  });

  it("checks quietly when the saved check is over a day old, showing it until the new one is done", async () => {
    const kept = memoryStore(saved(25 * HOUR));
    let finish: (outcome: TaggedByOthersOutcome) => void = () => {};
    const check = vi.fn<Parameters<TaggedByOthersCheck>, ReturnType<TaggedByOthersCheck>>((options) => {
      options.onProgress({ ...EMPTY, checked: 500 });
      return new Promise((resolve) => { finish = resolve; });
    });
    renderSection(check, { store: kept.store, now: () => NOW });

    expect(await screen.findByText("Song 7")).toBeInTheDocument();
    expect(screen.getByText("Checking for new tags…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    // The day-old check stays saved while the new one runs.
    expect(kept.store.save).not.toHaveBeenCalled();
    act(() => finish({ ...EMPTY, checked: 900, matches: [match(9)] }));

    expect(await screen.findByText("Song 9")).toBeInTheDocument();
    expect(screen.queryByText("Song 7")).not.toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(kept.saved()).toMatchObject({ account: "account-a", checkedAt: NOW, outcome: { checked: 900 } }));
  });

  it("keeps the saved check when a quiet check can't finish", async () => {
    const kept = memoryStore(saved(25 * HOUR));
    renderSection(vi.fn(done({ checked: 10, stopped: "unreachable" })), { store: kept.store, now: () => NOW });
    expect(await screen.findByText("Song 7")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Checking for new tags…")).not.toBeInTheDocument());
    expect(screen.getByText("Song 7")).toBeInTheDocument();
    expect(kept.store.save).not.toHaveBeenCalled();
  });

  it("checks now when asked, whatever is saved", async () => {
    const kept = memoryStore(saved(HOUR));
    const check = vi.fn(done({ checked: 900, matches: [match(9)] }));
    renderSection(check, { store: kept.store, now: () => NOW });

    fireEvent.click(await screen.findByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Song 9")).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(kept.saved()?.outcome.checked).toBe(900));
  });

  it("saves a check that stopped part way, so reloading Spotify shows it instead of reading again", async () => {
    const kept = memoryStore();
    renderSection(done({ checked: 100, matches: [match(3)], stopped: "busy" }), { store: kept.store });
    await screen.findByText("Song 3");
    await waitFor(() => expect(kept.saved()?.outcome).toMatchObject({ checked: 100, stopped: "busy" }));
  });

  it("doesn't save a check Community couldn't answer", async () => {
    const kept = memoryStore();
    renderSection(done({ stopped: "unreachable" }), { store: kept.store });
    await screen.findByText(/couldn't reach Community/);
    expect(kept.store.save).not.toHaveBeenCalled();
  });

  it("never shows another account's check, and removes it", async () => {
    const kept = memoryStore(saved(HOUR, "account-b"));
    const check = vi.fn(done({ checked: 5 }));
    renderSection(check, { store: kept.store, now: () => NOW });

    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Song 7")).not.toBeInTheDocument();
    await waitFor(() => expect(kept.saved()?.account).toBe("account-a"));
  });

  it("removes the saved check when the member disconnects", async () => {
    const kept = memoryStore(saved(HOUR));
    const view = renderSection(vi.fn(done({})), { store: kept.store, now: () => NOW });
    await screen.findByText("Song 7");

    view.rerender(<TaggedByOthersSection connected={false} accountId={null} tracks={tracks} taxonomy={taxonomy} store={kept.store}
      onConnectCommunity={vi.fn()} onAddMembersTags={vi.fn()} />);
    await waitFor(() => expect(kept.saved()).toBeNull());
    expect(screen.queryByText("Song 7")).not.toBeInTheDocument();
  });
});

describe("reloading Spotify part way through a check", () => {
  /** A check that waits until told to finish; each call is kept. */
  function heldCheck() {
    const calls: Parameters<TaggedByOthersCheck>[0][] = [];
    const check = vi.fn<Parameters<TaggedByOthersCheck>, ReturnType<TaggedByOthersCheck>>((options) => {
      calls.push(options);
      return new Promise(() => {});
    });
    return { check, calls };
  }
  /** Spotify reloads: everything in memory is gone, and the running check with it. */
  const reload = () => { forgetTaggedByOthers(); cleanup(); };

  it("saves every answer as it comes, and continues from the songs already checked instead of starting over", async () => {
    const kept = memoryStore();
    const held = heldCheck();
    renderSection(held.check, { store: kept.store });
    await waitFor(() => expect(held.check).toHaveBeenCalledTimes(1));
    act(() => {
      held.calls[0].onProgress({ ...EMPTY, checked: 3, matches: [match(2)], songIds: ["1", "2", "3"] });
      held.calls[0].onProgress({ ...EMPTY, checked: 5, matches: [match(2)], songIds: ["1", "2", "3", "4", "5"] });
    });
    // The newest answer is what is saved, however quickly it follows the one before.
    await waitFor(() => expect(kept.saved()).toMatchObject({ inProgress: true, outcome: { checked: 5, songIds: ["1", "2", "3", "4", "5"], stopped: null } }));

    reload();
    renderSection(held.check, { store: kept.store });

    // What was found shows at once, still checking, and the check carries on from it.
    expect(await screen.findByText("Song 2")).toBeInTheDocument();
    expect(screen.getByText("Checked 5 of your Liked Songs · 1 found")).toBeInTheDocument();
    await waitFor(() => expect(held.check).toHaveBeenCalledTimes(2));
    expect(held.calls[1].continueFrom).toMatchObject({ checked: 5, songIds: ["1", "2", "3", "4", "5"] });
  });

  it("continues a check Community couldn't finish the next time Community opens", async () => {
    const kept = memoryStore();
    const first = renderSection(done({ checked: 500, songIds: ["1"], matches: [match(1)], stopped: "unreachable" }), { store: kept.store });
    await screen.findByText(/couldn't reach Community/);
    await waitFor(() => expect(kept.saved()).toMatchObject({ inProgress: true, outcome: { checked: 500 } }));
    first.unmount();

    reload();
    const held = heldCheck();
    renderSection(held.check, { store: kept.store });
    await waitFor(() => expect(held.check).toHaveBeenCalledTimes(1));
    expect(held.calls[0].continueFrom).toMatchObject({ checked: 500, songIds: ["1"] });
  });
});

describe("finding a song in the list", () => {
  const many = [
    match(1, ["Chill"], { people: 2, position: 0 }),
    match(2, ["Chill"], { people: 9, position: 1 }),
    match(3, ["Chill"], { people: 9, position: 2, track: { uri: "spotify:track:3", name: "Röyksopp Forever", artists: [{ name: "Röyksopp" }], album: { name: "Album" }, duration_ms: 1 } }),
    match(4, ["Chill"], { people: 1, position: 3 }),
    match(5, ["Chill"], { people: 4, position: 4 }),
    match(6, ["Chill"], { people: 1, position: 5 }),
  ];

  it("lists the songs most members tagged first, or in the order Spotify lists them", async () => {
    renderSection(done({ checked: 50, matches: many }));
    await screen.findByText("Song 2");
    expect(names()).toEqual(["Open Song 2", "Open Röyksopp Forever", "Open Song 5", "Open Song 1", "Open Song 4", "Open Song 6"]);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort songs" }), { target: { value: "recent" } });
    expect(names()).toEqual(["Open Song 1", "Open Song 2", "Open Röyksopp Forever", "Open Song 4", "Open Song 5", "Open Song 6"]);
  });

  it("searches song and artist names, and says when nothing matches", async () => {
    renderSection(done({ checked: 50, matches: many }));
    const search = await screen.findByRole("searchbox", { name: "Search songs or artists" });

    fireEvent.change(search, { target: { value: "royksopp" } });
    expect(names()).toEqual(["Open Röyksopp Forever"]);
    fireEvent.change(search, { target: { value: "artist 5" } });
    expect(names()).toEqual(["Open Song 5"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/No songs match/)).toBeInTheDocument();
  });

  it("opens a song's details from its row", async () => {
    const { onOpenSong } = renderSection(done({ checked: 50, matches: many }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Song 5" }));
    expect(onOpenSong).toHaveBeenCalledWith("spotify:track:5");
  });

  it("names up to three members who tagged a song, then how many more", () => {
    expect(taggedByText({ people: 5, peopleCapped: false, sample: ["ana", "sam"] })).toBe("Tagged by @ana, @sam +3");
    expect(taggedByText({ people: 1, peopleCapped: false, sample: ["ana"] })).toBe("Tagged by @ana");
    expect(taggedByText({ people: 4, peopleCapped: false, sample: [] })).toBe("Tagged by 4 members");
  });

  it("counts Liked Songs for a Liked Songs check, and songs for one that read playlists", () => {
    const outcome = { ...EMPTY, checked: 26_384, matches: Array.from({ length: 630 }, (_, index) => match(index)) };
    expect(checkedSummary(outcome, false)).toBe("Checked your 26,384 Liked Songs · 630 found");
    expect(checkedSummary({ ...outcome, checked: 1, matches: [] }, false)).toBe("Checked your 1 Liked Song · 0 found");
    expect(checkedSummary({ ...outcome, checked: 5_000 }, true)).toBe("Checked 5,000 of your Liked Songs · 630 found");
    expect(checkedSummary({ ...outcome, stopped: "busy" }, false)).toBe("Checked 26,384 of your Liked Songs · 630 found");
    expect(checkedSummary({ ...outcome, scope: "liked+playlists", checked: 30_100 }, false)).toBe("Checked 30,100 songs · 630 found");
  });

  it("shows a check saved before Liked Songs-only checks as one that read playlists", async () => {
    const NOW = Date.parse("2026-11-10T12:00:00Z");
    const older: SavedCheck = { account: "account-a", checkedAt: NOW - 60_000, outcome: { ...EMPTY, scope: "liked+playlists", checked: 1_570, matches: [match(1)] } };
    renderSection(vi.fn(done({})), { store: memoryStore(older).store, now: () => NOW });
    expect(await screen.findByText("Checked 1,570 songs · 1 found")).toBeInTheDocument();
  });

  it("says when a check was made", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(checkedWhen(now - 20_000, now)).toBe("just now");
    expect(checkedWhen(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(checkedWhen(now - 60 * 60_000, now)).toBe("1 hour ago");
  });
});

describe("in the track list, for a member who doesn't share their tags", () => {
  const many = Array.from({ length: 8 }, (_, index) => match(index + 1, ["Chill", "Focus"], { people: 20 - index }));

  it("keeps the top 5 usable and locks the rest behind sharing their tags", async () => {
    const onShareTags = vi.fn();
    renderSection(done({ checked: 400, matches: many }), { inTrackList: true, sharingLocked: true, onShareTags });

    expect(await screen.findByRole("button", { name: "Share your tags on Community to see all 8" })).toBeInTheDocument();
    expect(screen.getByText("Others get to see your tags in return.")).toBeInTheDocument();
    // Five songs with their tags one tap away; the next show only their names, never the tags.
    expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Add Focus to Song 5" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /to Song 6$/ })).toBeNull();
    const locked = within(screen.getByRole("list", { name: "Locked songs" }));
    expect(locked.getAllByRole("listitem")).toHaveLength(3);
    expect(locked.getByText("Song 6")).toBeInTheDocument();
    expect(locked.getAllByText("2 tags from others")).toHaveLength(3);
    expect(screen.getByText("3 more songs tagged by others")).toBeInTheDocument();
    expect(screen.queryByText(/Liked Songs on Community/)).toBeNull();
    // Search would reach past the lock, and playlists would find songs it can't open yet.
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Also check playlists I made…" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Share your tags on Community to see all 8" }));
    expect(onShareTags).toHaveBeenCalledTimes(1);
  });

  it("shows every song to a member who shares their tags", async () => {
    renderSection(done({ checked: 400, matches: many }), { inTrackList: true, sharingLocked: false, onShareTags: vi.fn() });

    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(8));
    expect(screen.queryByRole("list", { name: "Locked songs" })).toBeNull();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("names the view only for screen readers, since its tab already does", async () => {
    renderSection(done({ checked: 400, matches: many.slice(0, 2) }), { inTrackList: true, sharingLocked: true, onShareTags: vi.fn() });
    expect(await screen.findByText("Checked your 400 Liked Songs · 2 found")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your songs, tagged by others" }).className).toMatch(/visuallyHidden/);
    // Nothing past the top 3, so nothing to lock.
    expect(screen.queryByRole("list", { name: "Locked songs" })).toBeNull();
  });
});

describe("in the track list, where tags come off again", () => {
  function memoryHidden() {
    const kept = new Map<string, string[]>();
    return {
      load: vi.fn((account: string) => kept.get(account) ?? []),
      save: vi.fn((account: string, uris: readonly string[]) => { kept.set(account, [...uris]); }),
      clear: vi.fn(() => { kept.clear(); }),
    };
  }
  beforeEach(() => { localStorage.clear(); });

  const editable = (props: Partial<React.ComponentProps<typeof TaggedByOthersSection>> = {}) =>
    ({ inTrackList: true, onToggleTag: vi.fn().mockResolvedValue(undefined), onLockSong: vi.fn(), hiddenStore: memoryHidden(), ...props });

  it("leaves out songs already tagged until 'Not tagged by me yet' is turned off, and remembers the choice", async () => {
    renderSection(done({ checked: 3, matches: [match(1), match(2), match(3)] }), editable());

    await screen.findByText("Song 2");
    expect(screen.queryByText("Song 1")).not.toBeInTheDocument();
    const chip = screen.getByRole("button", { name: "Not tagged by me yet" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    // A filter chip leading the tag names, not a checkbox beside the sort menu (Alex's pick C, 2026-11-18).
    expect(screen.queryByRole("checkbox", { name: "Not tagged by me yet" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Show songs others tagged" }).firstElementChild).toBe(chip);
    fireEvent.click(chip);
    expect(screen.getByText("Song 1")).toBeInTheDocument();
    cleanup();
    forgetTaggedByOthers();
    renderSection(done({ checked: 3, matches: [match(1), match(2), match(3)] }), editable());
    expect(await screen.findByText("Song 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not tagged by me yet" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps a song in view after a tag is added to it, so the tag can come off again", async () => {
    const onToggleTag = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderSection(done({ checked: 2, matches: [match(2), match(3)] }), editable({ onToggleTag }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Focus to Song 2" }));
    await waitFor(() => expect(onToggleTag).toHaveBeenCalledWith(expect.objectContaining({ track: expect.objectContaining({ uri: "spotify:track:2" }) }), expect.objectContaining({ label: "Focus" }), true));
    await waitFor(() => expect(recordProductInteraction).toHaveBeenCalledWith("tagged_by_others_tag_toggled", { toggle_action: "added" }));

    const tagged = { ...tracks, "spotify:track:2": { tagIds: ["tag-focus"] } } as unknown as Record<string, TrackData>;
    const withFocus = { tagsById: { ...taxonomy.tagsById, "tag-focus": { id: "tag-focus", name: "Focus" } } } as unknown as TagTaxonomy;
    rerender(<TaggedByOthersSection connected accountId="account-a" tracks={tagged} taxonomy={withFocus} check={done({ checked: 2, matches: [match(2), match(3)] })}
      store={memoryStore().store} onConnectCommunity={vi.fn()} onAddMembersTags={vi.fn()} {...editable({ onToggleTag })} />);
    expect(await screen.findByRole("button", { name: "Remove Focus from Song 2" })).toBeInTheDocument();
  });

  it("hides a song with Undo, and lists hidden songs to show again", async () => {
    const hiddenStore = memoryHidden();
    renderSection(done({ checked: 3, matches: [match(2), match(3), match(4)] }), editable({ hiddenStore }));

    fireEvent.click(await screen.findByRole("button", { name: "Hide Song 3" }));
    expect(screen.queryByText("Song 3")).not.toBeInTheDocument();
    expect(hiddenStore.save).toHaveBeenLastCalledWith("account-a", ["spotify:track:3"]);
    expect(recordProductInteraction).toHaveBeenCalledWith("tagged_by_others_song_hidden", { hide_action: "hidden" });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Song 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide Song 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Hidden (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Song 4 again" }));
    expect(within(screen.getAllByRole("list")[0]).getByText("Song 4")).toBeInTheDocument();
    expect(hiddenStore.save).toHaveBeenLastCalledWith("account-a", []);
  });

  it("filters by a name others used and by artist, and offers a way back to every song", async () => {
    const songs = [match(2, ["Chill"]), match(3, ["Focus"]), match(4, ["Focus", "Chill"], { track: { uri: "spotify:track:4", name: "Song 4", artists: [{ name: "Artist 3" }], album: { name: "Album" }, duration_ms: 1 } })];
    renderSection(done({ checked: 3, matches: songs }), editable());

    fireEvent.click(await screen.findByRole("button", { name: /^Focus/ }));
    expect(recordProductInteraction).toHaveBeenCalledWith("tagged_by_others_filter_used", { filter_kind: "tag" });
    expect(screen.queryByText("Song 2")).not.toBeInTheDocument();
    expect(screen.getByText("Song 3")).toBeInTheDocument();
    expect(screen.getByText("Song 4")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by artist" }), { target: { value: "Artist 2" } });
    expect(screen.getByText("No songs match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all songs" }));
    expect(screen.getByText("Song 2")).toBeInTheDocument();
    expect(screen.getByText("Song 3")).toBeInTheDocument();
  });

  it("locks a song in the editor when its row is clicked", async () => {
    const onLockSong = vi.fn();
    renderSection(done({ checked: 2, matches: [match(2), match(3)] }), editable({ onLockSong }));
    fireEvent.click(await screen.findByText("Artist 3"));
    expect(onLockSong).toHaveBeenCalledWith(expect.objectContaining({ track: expect.objectContaining({ uri: "spotify:track:3" }) }));
  });
});
