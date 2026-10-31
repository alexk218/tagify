import { classifySpotifyFailure, spotifyStatus } from "@/utils/spotifyRequestFailure";
import { isSpotifyBusy } from "./SpotifyLibrarySender";

// How the background Spotify readers (artist names, song releases, catalog fill jobs) treat a read
// that failed. Spotify asking Tagify to wait (a 429, or the shared pause it set) stops the run at
// once, and nothing is retried around it. Any other failure (a 5xx for one album, an answer Tagify
// can't use, a read that never finished) belongs to that one item: the run skips it and goes on,
// until several in a row fail, which means Spotify isn't answering at all. On 2026-10-29 a fast
// filler run stopped after 171 good reads because one artist's discography answered HTTP 500.
// Every stop and skip says why, in the console and in the run summary sent to Community.

/** Failed reads in a row (none of them Spotify asking to wait) that stop a run. */
export const CATALOG_FILL_MAX_FAILURES_IN_A_ROW = 5;

export type CatalogFillCauseKind =
  | "rate-limit" | "quota-exceeded" | "server-429" | "local-pause" | "http-error" | "no-answer" | "bad-answer"
  | "community-http" | "network" | "error";

/** Why a read failed or a run stopped: a classification, an HTTP status and a route label, never music or IDs. */
export interface CatalogFillCause {
  kind: CatalogFillCauseKind;
  status?: number;
  endpoint?: string;
  retryAfterSeconds?: number;
}

const ENDPOINT = /^(GraphQL [A-Za-z_][A-Za-z0-9_]{0,99}|Community [a-z-]{1,40})$/;

/** The cause of one failed Spotify read. `endpoint` names the read when the error doesn't. */
export function catalogFillCause(error: unknown, endpoint?: string): CatalogFillCause {
  const failure = classifySpotifyFailure(error);
  const label = [failure?.endpoint, endpoint].find((value): value is string => typeof value === "string" && ENDPOINT.test(value));
  const status = spotifyStatus(error);
  const retryAfterSeconds = failure?.retryAfterSeconds;
  const kind: CatalogFillCauseKind = failure && failure.kind !== "unsupported-endpoint" ? failure.kind
    : Number.isInteger(status) && status >= 100 && status <= 599 ? "http-error"
      : /took too long/i.test(String((error as { message?: unknown } | null)?.message ?? "")) ? "no-answer"
        : error instanceof TypeError && /fetch|network/i.test(error.message) ? "network"
          : "error";
  return {
    kind,
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
    ...(label ? { endpoint: label } : {}),
    ...(retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds: Math.min(86_400, Math.max(0, Math.round(retryAfterSeconds))) } : {}),
  };
}

export const describeCatalogFillCause = (cause: CatalogFillCause): string =>
  [cause.kind, cause.status, cause.endpoint, cause.retryAfterSeconds !== undefined ? `retry after ${cause.retryAfterSeconds} s` : undefined]
    .filter((part) => part !== undefined).join(" ");

/** One run's failed reads: what it skipped, and why it stopped when it did. */
export class CatalogFillFailures {
  skipped = 0;
  lastSkip?: CatalogFillCause;
  cause?: CatalogFillCause;
  private inARow = 0;

  /** A read answered. */
  succeeded(): void { this.inARow = 0; }

  /** A read failed: true when the run must stop (Spotify asked to wait, or too many failed in a row). */
  failed(error: unknown, endpoint?: string): boolean {
    const cause = catalogFillCause(error, endpoint);
    this.inARow += 1;
    if (isSpotifyBusy(error) || this.inARow >= CATALOG_FILL_MAX_FAILURES_IN_A_ROW) {
      this.cause = cause;
      console.warn(`Tagify sync: background Spotify reads stopped (${describeCatalogFillCause(cause)})`);
      return true;
    }
    this.skipped += 1;
    this.lastSkip = cause;
    console.warn(`Tagify sync: skipped one item Spotify couldn't read (${describeCatalogFillCause(cause)})`);
    return false;
  }

  /** What the run summary carries about failures. */
  summary(): { cause?: CatalogFillCause; skipped?: number; lastSkip?: CatalogFillCause } {
    return { ...(this.cause ? { cause: this.cause } : {}), ...(this.skipped ? { skipped: this.skipped } : {}), ...(this.lastSkip ? { lastSkip: this.lastSkip } : {}) };
  }
}
