import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";

export const MOBILE_TAGGING_INTRO_KEY = "tagify:smart-playlists:mobile-tagging-intro:v1";
export const LEGACY_SURVEY_KEY = "tagify:discoverySurvey";
export const LEGACY_PROMPT_OWNER_KEY = "tagify:prompt-history:legacy-owner:v1";
const HISTORY_PREFIX = "tagify:prompt-history:v1:";
const USAGE_URL = "https://community.tagify.fm/api/v1/tagify-usage";

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
  private lastSyncedAt = new Map<string, number>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
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
      window.addEventListener("online", this.resume);
      document.addEventListener("visibilitychange", this.resume);
      void this.refresh();
    }
    return () => {
      if (--this.active > 0) return;
      window.removeEventListener("online", this.resume);
      document.removeEventListener("visibilitychange", this.resume);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    };
  }

  private resume = (): void => {
    if (document.visibilityState === "hidden") return;
    this.retries = 0;
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
      this.publish({ ...history, accountDigest, ready: false });
    }
    if (this.snapshot.ready && Date.now() - (this.lastSyncedAt.get(accountDigest) ?? 0) < 5 * 60_000) return;
    await this.sync(accountDigest);
  }

  markSeen(prompt: keyof PromptHistory): void {
    const { accountDigest } = this.snapshot;
    if (!accountDigest) {
      this.unresolvedDismissals = mergeHistory(this.unresolvedDismissals, { [prompt]: true });
      return;
    }
    this.lastSyncedAt.delete(accountDigest);
    const history = mergeHistory(this.snapshot, { [prompt]: true });
    saveHistory(accountDigest, history);
    this.publish({ ...this.snapshot, ...history });
    void this.sync(accountDigest);
  }

  private scheduleRetry(): void {
    if (!this.active || this.retryTimer || this.retries >= 3) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.refresh();
    }, [5_000, 30_000, 120_000][this.retries++]);
  }

  private sync(accountDigest: string): Promise<void> {
    const existing = this.requests.get(accountDigest);
    if (existing) { this.reruns.add(accountDigest); return existing; }
    if (!navigator.onLine) { this.scheduleRetry(); return Promise.resolve(); }
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
        if (!response.ok) throw new Error("Prompt history unavailable");
        const body = await response.json();
        const recovered = body?.promptHistory;
        if (typeof recovered?.mobileTaggingIntroSeen !== "boolean" || typeof recovered?.discoverySurveyDismissed !== "boolean") throw new Error("Prompt history unavailable");
        const latest = this.snapshot.accountDigest === accountDigest ? this.snapshot : readHistory(accountDigest);
        const history = mergeHistory(latest, recovered);
        saveHistory(accountDigest, history);
        if (this.snapshot.accountDigest === accountDigest) this.publish({ ...history, accountDigest, ready: true });
        this.lastSyncedAt.set(accountDigest, Date.now());
        this.retries = 0;
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
