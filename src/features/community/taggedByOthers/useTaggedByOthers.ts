import { useCallback, useEffect, useState } from "react";
import { recordProductInteraction, type ProductEventDetails } from "@/features/product-analytics/productAnalytics";
import { spotifyApiService, type RootlistCatalogPlaylist } from "@/services/SpotifyApiService";
import { taggedByOthersAllowance, type TaggedByOthersAllowance } from "./taggedByOthersAllowance";
import {
  currentLookupSession, isCheckablePlaylist, planPlaylists, savedLookupLimit, scanTaggedByOthers,
  type TaggedByOthersOutcome, type TaggedByOthersProgress,
} from "./taggedByOthersScan";
import { SAVED_CHECK_FRESH_MS, taggedByOthersStore, type SavedCheck, type TaggedByOthersStore } from "./taggedByOthersStore";

/** "Check again" comes back this long after a check finished, so tapping it can't keep re-reading Spotify. */
export const CHECK_AGAIN_AFTER_MS = 30 * 60_000;

export interface TaggedByOthersView extends TaggedByOthersOutcome {
  /** "loading" while the saved check is read; nothing is shown yet. */
  phase: "loading" | "checking" | "done";
  /** Which check is running: Liked Songs, or "Also check my playlists". */
  checking: "liked" | "playlists" | null;
  /** When the check shown finished; null while checking. */
  checkedAt: number | null;
  /** A day-old check stays on screen while a new Liked Songs check runs quietly behind it. */
  refreshing: boolean;
}

type CheckOptions = { signal: AbortSignal; onProgress: (progress: TaggedByOthersProgress) => void; allowance: TaggedByOthersAllowance };
/** Checks Liked Songs; with `continueFrom`, carries on from a check Spotify closed or reloaded part way through. */
export type TaggedByOthersCheck = (options: CheckOptions & { continueFrom?: TaggedByOthersOutcome }) => Promise<TaggedByOthersOutcome>;
/** Checks the next playlists, carrying on from the check shown. */
export type TaggedByOthersPlaylistCheck = (options: CheckOptions & { previous: TaggedByOthersOutcome; chosen?: readonly string[] }) => Promise<TaggedByOthersOutcome>;

const NOTHING: TaggedByOthersOutcome = {
  scope: "liked", checked: 0, matches: [], playlistsRead: 0, playlists: null, skippedPlaylists: 0, capped: false,
  stopped: null, songIds: [], playlistIds: [], playlistsLeft: null,
};

/** Why the app can't ask Community right now, before anything is read from Spotify; null when it can. */
function lookupLimit(): { batchSize?: number } | Pick<TaggedByOthersOutcome, "stopped"> {
  const session = currentLookupSession();
  // Sync refreshes a session about to expire; the next opening checks again.
  if (!session) return { stopped: "unreachable" };
  const limit = savedLookupLimit(session.apiBaseUrl);
  // Community said it has no lookup yet, so Spotify isn't read for nothing.
  if (limit === null) return { stopped: "not-available" };
  // Without a saved list, the most a request takes.
  return { batchSize: limit ?? undefined };
}

/**
 * The check as the app runs it: Liked Songs through Spotify's desktop library, Community with this
 * device's session. Playlists aren't read: they took about 95% of the time for about 0.3% of the songs found.
 */
export const checkLibrary: TaggedByOthersCheck = async ({ signal, onProgress, allowance, continueFrom }) => {
  const limit = lookupLimit();
  if ("stopped" in limit) return { ...(continueFrom ?? NOTHING), stopped: limit.stopped };
  return scanTaggedByOthers({ library: spotifyApiService, batchSize: limit.batchSize, allowance, signal, onProgress, continueFrom });
};

/**
 * "Also check my playlists": reads the playlist list with ownership and sizes (one rootlist read and
 * one Liked Songs size read), then the next playlists `planPlaylists` picks, and says how many are left.
 */
export const checkPlaylists: TaggedByOthersPlaylistCheck = async ({ previous, chosen, signal, onProgress, allowance }) => {
  const start = { ...previous, stopped: null };
  const limit = lookupLimit();
  if ("stopped" in limit) return { ...start, stopped: limit.stopped };
  let catalog = recentCatalog();
  if (!catalog) {
    if (!allowance.take(2)) return { ...start, stopped: "allowance" };
    try {
      catalog = (await spotifyApiService.readSpotifyListCatalog(signal)).playlists;
    } catch (error) {
      if (signal.aborted) throw error;
      return { ...start, stopped: "spotify" };
    }
  }
  const { left, next } = planPlaylists(catalog, previous.playlistIds, chosen);
  if (!next.length) return { ...start, scope: "liked+playlists", playlistsLeft: 0 };
  const outcome = await scanTaggedByOthers({ library: spotifyApiService, playlists: next, continueFrom: start, batchSize: limit.batchSize, allowance, signal, onProgress });
  const read = new Set(outcome.playlistIds);
  return { ...outcome, playlistsLeft: left.filter((playlist) => !read.has(playlist.playlistId)).length };
};

/** The playlist list the picker read, reused by the check that follows so it isn't read twice. */
const CATALOG_KEPT_MS = 10 * 60_000;
let lastCatalog: { at: number; playlists: RootlistCatalogPlaylist[] } | null = null;
const recentCatalog = () => (lastCatalog && Date.now() - lastCatalog.at < CATALOG_KEPT_MS ? lastCatalog.playlists : null);

/**
 * The playlists the member can choose from in the playlist picker: only ones they made, with songs,
 * in library order with their folders. Reading the list costs the same two reads as a playlist check's
 * first step; null when Tagify's read limit or Spotify says to wait.
 */
export type PlaylistChoicesReader = (allowance: TaggedByOthersAllowance, signal?: AbortSignal) => Promise<RootlistCatalogPlaylist[] | null>;
export const readPlaylistChoices: PlaylistChoicesReader = async (allowance, signal) => {
  const kept = recentCatalog();
  if (kept) return kept.filter(isCheckablePlaylist);
  if (!allowance.take(2)) return null;
  try {
    const playlists = (await spotifyApiService.readSpotifyListCatalog(signal)).playlists;
    lastCatalog = { at: Date.now(), playlists };
    return playlists.filter(isCheckablePlaylist);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
};

/** A finished check, in sizes too coarse to describe anyone's library. */
export function checkCompletedDetails(outcome: TaggedByOthersOutcome): ProductEventDetails {
  const checked = outcome.checked, matched = outcome.matches.length;
  return {
    songs_checked: checked === 0 ? "0" : checked < 100 ? "1-99" : checked < 1_000 ? "100-999" : checked < 10_000 ? "1000-9999" : "10000+",
    songs_matched: matched === 0 ? "0" : matched < 10 ? "1-9" : matched < 100 ? "10-99" : matched < 1_000 ? "100-999" : "1000+",
    // Reaching Tagify's own read limit is reported as a Spotify stop: no new outcome values without Alex's yes.
    outcome: outcome.stopped === null ? "complete" : outcome.stopped === "spotify" || outcome.stopped === "allowance" ? "spotify_stopped" : outcome.stopped === "busy" ? "limited" : "community_stopped",
  };
}

const WAITING: TaggedByOthersView = { phase: "loading", ...NOTHING, checking: null, checkedAt: null, refreshing: false };
const shown = (check: SavedCheck): TaggedByOthersView => ({ phase: "done", ...NOTHING, ...check.outcome, checking: null, checkedAt: check.checkedAt, refreshing: false });
/** A check saved while it ran, shown as running again while it continues. */
const resumed = (check: SavedCheck): TaggedByOthersView => ({
  ...shown(check), phase: "checking", checking: check.outcome.scope === "liked" ? "liked" : "playlists", stopped: null, checkedAt: null,
});

// The last finished check, kept while Spotify stays open so reopening Community doesn't check again.
let remembered: SavedCheck | null = null;

// The check saved on this computer, read before the view first opens so it appears at once
// instead of after a blank frame. The view still reads the store itself and decides what to run.
let preloaded: { account: string; saved: SavedCheck | null } | null = null;
const preloading = new Map<string, Promise<void>>();

/** Reads the saved check ahead of time, so opening the view first shows it without a blank frame. */
export function preloadTaggedByOthers(account: string | null, store: TaggedByOthersStore = taggedByOthersStore): Promise<void> {
  if (!account || preloaded?.account === account) return Promise.resolve();
  let pending = preloading.get(account);
  if (!pending) {
    pending = store.load(account).then((saved) => { preloaded = { account, saved }; }, () => {}).finally(() => preloading.delete(account));
    preloading.set(account, pending);
  }
  return pending;
}

const initialView = (account: string | null): TaggedByOthersView => {
  if (!account) return WAITING;
  if (job?.account === account) return job.view;
  if (remembered?.account === account) return shown(remembered);
  const saved = preloaded?.account === account ? preloaded.saved : null;
  return saved ? (saved.inProgress ? resumed(saved) : shown(saved)) : WAITING;
};

// The check that is running. It belongs to the account, not to the view: closing and reopening
// Community shows the same check instead of starting another one from the top.
interface Job { account: string; controller: AbortController; view: TaggedByOthersView; listeners: Set<(view: TaggedByOthersView) => void> }
let job: Job | null = null;

/** Stops a running check and forgets the one kept in memory (the saved one is the store's). For another account or disconnecting. */
export function forgetTaggedByOthers(): void {
  lastCatalog = null;
  job?.controller.abort();
  job = null;
  remembered = null;
  preloaded = null;
}

interface Dependencies { check: TaggedByOthersCheck; checkMore: TaggedByOthersPlaylistCheck; store: TaggedByOthersStore; now: () => number; allowance: (account: string) => TaggedByOthersAllowance }

/**
 * Starts a check. "liked" checks Liked Songs from the top, "playlists" the next playlists after the
 * check shown, "resume" continues a check saved while it ran (Spotify closed or reloaded part way),
 * and "refresh" checks Liked Songs again quietly behind a day-old check, which stays on screen.
 */
function startCheck(account: string, kind: "liked" | "playlists" | "resume" | "refresh", { check, checkMore, store, now, allowance }: Dependencies, saved: SavedCheck | null = null, chosen?: readonly string[]): Job | null {
  const continued = kind === "resume" ? saved : null;
  const previous = kind === "playlists" && remembered?.account === account ? remembered
    : continued && continued.outcome.scope !== "liked" ? continued : null;
  if (kind === "playlists" && !previous) return null;
  const quiet = kind === "refresh" ? saved : null;
  job?.controller.abort();
  const controller = new AbortController();
  const begin: TaggedByOthersView = quiet ? { ...shown(quiet), refreshing: true }
    : continued ? resumed(continued)
    : previous ? { ...shown(previous), phase: "checking", checking: "playlists", stopped: null, checkedAt: null }
    : { ...WAITING, phase: "checking", checking: "liked" };
  const current: Job = { account, controller, view: begin, listeners: new Set() };
  job = current;
  const publish = (view: TaggedByOthersView) => {
    current.view = view;
    for (const listener of current.listeners) listener(view);
  };
  // Every answer from Community is saved, so leaving, closing or reloading Spotify loses at most one
  // batch. Saves land in order and only the newest waiting one is written, so a slow disk never
  // builds a queue. A quiet check keeps the day-old one saved until it has something better.
  let saving: Promise<void> = Promise.resolve();
  let next: SavedCheck | null = null;
  const save = (check: SavedCheck) => {
    next = check;
    saving = saving.then(() => {
      const write = next;
      next = null;
      return write && !controller.signal.aborted ? store.save(write) : undefined;
    }).catch(() => {});
  };
  const base = previous?.outcome ?? continued?.outcome ?? NOTHING;
  const onProgress = (progress: TaggedByOthersProgress) => {
    if (controller.signal.aborted || quiet) return;
    publish({ ...current.view, ...progress });
    save({ account, checkedAt: now(), inProgress: true, outcome: { ...base, ...progress, stopped: null } });
  };
  const options = { signal: controller.signal, onProgress, allowance: allowance(account) };
  const run = previous ? checkMore({ ...options, previous: previous.outcome, chosen })
    : continued ? check({ ...options, continueFrom: continued.outcome })
    : check(options);
  void run
    .catch((): TaggedByOthersOutcome => ({ ...base, stopped: "unreachable" }))
    .then((outcome) => {
      if (controller.signal.aborted || job !== current) return;
      job = null;
      // A quiet check that couldn't finish leaves the day-old one in place; it runs again next time.
      if (quiet && outcome.stopped !== null) { publish(shown(quiet)); return; }
      const finished: SavedCheck = { account, checkedAt: now(), outcome };
      // A Liked Songs check Community couldn't answer is saved as still running, so the next time
      // Community opens it continues from the songs already checked. Anything else is kept as it
      // ended, so reopening Community or reloading Spotify shows it instead of reading the library again.
      const communityFailed = outcome.stopped === "unreachable" || outcome.stopped === "paused" || outcome.stopped === "not-available";
      if (communityFailed && !previous) {
        if (outcome.songIds.length) save({ ...finished, inProgress: true });
      } else {
        remembered = finished;
        save(finished);
      }
      publish(shown(finished));
      if (!previous) recordProductInteraction("community_library_check_completed", checkCompletedDetails(outcome));
    });
  return current;
}

/**
 * Other members' tags on this member's Liked Songs (and playlists, when they ask). Shows the last
 * check at once: the running one, the one from this Spotify session, or the one saved on this
 * computer. Checks by itself only when there is none, or the saved one is over a day old. A check
 * keeps going when the view closes and stops when the account changes or the member disconnects.
 * `checkAgain` checks Liked Songs now; `checkPlaylists` checks the next playlists.
 */
export function useTaggedByOthers(account: string | null, {
  check = checkLibrary, checkMore = checkPlaylists, store = taggedByOthersStore, now = Date.now, allowance = taggedByOthersAllowance,
}: Partial<Dependencies> = {}): { view: TaggedByOthersView; checkAgain: () => void; checkPlaylists: (chosen?: readonly string[]) => void } {
  const [view, setView] = useState<TaggedByOthersView>(() => initialView(account));
  // A different account's check never shows here, not even for one render.
  const [shownFor, setShownFor] = useState(account);
  if (shownFor !== account) { setShownFor(account); setView(WAITING); }
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!account) return;
    let live = true;
    let attachedTo: Job | null = null;
    const show = (next: TaggedByOthersView) => { if (live) setView(next); };
    const attach = () => {
      if (job?.account !== account) return false;
      attachedTo = job;
      job.listeners.add(show);
      show(job.view);
      return true;
    };
    void (async () => {
      if (attach()) return;
      if (remembered?.account === account) { show(shown(remembered)); return; }
      const saved = await store.load(account);
      // Another view may have started a check meanwhile.
      if (!live || attach()) return;
      const dependencies = { check, checkMore, store, now, allowance };
      // A check Spotify closed or reloaded part way through continues from the songs it checked.
      if (saved?.inProgress) { startCheck(account, "resume", dependencies, saved); attach(); return; }
      if (saved) {
        remembered = saved;
        // A check over a day old stays on screen while a new one runs behind it.
        if (now() - saved.checkedAt >= SAVED_CHECK_FRESH_MS) { startCheck(account, "refresh", dependencies, saved); attach(); return; }
        show(shown(saved));
        return;
      }
      startCheck(account, "liked", dependencies);
      attach();
    })();
    return () => {
      live = false;
      // Only the view stops listening; the check goes on.
      attachedTo?.listeners.delete(show);
    };
  }, [account, attempt, check, checkMore, store, now, allowance]);

  const begin = useCallback((kind: "liked" | "playlists", chosen?: readonly string[]) => {
    // A quiet check behind a day-old one gives way to the member's own.
    if (account && job?.account === account && job.view.refreshing) { job.controller.abort(); job = null; }
    if (!account || job?.account === account) return;
    if (!startCheck(account, kind, { check, checkMore, store, now, allowance }, null, chosen)) return;
    // Re-runs the effect, which shows the new check.
    setAttempt((current) => current + 1);
  }, [account, check, checkMore, store, now, allowance]);
  const checkAgain = useCallback(() => begin("liked"), [begin]);
  const checkMorePlaylists = useCallback((chosen?: readonly string[]) => begin("playlists", chosen), [begin]);

  return { view, checkAgain, checkPlaylists: checkMorePlaylists };
}
