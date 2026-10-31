import type { CatalogFillRunJob } from "@tagify/sync-contracts";
import type { CatalogFillRunReport } from "./CommunityCatalogFillRunLog";

// Live view of a catalog filler desktop's background Spotify readers (artist names, song releases,
// catalog fill jobs), for the local filler widget (scripts/filler-live.mjs), which reads
// `globalThis.TagifyCatalogFillLive.snapshot()` through the filler's own debug port. Kept in memory
// only: nothing here is sent anywhere, stored, or reads Spotify, and every call is cheap and never
// throws, so it can't slow down or break a reader. The run log (CommunityCatalogFillRunLog.ts) stays
// the record Community keeps; this only shows what a run is doing while it runs.

export type CatalogFillLiveEvent =
  | { at: number; job: CatalogFillRunJob; type: "read"; kind: string; id: string }
  | { at: number; job: CatalogFillRunJob; type: "refused"; kind: string; id: string }
  | { at: number; job: CatalogFillRunJob; type: "sent"; count: number };

export interface CatalogFillLiveRun {
  job: CatalogFillRunJob;
  startedAt: number;
  reads: number;
  sent: number;
  lastReadAt: number | null;
}

export interface CatalogFillLiveMinute { minute: number; reads: number; refused: number; sent: number }

export interface CatalogFillLiveSnapshot {
  version: 1;
  now: number;
  /** When Tagify started watching (its start). */
  since: number;
  /** Whether Community lists this desktop as a filler; null until it says. */
  filler: boolean | null;
  running: CatalogFillLiveRun | null;
  /** When the filler next wakes for a reader; null when nothing is scheduled. */
  nextWakeAt: number | null;
  /** Newest first. */
  events: CatalogFillLiveEvent[];
  /** Reads, refusals and sent items per minute over the last hour, oldest first (minute = epoch ms at its start). */
  minutes: CatalogFillLiveMinute[];
  /** Finished runs since Tagify started, newest first. */
  runs: (CatalogFillRunReport & { recordedLocallyAt: number })[];
}

const MAX_EVENTS = 300;
const MAX_RUNS = 30;
const MINUTE_MS = 60_000;
const MAX_MINUTES = 60;

/** "spotify:album:<id>", "catalog-fill:spotify:artist:<id>:2" and the like: the item's kind and ID. */
export function catalogFillItem(identity: string): { kind: string; id: string } {
  const match = /spotify:(track|album|artist):([A-Za-z0-9]{22})/.exec(identity);
  return match ? { kind: match[1], id: match[2] } : { kind: "other", id: "" };
}

class CatalogFillLive {
  private readonly since = Date.now();
  private filler: boolean | null = null;
  private running: CatalogFillLiveRun | null = null;
  private nextWakeAt: number | null = null;
  private events: CatalogFillLiveEvent[] = [];
  private runs: CatalogFillLiveSnapshot["runs"] = [];
  private minutes: CatalogFillLiveMinute[] = [];

  started(job: CatalogFillRunJob): void {
    this.running = { job, startedAt: Date.now(), reads: 0, sent: 0, lastReadAt: null };
  }

  /** One reservation for a Spotify read: granted (the read happens next) or refused (allowance used up or Spotify asked to wait). */
  reserved(identity: string, granted: boolean): void {
    const run = this.running;
    if (!run) return;
    const at = Date.now();
    if (granted) { run.reads += 1; run.lastReadAt = at; }
    this.tally(at, granted ? "reads" : "refused", 1);
    this.push({ at, job: run.job, type: granted ? "read" : "refused", ...catalogFillItem(identity) });
  }

  sent(count: number): void {
    const run = this.running;
    if (!run || count <= 0) return;
    run.sent += count;
    this.tally(Date.now(), "sent", count);
    this.push({ at: Date.now(), job: run.job, type: "sent", count });
  }

  finished(report: CatalogFillRunReport): void {
    this.running = null;
    this.runs = [{ ...report, recordedLocallyAt: Date.now() }, ...this.runs].slice(0, MAX_RUNS);
  }

  setFiller(filler: boolean | null): void { this.filler = filler; }

  setNextWake(at: number | null): void { this.nextWakeAt = at; }

  snapshot(): CatalogFillLiveSnapshot {
    return {
      version: 1, now: Date.now(), since: this.since, filler: this.filler,
      running: this.running && { ...this.running }, nextWakeAt: this.nextWakeAt,
      events: [...this.events], minutes: this.minutes.map((minute) => ({ ...minute })), runs: [...this.runs],
    };
  }

  private tally(at: number, field: "reads" | "refused" | "sent", count: number): void {
    const minute = at - (at % MINUTE_MS);
    let last = this.minutes[this.minutes.length - 1];
    if (last?.minute !== minute) {
      last = { minute, reads: 0, refused: 0, sent: 0 };
      this.minutes.push(last);
      this.minutes = this.minutes.filter((entry) => entry.minute > minute - MAX_MINUTES * MINUTE_MS);
    }
    last[field] += count;
  }

  private push(event: CatalogFillLiveEvent): void {
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }
}

// Tagify ships several bundles (the app, its extension and others) that each include this module;
// they share the first one's view through the global, so whichever bundle runs the readers is seen.
type SharedLive = { live: CatalogFillLive; snapshot(): CatalogFillLiveSnapshot };
const shared = (() => { try { return globalThis as { TagifyCatalogFillLive?: SharedLive }; } catch { return {} as { TagifyCatalogFillLive?: SharedLive }; } })();
export const catalogFillLive: CatalogFillLive = shared.TagifyCatalogFillLive?.live ?? new CatalogFillLive();

/** A reservation that also tells the live view about each read it allows or refuses. */
export function watchedReserve(reserve: (identity: string) => boolean): (identity: string) => boolean {
  return (identity) => {
    const granted = reserve(identity);
    catalogFillLive.reserved(identity, granted);
    return granted;
  };
}

/** A fetch that tells the live view how many items each accepted POST to Community carried. */
export function watchedRequest(request: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await request(input, init);
    if (response.ok && init?.method === "POST" && typeof init.body === "string") {
      try {
        const items = (JSON.parse(init.body) as { items?: unknown }).items;
        if (Array.isArray(items)) catalogFillLive.sent(items.length);
      } catch { /* Not a report: nothing to count. */ }
    }
    return response;
  };
}

try {
  shared.TagifyCatalogFillLive ??= { live: catalogFillLive, snapshot: () => catalogFillLive.snapshot() };
} catch { /* A locked-down global only means the widget can't see it. */ }
