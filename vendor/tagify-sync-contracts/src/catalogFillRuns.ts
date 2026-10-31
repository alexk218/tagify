// Catalog filler run log (Community docs/OPERATIONS.md, "Catalog filler run log"). After each run of a
// background Spotify reader (artist names, song releases, catalog fill jobs), a desktop Community lists
// as a catalog filler (Alex's) sends one summary: what ran, what started it, when, how many Spotify
// reads it made, how many items it sent and why it stopped. Counts and reasons only, never music.
// Community records it only for a listed desktop and answers `filler: false` to any other, which then
// stops sending until Tagify restarts.

export const CATALOG_FILL_RUNS_PROTOCOL_VERSION = 1 as const;
/** The largest reads or sent count a run reports. */
export const MAX_CATALOG_FILL_RUN_COUNT = 100_000;

export const CATALOG_FILL_RUN_JOBS = ["artistCredits", "songReleases", "catalogFill"] as const;
export type CatalogFillRunJob = typeof CATALOG_FILL_RUN_JOBS[number];
/** "start": the first run of this job since Tagify started; "schedule": a later run once its interval passed. */
export const CATALOG_FILL_RUN_TRIGGERS = ["start", "schedule"] as const;
export type CatalogFillRunTrigger = typeof CATALOG_FILL_RUN_TRIGGERS[number];
/** "done": the work list ended; "error": the run failed unexpectedly. The rest are the runners' own stop reasons. */
export const CATALOG_FILL_RUN_STOPS = ["done", "unsupported", "paused", "signed_out", "network", "spotify", "budget", "error"] as const;
export type CatalogFillRunStop = typeof CATALOG_FILL_RUN_STOPS[number];

export interface CatalogFillRunV1 {
  job: CatalogFillRunJob;
  trigger: CatalogFillRunTrigger;
  /** ISO 8601 times on the desktop's clock. */
  startedAt: string;
  finishedAt: string;
  reads: number;
  sent: number;
  stopped: CatalogFillRunStop;
}
export interface CatalogFillRunReportV1 { protocolVersion: typeof CATALOG_FILL_RUNS_PROTOCOL_VERSION; deviceId: string; run: CatalogFillRunV1 }
export interface CatalogFillRunResultV1 { recorded: boolean; filler: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CATALOG_FILL_RUN_COUNT;
const isTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

/** The run summary a desktop sent, or throws when it isn't one. */
export function parseCatalogFillRunReport(value: unknown): CatalogFillRunReportV1 {
  if (!isRecord(value) || value.protocolVersion !== CATALOG_FILL_RUNS_PROTOCOL_VERSION || typeof value.deviceId !== "string" || !UUID.test(value.deviceId)
    || !isRecord(value.run)) throw new Error("Invalid catalog fill run");
  const { job, trigger, startedAt, finishedAt, reads, sent, stopped } = value.run;
  if (!oneOf(CATALOG_FILL_RUN_JOBS, job) || !oneOf(CATALOG_FILL_RUN_TRIGGERS, trigger) || !oneOf(CATALOG_FILL_RUN_STOPS, stopped)
    || !isTime(startedAt) || !isTime(finishedAt) || Date.parse(finishedAt) < Date.parse(startedAt) || !isCount(reads) || !isCount(sent)) {
    throw new Error("Invalid catalog fill run");
  }
  return { protocolVersion: CATALOG_FILL_RUNS_PROTOCOL_VERSION, deviceId: value.deviceId, run: { job, trigger, startedAt, finishedAt, reads, sent, stopped } };
}

/** Whether Community's answer to a run summary is one. */
export function isCatalogFillRunResult(value: unknown): value is CatalogFillRunResultV1 {
  return isRecord(value) && typeof value.recorded === "boolean" && typeof value.filler === "boolean";
}
