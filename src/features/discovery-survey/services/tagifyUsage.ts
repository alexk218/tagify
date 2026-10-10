import { useEffect } from "react";

const USAGE_URL = "https://community.tagify.fm/api/v1/tagify-usage";
/** How often a visible Tagify checks, locally, whether today's report is due. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
const LAST_REPORT_PREFIX = "tagify:usage:last-report:";
const LAST_VERSION_PREFIX = "tagify:usage:last-version:";
const ANSWER_PREFIX = "tagify:usage:pending-answer:";
/** Shared by usage reports and prompt history, which use the same rate-limited endpoint. */
export const USAGE_PAUSED_UNTIL_KEY = "tagify:usage:paused-until";
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000;
const MAX_RATE_LIMIT_PAUSE_MS = 24 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<boolean>>();

function utcDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Reports once per UTC day, and once after each Tagify update so the recorded version stays current. */
export function isUsageReportDue(lastReportedAt: number, lastVersion: string | null, appVersion: string, now = Date.now()): boolean {
  if (!Number.isFinite(lastReportedAt) || lastReportedAt <= 0 || lastReportedAt > now) return true;
  if (lastVersion !== appVersion) return true;
  return utcDay(lastReportedAt) !== utcDay(now);
}

/** Milliseconds requested by a Retry-After header (seconds or HTTP date), bounded to one day. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(delay) || delay <= 0) return null;
  return Math.min(delay, MAX_RATE_LIMIT_PAUSE_MS);
}

/** Time before which usage and prompt-history requests must not be sent. */
export function usageRequestsPausedUntil(now = Date.now()): number {
  try {
    const until = Number(localStorage.getItem(USAGE_PAUSED_UNTIL_KEY));
    // A clock moved backwards must not pause reporting for longer than the server asked.
    return Number.isFinite(until) && until > now && until - now <= MAX_RATE_LIMIT_PAUSE_MS ? until : 0;
  } catch { return 0; }
}

/** Honors a rate-limit response for every Tagify usage request, across reloads. */
export function pauseUsageRequestsAfter(response: Pick<Response, "status" | "headers">, now = Date.now()): boolean {
  if (response.status !== 429) return false;
  const until = now + (retryAfterMs(response.headers?.get?.("retry-after"), now) ?? DEFAULT_RATE_LIMIT_PAUSE_MS);
  try { localStorage.setItem(USAGE_PAUSED_UNTIL_KEY, String(until)); }
  catch { /* The in-session retry delay still applies. */ }
  return true;
}

export interface DiscoveryAnswer { source: string; otherDetails?: string }

/** Spotify's account username is stable; display names and installation IDs are not. */
export async function getUsageAccountDigest(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const user = await Promise.race([
      Spicetify.Platform.UserAPI.getUser() as Promise<{ username?: unknown }>,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 3_000); }),
    ]);
    if (typeof user?.username !== "string" || !user.username.trim()) return null;
    const bytes = new TextEncoder().encode(`tagify-usage-account-v1:${user.username}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}

function pendingAnswer(accountDigest: string): DiscoveryAnswer | null {
  try {
    const answer = JSON.parse(localStorage.getItem(`${ANSWER_PREFIX}${accountDigest}`) || "null");
    return answer && typeof answer.source === "string" ? answer : null;
  } catch { return null; }
}

function sendUsage(accountDigest: string, appVersion: string, answer?: DiscoveryAnswer): Promise<boolean> {
  const existing = inFlight.get(accountDigest);
  if (existing) return existing;
  const pending = answer ?? pendingAnswer(accountDigest);
  try {
    const lastReported = Number(localStorage.getItem(`${LAST_REPORT_PREFIX}${accountDigest}`));
    const lastVersion = localStorage.getItem(`${LAST_VERSION_PREFIX}${accountDigest}`);
    if (!pending && !isUsageReportDue(lastReported, lastVersion, appVersion)) return Promise.resolve(true);
  } catch { /* Reporting remains safe when localStorage is temporarily unavailable. */ }
  // A queued answer stays saved and goes out with the first report after the pause.
  if (usageRequestsPausedUntil()) return Promise.resolve(false);

  const request = (async () => {
    try {
      const response = await fetch(USAGE_URL, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Tagify-Client-Version": appVersion },
        body: JSON.stringify({ accountDigest, appVersion, ...(pending ? { survey: pending } : {}) }),
        signal: AbortSignal.timeout(10_000), keepalive: true,
      });
      if (!response.ok) {
        pauseUsageRequestsAfter(response);
        return false;
      }
      try {
        localStorage.setItem(`${LAST_REPORT_PREFIX}${accountDigest}`, String(Date.now()));
        localStorage.setItem(`${LAST_VERSION_PREFIX}${accountDigest}`, appVersion);
        // A newer answer must remain queued if it arrived during this request.
        if (pending && JSON.stringify(pendingAnswer(accountDigest)) === JSON.stringify(pending)) {
          localStorage.removeItem(`${ANSWER_PREFIX}${accountDigest}`);
        }
      } catch { /* A missing marker only causes an idempotent retry. */ }
      return true;
    } catch { return false; }
  })().finally(() => { inFlight.delete(accountDigest); });
  inFlight.set(accountDigest, request);
  return request;
}

export async function recordTagifyOpen(appVersion: string): Promise<boolean> {
  const accountDigest = await getUsageAccountDigest();
  return accountDigest ? sendUsage(accountDigest, appVersion) : false;
}

export async function recordDiscoveryAnswer(appVersion: string, answer: DiscoveryAnswer, knownAccountDigest?: string | null): Promise<boolean> {
  const accountDigest = knownAccountDigest ?? await getUsageAccountDigest();
  if (!accountDigest) return false;
  try { localStorage.setItem(`${ANSWER_PREFIX}${accountDigest}`, JSON.stringify(answer)); }
  catch { /* Still try sending the answer in this session. */ }
  await inFlight.get(accountDigest);
  return sendUsage(accountDigest, appVersion, answer);
}

export function useTagifyUsage(appVersion: string): void {
  useEffect(() => {
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let nextAttemptAt = 0;
    const report = async () => {
      if (stopped || document.visibilityState === "hidden" || !navigator.onLine || Date.now() < nextAttemptAt) return;
      const recorded = await recordTagifyOpen(appVersion);
      if (stopped) return;
      if (recorded) {
        failures = 0;
        nextAttemptAt = 0;
        return;
      }
      // Failed reports back off; showing Spotify again never restarts the retries.
      const delay = RETRY_DELAYS_MS[failures] ?? CHECK_INTERVAL_MS;
      failures++;
      nextAttemptAt = Math.max(Date.now() + delay, usageRequestsPausedUntil());
      if (!retryTimer && failures <= RETRY_DELAYS_MS.length) {
        retryTimer = setTimeout(() => { retryTimer = undefined; void report(); }, nextAttemptAt - Date.now());
      }
    };
    const resumeOnline = () => { failures = 0; nextAttemptAt = usageRequestsPausedUntil(); void report(); };
    const resumeVisible = () => { void report(); };
    void report();
    const interval = setInterval(() => void report(), CHECK_INTERVAL_MS);
    window.addEventListener("online", resumeOnline);
    document.addEventListener("visibilitychange", resumeVisible);
    return () => {
      stopped = true;
      clearInterval(interval);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", resumeOnline);
      document.removeEventListener("visibilitychange", resumeVisible);
    };
  }, [appVersion]);
}
