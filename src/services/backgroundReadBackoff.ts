// Adaptive pacing for background Spotify reads. A Spotify pause Tagify hasn't seen before
// (`pauseUntil` moved forward, as every 429 does through the shared background policy) doubles the
// wait between reads, up to `maxSlowdown` times; `recoveryReads` reads without one halve it again.
// Retry-After itself is honored by the shared pause, which reservations respect: no read is made
// while it holds, and nothing is retried around it. Kept across restarts under `key`.

type BackoffStorage = Pick<globalThis.Storage, "getItem" | "setItem">;

export interface BackgroundReadBackoffOptions {
  key: string;
  pauseUntil: () => number;
  maxSlowdown: number;
  recoveryReads: number;
  storage?: BackoffStorage | null;
  now?: () => number;
}

export interface BackgroundReadBackoff {
  /** Called before each read (and when a run stops at a pause): notes a new pause (slowing down) or counts a read without one (speeding up again). */
  note(): void;
  /** How many times slower than the pace reads are now. */
  slowdown(): number;
}

const defaultStorage = (): BackoffStorage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

export function backgroundReadBackoff(options: BackgroundReadBackoffOptions): BackgroundReadBackoff {
  const { key, pauseUntil, maxSlowdown, recoveryReads } = options;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? Date.now;
  const read = () => {
    let saved: Record<string, unknown> | null = null;
    try {
      const value = JSON.parse(storage?.getItem(key) ?? "null") as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) saved = value as Record<string, unknown>;
    } catch { /* Start over at full pace. */ }
    return {
      factor: whole(saved?.factor, 1, maxSlowdown) ? saved.factor : 1,
      seenUntil: typeof saved?.seenUntil === "number" ? saved.seenUntil : 0,
      streak: whole(saved?.streak, 0, Number.MAX_SAFE_INTEGER) ? saved.streak : 0,
    };
  };
  const write = (value: unknown) => {
    try { storage?.setItem(key, JSON.stringify(value)); } catch { /* The shared pause still protects this run. */ }
  };
  return {
    note(): void {
      const state = read();
      const until = pauseUntil();
      if (until > now() && until > state.seenUntil) {
        write({ factor: Math.min(maxSlowdown, state.factor * 2), seenUntil: until, streak: 0 });
        return;
      }
      const streak = state.streak + 1;
      write(streak >= recoveryReads && state.factor > 1
        ? { factor: state.factor / 2, seenUntil: state.seenUntil, streak: 0 }
        : { ...state, streak });
    },
    slowdown(): number { return read().factor; },
  };
}
