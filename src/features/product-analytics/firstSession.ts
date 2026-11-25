/**
 * First session of a brand-new account (docs/PRODUCT_ANALYTICS.md, "First session"). Tracking starts at the
 * first `tagify_opened` with an empty library and ends once, with `first_session_ended`, when Spotify closes,
 * after 30 minutes without activity, or (when neither could be sent) on the next start.
 *
 * Pure local state only: productAnalytics calls `observeFirstSessionEvent` for every recorded event, so this
 * module must not import productAnalytics or the first-run tips. Song URIs stay on this device; only counts
 * leave it.
 */
export const FIRST_SESSION_PREFIX = "tagify:product-analytics:first-session:";
/** No activity for this long ends the session. */
export const IDLE_END_MS = 30 * 60_000;
/** Input in the last five minutes counts the time as active. */
export const ACTIVE_INPUT_MS = 5 * 60_000;
/** Longest stretch one heartbeat can add, so a sleeping computer never counts as active. */
export const MAX_TICK_MS = 60_000;
const MAX_SONGS = 25;

export interface FirstSessionState {
  startedAt: number;
  /** Last heartbeat while this session's Tagify was running. */
  lastTickAt: number;
  /** Last moment the person was active (input while Spotify was visible). */
  lastActiveAt: number;
  activeMs: number;
  tagged: boolean;
  rated: boolean;
  /** Distinct songs opened in Tagify, kept on this device only. */
  songs: string[];
  lastTip?: string;
  lastTipHow?: string;
  ended: boolean;
}

export type FirstSessionEnd = "closed" | "idle" | "next_open";

export interface FirstSessionDetails {
  tagged: "yes" | "no";
  rated: "yes" | "no";
  songs_viewed: "0" | "1" | "2-4" | "5-9" | "10-24" | "25+";
  last_tip: string;
  how?: string;
  minutes: "0" | "1" | "2-4" | "5-9" | "10-19" | "20-39" | "40-59" | "60+";
  ended_by: FirstSessionEnd;
}

export function readFirstSession(account: string): FirstSessionState | null {
  try {
    const value = JSON.parse(localStorage.getItem(FIRST_SESSION_PREFIX + account) || "null") as FirstSessionState | null;
    if (!value || typeof value !== "object" || !Number.isFinite(value.startedAt) || !Array.isArray(value.songs)) return null;
    return value;
  } catch { return null; }
}

export function writeFirstSession(account: string, state: FirstSessionState): void {
  try { localStorage.setItem(FIRST_SESSION_PREFIX + account, JSON.stringify(state)); } catch { /* Optional measurement. */ }
}

function update(account: string, change: (state: FirstSessionState) => void): void {
  const state = readFirstSession(account);
  if (!state || state.ended) return;
  change(state);
  writeFirstSession(account, state);
}

/** Called for every event the client records; starts, and feeds, the first session. */
export function observeFirstSessionEvent(account: string, event: string, details: Record<string, unknown>, now = Date.now()): void {
  if (event === "tagify_opened" && details.saved_songs === "0") {
    // Once per account and device: a later empty-library open never starts a second "first" session.
    try { if (localStorage.getItem(FIRST_SESSION_PREFIX + account) !== null) return; } catch { return; }
    writeFirstSession(account, { startedAt: now, lastTickAt: now, lastActiveAt: now, activeMs: 0, tagged: false, rated: false, songs: [], ended: false });
    return;
  }
  if (event === "tagging_completed") update(account, (state) => { state.tagged = true; });
  else if (event === "rating_completed") update(account, (state) => { state.rated = true; });
  else if (event === "first_run_tip_shown" && typeof details.tip === "string") {
    const tip = details.tip;
    update(account, (state) => { state.lastTip = tip; delete state.lastTipHow; });
  } else if (event === "first_run_tip_done" && typeof details.tip === "string" && typeof details.how === "string") {
    const { tip, how } = details as { tip: string; how: string };
    update(account, (state) => { state.lastTip = tip; state.lastTipHow = how; });
  }
}

export function noteFirstSessionSong(account: string, uri: string): void {
  update(account, (state) => {
    if (!state.songs.includes(uri) && state.songs.length < MAX_SONGS) state.songs.push(uri);
  });
}

/**
 * Heartbeat: adds active time and saves `lastTickAt`, so a session cut off by a crash or quit can still be
 * reported on the next start. Returns the state after the tick, or null when nothing is being tracked.
 */
export function tickFirstSession(account: string, now: number, visible: boolean, lastInputAt: number): FirstSessionState | null {
  const state = readFirstSession(account);
  if (!state || state.ended) return null;
  const active = visible && now - lastInputAt < ACTIVE_INPUT_MS;
  if (active) {
    state.activeMs += Math.max(0, Math.min(now - state.lastTickAt, MAX_TICK_MS));
    state.lastActiveAt = Math.max(state.lastActiveAt, Math.min(now, lastInputAt + ACTIVE_INPUT_MS));
  }
  state.lastTickAt = now;
  writeFirstSession(account, state);
  return state;
}

export function songsViewedBucket(count: number): FirstSessionDetails["songs_viewed"] {
  return count <= 0 ? "0" : count === 1 ? "1" : count < 5 ? "2-4" : count < 10 ? "5-9" : count < 25 ? "10-24" : "25+";
}

export function minutesBucket(ms: number): FirstSessionDetails["minutes"] {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes < 1 ? "0" : minutes < 2 ? "1" : minutes < 5 ? "2-4" : minutes < 10 ? "5-9" : minutes < 20 ? "10-19" : minutes < 40 ? "20-39" : minutes < 60 ? "40-59" : "60+";
}

/** Marks the session ended and returns the event's details, or null when it already ended. */
export function endFirstSession(account: string, endedBy: FirstSessionEnd): { details: FirstSessionDetails; at: number } | null {
  const state = readFirstSession(account);
  if (!state || state.ended) return null;
  state.ended = true;
  const details: FirstSessionDetails = {
    tagged: state.tagged ? "yes" : "no",
    rated: state.rated ? "yes" : "no",
    songs_viewed: songsViewedBucket(state.songs.length),
    last_tip: state.lastTip ?? "none",
    minutes: minutesBucket(state.activeMs),
    ended_by: endedBy,
  };
  if (state.lastTip && state.lastTipHow) details.how = state.lastTipHow;
  // Only the counts leave the device; the song list isn't needed once the session is over.
  writeFirstSession(account, { ...state, songs: [] });
  return { details, at: endedBy === "closed" ? Date.now() : state.lastActiveAt };
}
