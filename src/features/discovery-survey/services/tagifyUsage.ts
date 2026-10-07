import { useEffect } from "react";

const USAGE_URL = "https://community.tagify.fm/api/v1/tagify-usage";
const REPORT_INTERVAL_MS = 60 * 60 * 1000;
const LAST_REPORT_PREFIX = "tagify:usage:last-report:";
const ANSWER_PREFIX = "tagify:usage:pending-answer:";
const inFlight = new Map<string, Promise<boolean>>();

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
    if (!pending && lastReported > 0 && lastReported <= Date.now() && Date.now() - lastReported < REPORT_INTERVAL_MS) {
      return Promise.resolve(true);
    }
  } catch { /* Reporting remains safe when localStorage is temporarily unavailable. */ }

  const request = (async () => {
    try {
      const response = await fetch(USAGE_URL, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Tagify-Client-Version": appVersion },
        body: JSON.stringify({ accountDigest, appVersion, ...(pending ? { survey: pending } : {}) }),
        signal: AbortSignal.timeout(10_000), keepalive: true,
      });
      if (!response.ok) return false;
      try {
        localStorage.setItem(`${LAST_REPORT_PREFIX}${accountDigest}`, String(Date.now()));
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
    let retries = 0;
    const report = async () => {
      if (stopped || document.visibilityState === "hidden" || !navigator.onLine) return;
      const recorded = await recordTagifyOpen(appVersion);
      if (stopped) return;
      if (recorded) retries = 0;
      else if (retries < 3 && !retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = undefined; void report(); }, [5_000, 30_000, 120_000][retries++]);
      }
    };
    const resume = () => { retries = 0; void report(); };
    void report();
    const interval = setInterval(() => void report(), REPORT_INTERVAL_MS);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      clearInterval(interval);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [appVersion]);
}
