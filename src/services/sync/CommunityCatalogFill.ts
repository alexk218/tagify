// Songs pasted on Community by link, and songs in libraries whose Tagify is off, can have no
// artists or release on Community. Community lists a few desktops (Alex's) that fill those in for
// everyone (Community migration 9003, docs/SAME_SONG_PASTE_HANDOFF_2026-10-27.md Slice 2): for such
// a desktop the existing artist credit and song release lists continue, after its own library, with
// songs from anywhere on Community. Since Community migration 9004 such a desktop also fills album
// track lists and artist discographies (CommunityCatalogFillJobs.ts). Everything outside this
// library is read slowly on purpose: one item at a time, at the pace Community advertises for this
// desktop (the conservative constants below unless Community says otherwise), within an hourly and
// a daily allowance, stopping at Spotify's first refusal or while Spotify asks Tagify to wait, and
// slowing down after every refusal. Other desktops are never sent such work.
import type { CatalogFillPaceV1 } from "@tagify/sync-contracts";

export const CATALOG_FILL_FEATURE = "community-catalog-fill";
/** Background Spotify reads for music outside this library in an hour, unless Community advertises another pace. */
export const CATALOG_FILL_HOURLY_READS = 60;
/** Spotify reads for music outside this library in a day on this computer, whatever the hour allows. */
export const CATALOG_FILL_DAILY_READS = 300;
/** The wait before every Spotify read for music outside this library. */
export const CATALOG_FILL_READ_INTERVAL_MS = 4_000;
export const DEFAULT_CATALOG_FILL_PACE: CatalogFillPaceV1 = {
  preset: "conservative", readIntervalMs: CATALOG_FILL_READ_INTERVAL_MS, hourlyReads: CATALOG_FILL_HOURLY_READS, dailyReads: CATALOG_FILL_DAILY_READS,
};
/** A pace Community advertised counts for a day; after that (or from a Community that never said) the constants hold. */
const PACE_TTL_MS = 24 * 60 * 60_000;
/** After a refusal, reads slow down (doubling the wait each time, at most this many times slower)… */
export const CATALOG_FILL_MAX_SLOWDOWN = 64;
/** …and speed up again (halving) after this many reads without one. */
export const CATALOG_FILL_RECOVERY_READS = 100;
const DAY_KEY = "tagify:community-catalog-fill:day:v1";
const PACE_KEY = "tagify:community-catalog-fill:pace:v1";
const BACKOFF_KEY = "tagify:community-catalog-fill:backoff:v1";

/** How Tagify reads music Community asks about that isn't in this library. */
export interface CatalogFillAllowance {
  /** The songs among these that are in this library, as Tagify saved them. No request. */
  libraryTracks(trackUris: string[]): Promise<Set<string>>;
  /** Takes one read from the hour's and the day's allowance; false when none is left or Spotify asked Tagify to wait. */
  reserve(identity: string): boolean;
  /** Waits before each read, as long as the pace (and any slowdown) says. */
  pace(): Promise<void>;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem"> & Partial<Pick<globalThis.Storage, "removeItem">>;
type Options = { storage?: Storage | null; now?: () => number };
const defaultStorage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const storageOf = (options: Options) => options.storage === undefined ? defaultStorage() : options.storage;
const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);
const readJson = (storage: Storage | null, key: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? "null") as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
};
const writeJson = (storage: Storage | null, key: string, value: unknown) => {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* The in-memory reservations still hold for this run. */ }
};
const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/**
 * Remembers the pace Community advertised for this desktop (the catalog fill run passes it on from
 * every jobs page). Null (Community says this desktop isn't a filler) forgets it.
 */
export function saveCatalogFillPace(pace: CatalogFillPaceV1 | null, options: Options = {}): void {
  const storage = storageOf(options);
  if (!pace) { try { storage?.removeItem?.(PACE_KEY); } catch { /* It expires anyway. */ } return; }
  writeJson(storage, PACE_KEY, { pace, savedAt: (options.now ?? Date.now)() });
}

/** The pace to keep now: what Community advertised in the last day, else the conservative constants. */
export function catalogFillPace(options: Options = {}): CatalogFillPaceV1 {
  const saved = readJson(storageOf(options), PACE_KEY);
  const now = (options.now ?? Date.now)();
  const pace = saved?.pace as Record<string, unknown> | undefined;
  const fresh = typeof saved?.savedAt === "number" && saved.savedAt <= now && now - saved.savedAt < PACE_TTL_MS;
  if (!fresh || !pace || (pace.preset !== "conservative" && pace.preset !== "fast") || !whole(pace.readIntervalMs, 250, 600_000)
    || !whole(pace.hourlyReads, 1, 100_000) || !whole(pace.dailyReads, 1, 1_000_000)) return DEFAULT_CATALOG_FILL_PACE;
  return { preset: pace.preset, readIntervalMs: pace.readIntervalMs, hourlyReads: pace.hourlyReads, dailyReads: pace.dailyReads };
}

/**
 * Adaptive backoff. A Spotify pause Tagify hasn't seen before (`pauseUntil` moved forward, as
 * every 429 does through the shared background policy) doubles the wait between reads, up to
 * CATALOG_FILL_MAX_SLOWDOWN times; CATALOG_FILL_RECOVERY_READS reads without one halve it again.
 * Retry-After itself is honored by the shared pause, which the reservations respect: no read is
 * made while it holds, and nothing is retried around it. Kept across restarts.
 */
export function catalogFillBackoff(pauseUntil: () => number, options: Options = {}) {
  const storage = storageOf(options);
  const now = options.now ?? Date.now;
  const read = () => {
    const saved = readJson(storage, BACKOFF_KEY);
    return {
      factor: whole(saved?.factor, 1, CATALOG_FILL_MAX_SLOWDOWN) ? saved.factor : 1,
      seenUntil: typeof saved?.seenUntil === "number" ? saved.seenUntil : 0,
      streak: whole(saved?.streak, 0, Number.MAX_SAFE_INTEGER) ? saved.streak : 0,
    };
  };
  return {
    /** Called before each read: notes a new pause (slowing down) or counts a read without one (speeding up again). */
    note(): void {
      const state = read();
      const until = pauseUntil();
      if (until > now() && until > state.seenUntil) {
        writeJson(storage, BACKOFF_KEY, { factor: Math.min(CATALOG_FILL_MAX_SLOWDOWN, state.factor * 2), seenUntil: until, streak: 0 });
        return;
      }
      const streak = state.streak + 1;
      writeJson(storage, BACKOFF_KEY, streak >= CATALOG_FILL_RECOVERY_READS && state.factor > 1
        ? { factor: state.factor / 2, seenUntil: state.seenUntil, streak: 0 }
        : { ...state, streak });
    },
    /** How many times slower than the pace reads are now. */
    slowdown(): number { return read().factor; },
  };
}

/**
 * Wraps the hourly reservation in the day's cap, shared by every filler run and kept across
 * restarts. A read the hour refuses doesn't count against the day.
 */
export function withinDailyCap(
  reserve: (identity: string) => boolean,
  options: Options & { dailyReads?: () => number } = {},
): (identity: string) => boolean {
  const storage = storageOf(options);
  const now = options.now ?? Date.now;
  const dailyReads = options.dailyReads ?? (() => CATALOG_FILL_DAILY_READS);
  return (identity) => {
    const today = dayOf(now());
    const saved = readJson(storage, DAY_KEY);
    const reads = saved?.day === today && typeof saved.reads === "number" && saved.reads >= 0 ? saved.reads : 0;
    if (reads >= dailyReads() || !reserve(identity)) return false;
    writeJson(storage, DAY_KEY, { day: today, reads: reads + 1 });
    return true;
  };
}

/**
 * Splits a page Community asked for into music in this library and songs outside it. Without an
 * allowance (or with nothing outside), every item stays on the library path, exactly as before.
 */
export async function splitOutsideLibrary<T extends { kind: string; providerId: string }>(
  items: T[], fill: CatalogFillAllowance | undefined,
): Promise<{ library: T[]; outside: T[] }> {
  const tracks = items.filter((item) => item.kind === "track").map((item) => `spotify:track:${item.providerId}`);
  if (!fill || !tracks.length) return { library: items, outside: [] };
  const inLibrary = await fill.libraryTracks(tracks);
  const outside = items.filter((item) => item.kind === "track" && !inLibrary.has(`spotify:track:${item.providerId}`));
  if (!outside.length) return { library: items, outside };
  const skipped = new Set(outside);
  return { library: items.filter((item) => !skipped.has(item)), outside };
}
