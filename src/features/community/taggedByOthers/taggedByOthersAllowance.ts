// How much "Your songs, tagged by others" may read from Spotify on this computer. Restarting a
// check (Check again, reopening Community, reloading Spotify) starts reading from the top, so the
// reads are counted here, outside any one check, and survive a reload. A check that reaches either
// limit stops with what it found; nothing is retried and Spotify's own pause is never cleared.

/** Spotify reads an hour: about two Liked Songs checks of a 26,000-song library, or one and a few hundred playlists. */
export const READS_PER_HOUR = 1_200;
/** Spotify reads a UTC day. */
export const READS_PER_DAY = 4_000;
const HOUR = 60 * 60_000;
const KEY = "tagify:tagged-by-others:reads:v1";

interface Counts { account: string; hourStart: number; hour: number; day: string; today: number }
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface TaggedByOthersAllowance {
  /** Counts `reads` Spotify reads, or answers false (counting nothing) when they would pass a limit. */
  take(reads: number): boolean;
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The allowance for this Community account on this computer. Storage that can't be read or written counts in memory instead. */
export function taggedByOthersAllowance(account: string, {
  storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })() as StorageLike | null,
  now = Date.now,
  perHour = READS_PER_HOUR,
  perDay = READS_PER_DAY,
}: { storage?: StorageLike | null; now?: () => number; perHour?: number; perDay?: number } = {}): TaggedByOthersAllowance {
  let kept: Counts | null = null;
  const load = (): Counts => {
    const at = now();
    let counts: Counts | null = kept;
    try {
      const saved = JSON.parse(storage?.getItem(KEY) ?? "null") as Partial<Counts> | null;
      if (saved && saved.account === account && [saved.hourStart, saved.hour, saved.today].every(Number.isFinite) && typeof saved.day === "string") counts = saved as Counts;
    } catch { /* The in-memory count stands. */ }
    if (!counts || counts.account !== account) counts = { account, hourStart: at, hour: 0, day: dayOf(at), today: 0 };
    // A clock that moved backwards starts a new hour rather than never ending this one.
    if (at - counts.hourStart >= HOUR || counts.hourStart > at) counts = { ...counts, hourStart: at, hour: 0 };
    if (counts.day !== dayOf(at)) counts = { ...counts, day: dayOf(at), today: 0 };
    return counts;
  };
  return {
    take(reads) {
      const counts = load();
      const cost = Math.max(1, Math.ceil(reads));
      if (counts.hour + cost > perHour || counts.today + cost > perDay) { kept = counts; return false; }
      kept = { ...counts, hour: counts.hour + cost, today: counts.today + cost };
      try { storage?.setItem(KEY, JSON.stringify(kept)); } catch { /* Counted in memory. */ }
      return true;
    },
  };
}
