/**
 * Retry-After and back-off for Community requests that must wait after a
 * failure, so a busy Community is never asked again sooner than it said.
 */

/** Seconds a Retry-After header asks for (delta seconds or an HTTP date); null when it names none. */
export function retryAfterSeconds(value: string | null | undefined, now = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return seconds > 0 ? seconds : null;
  }
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return null;
  const seconds = Math.ceil((at - now) / 1_000);
  return seconds > 0 ? seconds : null;
}

/** 429 and 5xx: Community or its database is busy, and the same request elsewhere would be too. */
export function isBusyStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface BackoffPolicy {
  /** Wait after the first failure that names no time; doubles with each further failure. */
  baseMs: number;
  /** Longest wait that doubling reaches. */
  maxMs: number;
  /** Longest Retry-After honored, against a bad header or clock. */
  maxRetryAfterMs: number;
}

/**
 * How long to wait after `failures` consecutive failures (1 for the first).
 * A Retry-After is honored in full (up to `maxRetryAfterMs`); repeated
 * failures wait at least as long as doubling from `baseMs` gives.
 */
export function backoffDelayMs(failures: number, retryAfter: number | null, policy: BackoffPolicy, random = Math.random): number {
  const doubled = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.min(Math.max(failures - 1, 0), 20));
  const jittered = Math.round(doubled * (1 + random() * 0.2));
  const requested = retryAfter && retryAfter > 0 ? Math.min(retryAfter * 1_000, policy.maxRetryAfterMs) : 0;
  return Math.max(requested, Math.min(jittered, policy.maxMs));
}
