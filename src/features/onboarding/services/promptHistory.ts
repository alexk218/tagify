import { getUsageAccountDigest, pauseUsageRequestsAfter, usageRequestsPausedUntil } from "@/features/discovery-survey/services/tagifyUsage";

export const MOBILE_TAGGING_INTRO_KEY = "tagify:smart-playlists:mobile-tagging-intro:v1";
export const LEGACY_SURVEY_KEY = "tagify:discoverySurvey";
export const LEGACY_PROMPT_OWNER_KEY = "tagify:prompt-history:legacy-owner:v1";
const HISTORY_PREFIX = "tagify:prompt-history:v1:";
/** Set once Community has confirmed both dismissals; nothing further can change. */
const COMPLETE_PREFIX = "tagify:prompt-history:v1:complete:";
const USAGE_URL = "https://community.tagify.fm/api/v1/tagify-usage";
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;
const EXHAUSTED_RETRY_DELAY_MS = 60 * 60_000;

export interface PromptHistory {
  mobileTaggingIntroSeen: boolean;
  discoverySurveyDismissed: boolean;
}
export interface PromptHistorySnapshot extends PromptHistory {
  accountDigest: string | null;
  ready: boolean;
}
const emptyHistory: PromptHistory = { mobileTaggingIntroSeen: false, discoverySurveyDismissed: false };

function mergeHistory(a: PromptHistory, b: Partial<PromptHistory>): PromptHistory {
  return {
    mobileTaggingIntroSeen: a.mobileTaggingIntroSeen || b.mobileTaggingIntroSeen === true,
    discoverySurveyDismissed: a.discoverySurveyDismissed || b.discoverySurveyDismissed === true,
  };
}
function readHistory(accountDigest: string): PromptHistory {
  try { return mergeHistory(emptyHistory, JSON.parse(localStorage.getItem(`${HISTORY_PREFIX}${accountDigest}`) || "{}")); }
  catch { return { ...emptyHistory }; }
}
function saveHistory(accountDigest: string, history: PromptHistory): void {
  try { localStorage.setItem(`${HISTORY_PREFIX}${accountDigest}`, JSON.stringify(history)); }
  catch { /* Session flags still prevent repeat prompts when local storage is unavailable. */ }
}
function isComplete(history: Partial<PromptHistory>): boolean {
  return history.mobileTaggingIntroSeen === true && history.discoverySurveyDismissed === true;
}
function isConfirmedComplete(accountDigest: string): boolean {
  try { return localStorage.getItem(`${COMPLETE_PREFIX}${accountDigest}`) === "1" && isComplete(readHistory(accountDigest)); }
  catch { return false; }
}
function markConfirmedComplete(accountDigest: string): void {
  try { localStorage.setItem(`${COMPLETE_PREFIX}${accountDigest}`, "1"); }
  catch { /* A missing marker only causes one more confirmation request. */ }
}

/** Import unscoped flags into one account only, never into every subsequent login. */
function adoptLegacyHistory(accountDigest: string): PromptHistory {
  let history = readHistory(accountDigest);
  try {
    const owner = localStorage.getItem(LEGACY_PROMPT_OWNER_KEY);
    if (owner && owner !== accountDigest) return history;
    localStorage.setItem(LEGACY_PROMPT_OWNER_KEY, accountDigest);
    let survey: { hasCompletedSurvey?: boolean; hasDismissedSurvey?: boolean; skipCount?: number } = {};
    try { survey = JSON.parse(localStorage.getItem(LEGACY_SURVEY_KEY) || "{}"); }
    catch { /* A damaged survey record must not erase the mobile introduction dismissal. */ }
    history = mergeHistory(history, {
      mobileTaggingIntroSeen: localStorage.getItem(MOBILE_TAGGING_INTRO_KEY) === "seen",
      discoverySurveyDismissed: survey?.hasCompletedSurvey === true || survey?.hasDismissedSurvey === true || (survey?.skipCount ?? 0) > 0,
    });
  } catch { /* Invalid older data must not prevent recovering account history. */ }
  saveHistory(accountDigest, history);
  return history;
}

export class PromptHistoryStore {
  private snapshot: PromptHistorySnapshot = { ...emptyHistory, accountDigest: null, ready: false };
  private listeners = new Set<() => void>();
  private requests = new Map<string, Promise<void>>();
  private reruns = new Set<string>();
  private active = 0;
  private identityRevision = 0;
  /** Accounts whose history Community returned during this Spotify session. */
  private readThisSession = new Set<string>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private nextAttemptAt = 0;
  private version = "";
  private unresolvedDismissals: PromptHistory = { ...emptyHistory };

  constructor(private identity = getUsageAccountDigest, private request: typeof fetch = (...args) => fetch(...args)) {}

  getSnapshot = (): PromptHistorySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(snapshot: PromptHistorySnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  start(appVersion: string): () => void {
    this.version = appVersion;
    if (this.active++ === 0) {
      window.addEventListener("online", this.resumeOnline);
      document.addEventListener("visibilitychange", this.resumeVisible);
      void this.refresh();
    }
    return () => {
      if (--this.active > 0) return;
      window.removeEventListener("online", this.resumeOnline);
      document.removeEventListener("visibilitychange", this.resumeVisible);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    };
  }

  private resumeOnline = (): void => {
    if (document.visibilityState === "hidden") return;
    this.retries = 0;
    this.nextAttemptAt = 0;
    void this.refresh();
  };

  // Showing Spotify again only retries a read that hasn't succeeded yet, and
  // never restarts a failed request's back-off.
  private resumeVisible = (): void => {
    if (document.visibilityState === "hidden" || this.snapshot.ready || this.retryTimer || Date.now() < this.nextAttemptAt) return;
    void this.refresh();
  };

  async refresh(): Promise<void> {
    const revision = ++this.identityRevision;
    const accountDigest = await this.identity();
    if (revision !== this.identityRevision) return;
    if (!accountDigest) {
      this.publish({ ...emptyHistory, accountDigest: null, ready: false });
      this.scheduleRetry();
      return;
    }
    if (accountDigest !== this.snapshot.accountDigest) {
      const history = mergeHistory(adoptLegacyHistory(accountDigest), this.unresolvedDismissals);
      this.unresolvedDismissals = { ...emptyHistory };
      saveHistory(accountDigest, history);
      this.publish({ ...history, accountDigest, ready: this.readThisSession.has(accountDigest) });
    }
    if (isConfirmedComplete(accountDigest)) {
      if (!this.snapshot.ready && this.snapshot.accountDigest === accountDigest) this.publish({ ...this.snapshot, ready: true });
      return;
    }
    // Read once per Spotify session. Dismissals on this device are sent as they
    // happen (markSeen); ones made on another device arrive with the next start.
    if (this.readThisSession.has(accountDigest)) return;
    await this.sync(accountDigest);
  }

  markSeen(prompt: keyof PromptHistory): void {
    const { accountDigest } = this.snapshot;
    if (!accountDigest) {
      this.unresolvedDismissals = mergeHistory(this.unresolvedDismissals, { [prompt]: true });
      return;
    }
    const history = mergeHistory(this.snapshot, { [prompt]: true });
    saveHistory(accountDigest, history);
    this.publish({ ...this.snapshot, ...history });
    if (isConfirmedComplete(accountDigest)) return;
    void this.sync(accountDigest);
  }

  private scheduleRetry(): void {
    const delay = RETRY_DELAYS_MS[this.retries] ?? EXHAUSTED_RETRY_DELAY_MS;
    this.nextAttemptAt = Math.max(Date.now() + delay, usageRequestsPausedUntil());
    if (!this.active || this.retryTimer || this.retries >= RETRY_DELAYS_MS.length) return;
    this.retries++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.refresh();
    }, this.nextAttemptAt - Date.now());
  }

  private sync(accountDigest: string): Promise<void> {
    const existing = this.requests.get(accountDigest);
    if (existing) { this.reruns.add(accountDigest); return existing; }
    if (!navigator.onLine || usageRequestsPausedUntil()) { this.scheduleRetry(); return Promise.resolve(); }
    const current = this.snapshot.accountDigest === accountDigest ? this.snapshot : readHistory(accountDigest);
    const promptHistory = Object.fromEntries(Object.entries(emptyHistory)
      .filter(([key]) => current[key as keyof PromptHistory]).map(([key]) => [key, true]));
    const work = (async () => {
      try {
        const response = await this.request(USAGE_URL, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Tagify-Client-Version": this.version },
          body: JSON.stringify({ accountDigest, appVersion: this.version, promptHistory }),
          signal: AbortSignal.timeout(10_000), keepalive: true,
        });
        if (!response.ok) {
          pauseUsageRequestsAfter(response);
          throw new Error("Prompt history unavailable");
        }
        const body = await response.json();
        const recovered = body?.promptHistory;
        if (typeof recovered?.mobileTaggingIntroSeen !== "boolean" || typeof recovered?.discoverySurveyDismissed !== "boolean") throw new Error("Prompt history unavailable");
        const latest = this.snapshot.accountDigest === accountDigest ? this.snapshot : readHistory(accountDigest);
        const history = mergeHistory(latest, recovered);
        saveHistory(accountDigest, history);
        if (this.snapshot.accountDigest === accountDigest) this.publish({ ...history, accountDigest, ready: true });
        this.readThisSession.add(accountDigest);
        // Dismissals only ever turn on, so once Community holds both there is nothing left to sync.
        if (isComplete(history) && isComplete(recovered)) markConfirmedComplete(accountDigest);
        this.retries = 0;
        this.nextAttemptAt = 0;
      } catch {
        // Optional automatic prompts wait until history is known; Help stays available.
        this.scheduleRetry();
      }
    })().finally(() => {
      this.requests.delete(accountDigest);
      if (this.reruns.delete(accountDigest)) void this.sync(accountDigest);
    });
    this.requests.set(accountDigest, work);
    return work;
  }
}

export const promptHistoryStore = new PromptHistoryStore();
