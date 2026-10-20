import { useEffect } from "react";
import packageJson from "@/package";
import { getDesktopSyncConnectionState } from "@/services/sync/SyncLocalState";
import { ANALYTICS_CHOICE_EVENT, isAnalyticsSharing, presenceRecordedToday, recordProductEvent, savedSongsBucket, trackAggregateRequest, releaseAggregateRequest, type ProductEventDetails } from "@/features/product-analytics/productAnalytics";

const USAGE_URL = "https://community.tagify.fm/api/v1/tagify-usage";
/** How often a visible Tagify checks, locally, whether today's report is due. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
/** New activity counts wait safely on this device and go out together at most this often. */
export const ACTIVITY_REPORT_INTERVAL_MS = 15 * 60 * 1000;
const LAST_REPORT_PREFIX = "tagify:usage:last-report:";
const LAST_VERSION_PREFIX = "tagify:usage:last-version:";
const ACTIVITY_PREFIX = "tagify:usage:activity:";
const ACTIVITY_EVENT = "tagify:usage:action";
const ANSWER_PREFIX = "tagify:usage:pending-answer:";
/** Shared by usage reports and prompt history, which use the same rate-limited endpoint. */
export const USAGE_PAUSED_UNTIL_KEY = "tagify:usage:paused-until";
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000;
const MAX_RATE_LIMIT_PAUSE_MS = 24 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<boolean>>();
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();


/** Reports once per Toronto calendar day, and once after each Tagify update so the recorded version stays current. */
export function isUsageReportDue(lastReportedAt: number, lastVersion: string | null, appVersion: string, now = Date.now()): boolean {
  if (!Number.isFinite(lastReportedAt) || lastReportedAt <= 0 || lastReportedAt > now) return true;
  if (lastVersion !== appVersion) return true;
  return activityDay(lastReportedAt) !== activityDay(now);
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

interface DailyActivity { deviceId: string; day: string; tagging: number; rating: number }

/** Calendar boundaries match the owner's Supabase reports. No song details are collected. */
export function activityDay(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)?.value).join("-");
}

function readActivity(accountDigest: string): DailyActivity[] {
  try {
    const days = JSON.parse(localStorage.getItem(`${ACTIVITY_PREFIX}${accountDigest}`) || "[]") as DailyActivity[];
    const cutoff = new Date(Date.parse(`${activityDay()}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
    if (!Array.isArray(days)) return [];
    for (const day of days) if (day.day < cutoff) localStorage.removeItem(`${ACTIVITY_PREFIX}ack:${accountDigest}:${day.deviceId}`);
    const recent = days.filter(day => day.day >= cutoff && day.day <= activityDay());
    if (recent.length !== days.length) localStorage.setItem(`${ACTIVITY_PREFIX}${accountDigest}`, JSON.stringify(recent));
    return recent;
  } catch { return []; }
}

function unsentActivity(accountDigest: string): DailyActivity | undefined {
  try { return readActivity(accountDigest).find(day => localStorage.getItem(`${ACTIVITY_PREFIX}ack:${accountDigest}:${day.deviceId}`) !== JSON.stringify(day)); }
  catch { return undefined; }
}

/** Inline editors run without the main app's React hook. Stop polling once the queue is acknowledged. */
function scheduleActivityFlush(accountDigest: string, failures = 0, delay = ACTIVITY_REPORT_INTERVAL_MS): void {
  if (activityTimers.has(accountDigest)) return;
  const timer = setTimeout(async () => {
    activityTimers.delete(accountDigest);
    if (!unsentActivity(accountDigest)) return;
    if (await getUsageAccountDigest() !== accountDigest) return;
    const canSend = document.visibilityState !== "hidden" && navigator.onLine;
    const recorded = canSend && await sendUsage(accountDigest, packageJson.version, undefined, { batchActivity: true });
    if (!unsentActivity(accountDigest)) return;
    const nextDelay = recorded ? ACTIVITY_REPORT_INTERVAL_MS : (RETRY_DELAYS_MS[failures] ?? CHECK_INTERVAL_MS);
    scheduleActivityFlush(accountDigest, recorded ? 0 : failures + 1,
      Math.max(nextDelay, usageRequestsPausedUntil() - Date.now()));
  }, delay);
  activityTimers.set(accountDigest, timer);
}

/**
 * Count one completed manual edit gesture, including a bulk edit, rather than each affected song.
 * `surface` says where it was made: the Tagify page, the controls in Spotify's own views, or a keyboard shortcut.
 */
export async function recordMeaningfulAction(action: "tagging" | "rating", surface: NonNullable<ProductEventDetails["edit_surface"]> = "tagify_page"): Promise<void> {
  const accountDigest = await getUsageAccountDigest();
  if (!accountDigest || !isAnalyticsSharing(accountDigest)) return;
  recordProductEvent(accountDigest, action === "tagging" ? "tagging_completed" : "rating_completed", { edit_surface: surface });
  try {
    const days = readActivity(accountDigest);
    let current = days.find(day => day.day === activityDay());
    if (!current) {
      current = { deviceId: crypto.randomUUID(), day: activityDay(), tagging: 0, rating: 0 };
      days.push(current);
    }
    current[action] = Math.min(100000, current[action] + 1);
    localStorage.setItem(`${ACTIVITY_PREFIX}${accountDigest}`, JSON.stringify(days));
    window.dispatchEvent(new Event(ACTIVITY_EVENT));
    scheduleActivityFlush(accountDigest);
  } catch { /* Analytics must never interrupt editing. */ }
}

/**
 * `batchActivity`: when new activity is the only reason to report, wait until
 * the last report is ACTIVITY_REPORT_INTERVAL_MS old. Resolves true while it
 * waits, since nothing failed.
 */
function sendUsage(accountDigest: string, appVersion: string, answer?: DiscoveryAnswer, { batchActivity = false } = {}): Promise<boolean> {
  const existing = inFlight.get(accountDigest);
  if (existing) return existing;
  const pending = answer ?? pendingAnswer(accountDigest);
  const sharing = isAnalyticsSharing(accountDigest);
  const activity = sharing ? unsentActivity(accountDigest) : undefined;
  if (!sharing && !pending) return Promise.resolve(true);
  try {
    const lastReported = Number(localStorage.getItem(`${LAST_REPORT_PREFIX}${accountDigest}`));
    const lastVersion = localStorage.getItem(`${LAST_VERSION_PREFIX}${accountDigest}`);
    const due = isUsageReportDue(lastReported, lastVersion, appVersion);
    if (!pending && !activity && !due) return Promise.resolve(true);
    if (batchActivity && !pending && !due && Date.now() - lastReported < ACTIVITY_REPORT_INTERVAL_MS) return Promise.resolve(true);
  } catch { /* Reporting remains safe when localStorage is temporarily unavailable. */ }
  // A queued answer stays saved and goes out with the first report after the pause.
  if (usageRequestsPausedUntil()) return Promise.resolve(false);

  const controller = new AbortController();
  if (sharing) trackAggregateRequest(accountDigest, controller);
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const request = (async () => {
    try {
      const response = await fetch(USAGE_URL, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Tagify-Client-Version": appVersion },
        body: JSON.stringify({ accountDigest, appVersion, ...(sharing ? { activityCapable: true } : {}), ...(pending ? { survey: pending } : {}), ...(activity ? { activity } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        pauseUsageRequestsAfter(response);
        return false;
      }
      if (controller.signal.aborted || (sharing && !isAnalyticsSharing(accountDigest))) return false;
      if (activity && !(await response.json()).activityRecorded) return false;
      try {
        localStorage.setItem(`${LAST_REPORT_PREFIX}${accountDigest}`, String(Date.now()));
        localStorage.setItem(`${LAST_VERSION_PREFIX}${accountDigest}`, appVersion);
        if (activity) localStorage.setItem(`${ACTIVITY_PREFIX}ack:${accountDigest}:${activity.deviceId}`, JSON.stringify(activity));
        // A newer answer must remain queued if it arrived during this request.
        if (pending && JSON.stringify(pendingAnswer(accountDigest)) === JSON.stringify(pending)) {
          localStorage.removeItem(`${ANSWER_PREFIX}${accountDigest}`);
        }
      } catch { /* A missing marker only causes an idempotent retry. */ }
      return true;
    } catch { return false; }
  })().finally(() => { clearTimeout(timeout); releaseAggregateRequest(accountDigest, controller); inFlight.delete(accountDigest); });
  inFlight.set(accountDigest, request);
  return request;
}

/**
 * Coarse library size, or nothing when the library can't be read; a failure is never reported as an empty library.
 * Storage loads on first use so analytics, which many features import, doesn't pull the library into their module graph.
 */
async function savedSongsDetail(): Promise<Pick<ProductEventDetails, "saved_songs">> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { indexedDBStorage } = await import("@/services/storage/IndexedDBStorageService");
    const count = await Promise.race([
      indexedDBStorage.getTrackCount(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 3_000); }),
    ]);
    const bucket = count === null ? undefined : savedSongsBucket(count);
    return bucket ? { saved_songs: bucket } : {};
  } catch { return {}; }
  finally { if (timer) clearTimeout(timer); }
}

export async function recordTagifyOpen(appVersion: string, options: { batchActivity?: boolean } = {}): Promise<boolean> {
  const accountDigest = await getUsageAccountDigest();
  if (accountDigest) recordProductEvent(accountDigest, "tagify_opened", { sync_state: getDesktopSyncConnectionState(), ...await savedSongsDetail() });
  return accountDigest ? sendUsage(accountDigest, appVersion, undefined, options) : false;
}

/**
 * Daily sign that Spotify ran with Tagify installed, whether or not the Tagify page was opened.
 * Lets inactivity be told apart from Tagify having been removed, for example by a Spotify update.
 */
export async function recordTagifyPresent(): Promise<void> {
  const accountDigest = await getUsageAccountDigest();
  if (!accountDigest || !isAnalyticsSharing(accountDigest) || presenceRecordedToday(accountDigest)) return;
  recordProductEvent(accountDigest, "tagify_present", await savedSongsDetail());
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
    let actionTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let nextAttemptAt = 0;
    const report = async () => {
      if (stopped || document.visibilityState === "hidden" || !navigator.onLine || Date.now() < nextAttemptAt) return;
      // Opening, showing Spotify and the timers below all report; new activity
      // counts alone go out at most every ACTIVITY_REPORT_INTERVAL_MS.
      const recorded = await recordTagifyOpen(appVersion, { batchActivity: true });
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
    const onAction = () => {
      if (!actionTimer) actionTimer = setTimeout(() => { actionTimer = undefined; void report(); }, ACTIVITY_REPORT_INTERVAL_MS);
    };
    const activityInterval = setInterval(() => {
      void getUsageAccountDigest().then(digest => {
        if (digest && readActivity(digest).length) void report();
      });
    }, 5 * 60_000);
    window.addEventListener(ACTIVITY_EVENT, onAction);
    window.addEventListener(ANALYTICS_CHOICE_EVENT, resumeOnline);
    const resumeVisible = () => { void report(); };
    void report();
    const interval = setInterval(() => void report(), CHECK_INTERVAL_MS);
    window.addEventListener("online", resumeOnline);
    document.addEventListener("visibilitychange", resumeVisible);
    return () => {
      stopped = true;
      clearInterval(interval);
      clearInterval(activityInterval);
      if (actionTimer) clearTimeout(actionTimer);
      window.removeEventListener(ACTIVITY_EVENT, onAction);
      window.removeEventListener(ANALYTICS_CHOICE_EVENT, resumeOnline);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", resumeOnline);
      document.removeEventListener("visibilitychange", resumeVisible);
    };
  }, [appVersion]);
}
