import {
  CATALOG_FILL_RUN_STOPS, CATALOG_FILL_RUNS_PROTOCOL_VERSION, isCatalogFillRunResult, MAX_CATALOG_FILL_RUN_COUNT,
  type CatalogFillRunJob, type CatalogFillRunStop, type CatalogFillRunTrigger, type CatalogFillRunV1,
} from "@tagify/sync-contracts";
import type { CatalogFillCause } from "./CatalogFillFailures";
import type { SendSession } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// Catalog filler run log (Community docs/OPERATIONS.md, "Catalog filler run log"). After each run of
// a background Spotify reader (artist names, song releases, catalog fill jobs) Tagify sends Community
// one summary: which job, what started it, when, how many Spotify reads, how many items sent and why
// it stopped. Counts and reasons only, never music. Sent only when Community advertises
// `catalogFillRuns` protocol 1; Community keeps it only for a desktop it lists as a catalog filler and
// answers `filler: false` (or 404 without the route) to the rest, which stop sending until Tagify
// restarts. The log never reads Spotify and never throws, so it can't hold up or break a reader.
// A run also says why it stopped (`cause`) and how many items Spotify failed to read that it went
// past (`skipped`, `lastSkip`): classifications, statuses and route labels, never music. A Community
// that doesn't store them yet drops them.

/** How a reader's run ended: its own result, or "error" when it threw. */
export type CatalogFillRunOutcome =
  | { sent: number; reads: number; stopped?: string; cause?: CatalogFillCause; skipped?: number; lastSkip?: CatalogFillCause }
  | "error";

/** A run summary with why it stopped and what it skipped, when it says. */
export type CatalogFillRunReport = CatalogFillRunV1 & { cause?: CatalogFillCause; skipped?: number; lastSkip?: CatalogFillCause };

export interface CatalogFillRunStart { job: CatalogFillRunJob; trigger: CatalogFillRunTrigger; startedAt: string }

const count = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_CATALOG_FILL_RUN_COUNT, Math.max(0, Math.floor(value))) : 0;
const stopReason = (stopped: string | undefined): CatalogFillRunStop =>
  stopped === undefined ? "done" : (CATALOG_FILL_RUN_STOPS as readonly string[]).includes(stopped) ? stopped as CatalogFillRunStop : "error";

/** Where Community takes run summaries, or null when it doesn't advertise protocol 1. */
export function catalogFillRunsPath(capabilities: unknown): string | null {
  const capability = (capabilities as { catalogFillRuns?: { path?: unknown; protocolVersion?: unknown } } | null)?.catalogFillRuns;
  if (capability?.protocolVersion !== CATALOG_FILL_RUNS_PROTOCOL_VERSION) return null;
  return typeof capability.path === "string" && capability.path.startsWith("/") && !capability.path.startsWith("//") ? capability.path : null;
}

/** The summary of one finished run as Community takes it. */
export function catalogFillRun(start: CatalogFillRunStart, outcome: CatalogFillRunOutcome, finishedAt: Date): CatalogFillRunReport {
  const finished = new Date(Math.max(finishedAt.getTime(), Date.parse(start.startedAt))).toISOString();
  if (outcome === "error") return { ...start, finishedAt: finished, reads: 0, sent: 0, stopped: "error", cause: { kind: "error" } };
  const stopped = stopReason(outcome.stopped);
  return {
    ...start, finishedAt: finished, reads: count(outcome.reads), sent: count(outcome.sent), stopped,
    ...(outcome.cause && stopped !== "done" && stopped !== "budget" ? { cause: outcome.cause } : {}),
    ...(outcome.skipped ? { skipped: count(outcome.skipped) } : {}),
    ...(outcome.lastSkip ? { lastSkip: outcome.lastSkip } : {}),
  };
}

/** One per Tagify start: knows which jobs already ran and whether Community wants summaries. */
export class CatalogFillRunLog {
  private readonly ran = new Set<CatalogFillRunJob>();
  private stopped = false;
  private warned = false;

  constructor(private readonly options: { request?: typeof fetch; now?: () => Date } = {}) {}

  /** Notes a run starting now: "start" for the job's first run since Tagify started, "schedule" after. */
  begin(job: CatalogFillRunJob): CatalogFillRunStart {
    const trigger = this.ran.has(job) ? "schedule" : "start";
    this.ran.add(job);
    return { job, trigger, startedAt: this.now().toISOString() };
  }

  /** Sends the finished run's summary when Community takes them. Never throws. */
  async finish(session: SendSession, capabilities: unknown, start: CatalogFillRunStart, outcome: CatalogFillRunOutcome): Promise<void> {
    const path = this.stopped ? null : catalogFillRunsPath(capabilities);
    if (!path) return;
    const run = catalogFillRun(start, outcome, this.now());
    try {
      const current = await session();
      const response = await (this.options.request ?? fetch)(`${current.apiBaseUrl}${path}`, {
        method: "POST",
        headers: { ...syncClientHeaders(current.accessToken), "content-type": "application/json" },
        body: JSON.stringify({ protocolVersion: CATALOG_FILL_RUNS_PROTOCOL_VERSION, deviceId: current.deviceId, run }),
      });
      // Community without the route, or this desktop isn't a filler: stop until Tagify restarts.
      if (response.status === 404) { this.stopped = true; return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result: unknown = await response.json().catch(() => null);
      if (isCatalogFillRunResult(result) && !result.filler) this.stopped = true;
    } catch (error) {
      if (this.warned) return;
      this.warned = true;
      console.warn("Tagify sync: the background run summary was not sent", error instanceof Error ? error.message : error);
    }
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }
}
