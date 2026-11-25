import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { recordProductEvent, sendProductEventsNow, type ProductEventDetails } from "./productAnalytics";
import { endFirstSession, IDLE_END_MS, noteFirstSessionSong, readFirstSession, tickFirstSession, type FirstSessionEnd } from "./firstSession";

/** Heartbeat while Tagify runs. */
export const TICK_MS = 30_000;
/** A session whose last heartbeat is older than this was cut off (Spotify quit or crashed). */
const STALE_MS = 2 * TICK_MS;
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel"] as const;

interface Watch { account: string; lastInputAt: number; stop: () => void }
let watch: Watch | null = null;
let starting: Promise<void> | null = null;

function visible(): boolean { return document.visibilityState !== "hidden"; }

function finish(account: string, endedBy: FirstSessionEnd): void {
  const ended = endFirstSession(account, endedBy);
  if (!ended) return;
  // Values outside the fixed lists are dropped by recordProductEvent, as for every event.
  recordProductEvent(account, "first_session_ended", ended.details as ProductEventDetails, ended.at);
  // The normal queue waits for a visible page; a closing or hidden Spotify gets one direct send.
  if (endedBy === "closed" || !visible()) sendProductEventsNow(account);
}

function tick(): void {
  if (!watch) return;
  const now = Date.now();
  const state = tickFirstSession(watch.account, now, visible(), watch.lastInputAt);
  if (state && now - state.lastActiveAt >= IDLE_END_MS) finish(watch.account, "idle");
}

/**
 * Starts the first-session heartbeat for this Spotify account (once per page). Reports a first session that
 * a quit or crash cut off before it could be sent, then watches the current one until it ends.
 */
export function startFirstSessionWatch(): Promise<void> {
  if (watch) return Promise.resolve();
  starting ??= getUsageAccountDigest().then((account) => {
    if (!account || watch) return;
    const previous = readFirstSession(account);
    if (previous && !previous.ended && Date.now() - previous.lastTickAt > STALE_MS) finish(account, "next_open");

    const current: Watch = { account, lastInputAt: Date.now(), stop: () => undefined };
    let lastInputTick = 0;
    const onInput = () => {
      current.lastInputAt = Date.now();
      // At most one extra heartbeat a second, so the first minutes count from the first click.
      if (current.lastInputAt - lastInputTick > 1000) { lastInputTick = current.lastInputAt; tick(); }
    };
    const onVisibility = () => tick();
    const onClose = () => { tick(); finish(account, "closed"); };
    const timer = setInterval(tick, TICK_MS);
    INPUT_EVENTS.forEach((name) => document.addEventListener(name, onInput, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onClose);
    current.stop = () => {
      clearInterval(timer);
      INPUT_EVENTS.forEach((name) => document.removeEventListener(name, onInput, { capture: true }));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onClose);
    };
    watch = current;
    tick();
  }).catch(() => { /* Optional measurement. */ }).finally(() => { starting = null; });
  return starting;
}

/** The song open in Tagify's editor; counted toward `songs_viewed` while a first session runs. */
export function noteFirstSessionSongViewed(uri: string | null): void {
  if (!uri) return;
  if (watch) noteFirstSessionSong(watch.account, uri);
  else void startFirstSessionWatch().then(() => { if (watch) noteFirstSessionSong(watch.account, uri); });
}

/** Tests only. */
export function stopFirstSessionWatch(): void {
  watch?.stop();
  watch = null;
  starting = null;
}
