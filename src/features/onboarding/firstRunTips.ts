import { useSyncExternalStore } from "react";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";

/**
 * First-run tips (docs/ONBOARDING_FIRST_RUN_PLAN_2026-11.md, section 10): small popovers that point at
 * the real controls, one at a time, each once per device.
 */
export const FIRST_RUN_TIPS_KEY = "tagify:first-run-tips";

export type FirstRunTipId = CoreTipId | HowToTipId;
/** The tour, in order: play a song (1b, only when nothing plays), rate it, tag it, Manage Tags, the Tagged Tracks list, Tagged by others. */
export type CoreTipId = "play" | "tag" | "rate" | "manage" | "tagged" | "others";
/** Later tips: each shows once, at the moment it is useful, never during the tour. */
export type HowToTipId = "playlist" | "smart";
export type FirstRunTipHow = "action" | "got_it" | "skipped";

export interface FirstRunTipsState {
  /** Tips drawn at least once on this device. */
  shown: FirstRunTipId[];
  /** Tips finished, and how. */
  done: Partial<Record<FirstRunTipId, FirstRunTipHow>>;
  /** "Skip tips" turns off every tip still to come. */
  skipped: boolean;
  /** Set by "Show tips again": tips run for an existing library too. */
  again?: boolean;
  /** Tagged songs when "Show tips again" was used; a tip about tagging waits for a new one. */
  baseline?: number;
}

const EMPTY: FirstRunTipsState = { shown: [], done: {}, skipped: false };

function parse(raw: string | null): FirstRunTipsState {
  try {
    const saved = JSON.parse(raw || "null") as Partial<FirstRunTipsState> | null;
    if (!saved || typeof saved !== "object") return EMPTY;
    return {
      shown: Array.isArray(saved.shown) ? saved.shown : [],
      done: saved.done && typeof saved.done === "object" ? saved.done : {},
      skipped: saved.skipped === true,
      ...(saved.again === true ? { again: true } : {}),
      ...(typeof saved.baseline === "number" ? { baseline: saved.baseline } : {}),
    };
  } catch {
    return EMPTY;
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(FIRST_RUN_TIPS_KEY);
  } catch {
    return null;
  }
}

// One store for every tip (core and how-to), so two hooks never overwrite each other's saves.
// The snapshot follows storage, so a change made elsewhere (or a cleared test) is picked up.
let cachedRaw: string | null | undefined;
let cached: FirstRunTipsState = EMPTY;
let memoryOnly: FirstRunTipsState | null = null;
const listeners = new Set<() => void>();

export function readFirstRunTips(): FirstRunTipsState {
  if (memoryOnly) return memoryOnly;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

/** Applies a change to the tips state, saves it and tells every tip hook. */
export function updateFirstRunTips(change: (current: FirstRunTipsState) => FirstRunTipsState): void {
  const current = readFirstRunTips();
  const next = change(current);
  if (next === current) return;
  try {
    localStorage.setItem(FIRST_RUN_TIPS_KEY, JSON.stringify(next));
    memoryOnly = null;
  } catch {
    // Storage unavailable: keep it for this session; the tips may show again next time.
    memoryOnly = next;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFirstRunTipsState(): FirstRunTipsState {
  return useSyncExternalStore(subscribe, readFirstRunTips);
}

/** "Show tips again" in Info: every tip can show once more, counting from the songs tagged then. */
export function showFirstRunTipsAgain(): void {
  // The tips hook records the baseline, since it knows how many songs are tagged.
  updateFirstRunTips(() => ({ shown: [], done: {}, skipped: false, again: true }));
}

/** Records the first time a tip is drawn on this device. */
export function markTipShown(state: FirstRunTipsState, tip: FirstRunTipId): FirstRunTipsState {
  if (state.shown.includes(tip)) return state;
  recordProductInteraction("first_run_tip_shown", { tip });
  return { ...state, shown: [...state.shown, tip] };
}

/**
 * Finishes a tip. The event goes out only for a tip the person saw, so "done" never counts a tip that
 * was passed over because they did the thing first.
 */
export function markTipDone(state: FirstRunTipsState, tip: FirstRunTipId, how: FirstRunTipHow): FirstRunTipsState {
  if (state.done[tip]) return state;
  if (state.shown.includes(tip)) recordProductInteraction("first_run_tip_done", { tip, how });
  return { ...state, done: { ...state.done, [tip]: how }, skipped: state.skipped || how === "skipped" };
}
