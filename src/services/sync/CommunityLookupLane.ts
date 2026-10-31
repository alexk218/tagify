import { getSpotifyRetryAfterMs } from "@/utils/spotifyRateLimit";
import type { SendSession } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// What a catalog filler desktop's lookup lanes share (CommunityNowPlayingLookups.ts,
// CommunitySpotifySearchLookups.ts): Community hands a filler (Alex's desktop, Community's
// `catalog_fill_desktops`) requests over GET, the desktop searches Spotify's in-app search for each
// (never the Web API) under an allowance of the lane's own, and POSTs the answers. Every other desktop
// is told it isn't a filler and asks again only every few hours. A run stops at Spotify's first
// refusal, while Spotify asks Tagify to wait, at the allowance, or when Community can't be asked,
// and always sends what it found before the stop.

/** How often a filler asks Community for requests. */
export const LOOKUP_POLL_MS = 15_000;
/** How often a desktop Community says isn't a filler asks again. */
export const NOT_A_FILLER_RECHECK_MS = 6 * 60 * 60_000;
/** Answers kept to send again after Community couldn't take them, and requests whose search failed. */
const REMEMBERED = 200;

/** Takes one search from the lane's allowance, and says when Spotify asked Tagify to wait. */
export interface LookupAllowance {
  /** Takes one search from the hour's and the day's allowance; false when none is left or Spotify asked Tagify to wait. */
  reserve(identity: string): boolean;
  /** When the shared pause Spotify asked for ends (0 or past when there is none). */
  pausedUntil(): number;
  /** Waits between two searches. */
  pace(): Promise<void>;
}

export type LookupStop =
  | "unsupported" | "paused" | "signed_out" | "network" | "throttled"
  | "spotify" | "spotify_paused" | "budget" | "search_unavailable";

export interface LookupRun {
  filler: boolean;
  /** Requests handed out this run. */
  lookups: number;
  answered: number;
  searches: number;
  stopped?: LookupStop;
  /** Community's or Spotify's Retry-After, in seconds, when one was given. */
  retryAfterSeconds?: number;
}

/** What one scheduler remembers between runs. */
export interface LookupMemory<Answer> {
  /** Answers found but not yet taken by Community, by request. */
  answers: Map<string, Answer>;
  /** Requests whose search failed; they are left for Community to expire, never searched again. */
  failed: Set<string>;
}

export const newLookupMemory = <Answer>(): LookupMemory<Answer> => ({ answers: new Map(), failed: new Set() });

/** One lane: its Community route, what Community hands out and how one request is searched. */
export interface LookupLane<Request extends { requestId: string }, Answer> {
  /** Community's route, for example `/api/v2/sync/now-playing-lookups`. */
  route: string;
  protocolVersion: number;
  /** The most answers one POST may carry. */
  answersPerPost: number;
  /** Community's GET answer. Throws when it isn't one. */
  parse(value: unknown): { filler: boolean; requests: Request[] };
  /** The reservation identity for one request's search. */
  identity(request: Request): string;
  /** False when this Tagify can't search for it yet: it isn't searched or answered, and Community expires it. */
  canSearch?(request: Request): boolean;
  /** One Spotify search and its answer; null when this Spotify has no such search. Throws when Spotify refuses or fails. */
  search(request: Request): Promise<{ answer: Answer } | null>;
  /** One answer as Community takes it. */
  answer(requestId: string, answer: Answer): unknown;
}

const remember = <T>(collection: Map<string, T> | Set<string>, key: string, value?: T) => {
  if (collection instanceof Map) collection.set(key, value as T); else collection.add(key);
  while (collection.size > REMEMBERED) {
    const oldest = collection.keys().next().value as string;
    collection.delete(oldest);
  }
};

class Stop extends Error {
  constructor(readonly reason: LookupStop, readonly retryAfterSeconds?: number) { super(`Lookups stopped: ${reason}`); }
}

const retryAfterOf = (response: Response): number | undefined => {
  const seconds = Number(response.headers?.get?.("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

const stopFor = (response: Response): Stop => {
  const { status } = response;
  if (status === 404 || status === 405) return new Stop("unsupported");
  if (status === 401 || status === 403) return new Stop("signed_out");
  if (status === 429) return new Stop("throttled", retryAfterOf(response));
  if (status === 503) return new Stop("paused", retryAfterOf(response));
  return new Stop("network", retryAfterOf(response));
};

/**
 * Asks Community for open requests, searches Spotify for each and answers. Answers found before a
 * stop are still sent. Never throws.
 */
export async function runLookupLane<Request extends { requestId: string }, Answer>(
  lane: LookupLane<Request, Answer>, session: SendSession, allowance: LookupAllowance,
  options: { request?: typeof fetch; memory?: LookupMemory<Answer>; now?: () => number } = {},
): Promise<LookupRun> {
  const request = options.request ?? fetch;
  const memory = options.memory ?? newLookupMemory<Answer>();
  const now = options.now ?? Date.now;
  const run: LookupRun = { filler: false, lookups: 0, answered: 0, searches: 0 };
  const call = async (init: RequestInit = {}) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}${lane.route}${init.body ? "" : `?deviceId=${encodeURIComponent(current.deviceId)}`}`, {
        ...init,
        headers: { ...syncClientHeaders(current.accessToken), ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch {
      throw new Stop("network");
    }
    if (!response.ok) throw stopFor(response);
    return await response.json().catch(() => null) as unknown;
  };
  const send = async (answers: Array<[string, Answer]>) => {
    for (let start = 0; start < answers.length; start += lane.answersPerPost) {
      const page = answers.slice(start, start + lane.answersPerPost);
      const current = await session();
      await call({ method: "POST", body: JSON.stringify({
        protocolVersion: lane.protocolVersion, deviceId: current.deviceId,
        answers: page.map(([requestId, answer]) => lane.answer(requestId, answer)),
      }) });
      for (const [requestId] of page) memory.answers.delete(requestId);
      run.answered += page.length;
    }
  };

  const answers: Array<[string, Answer]> = [];
  let halted: Stop | null = null;
  try {
    let parsed;
    try { parsed = lane.parse(await call()); }
    catch (error) { throw error instanceof Stop ? error : new Stop("network"); }
    run.filler = parsed.filler;
    run.lookups = parsed.requests.length;
    for (const item of parsed.requests) {
      if (memory.answers.has(item.requestId)) {
        answers.push([item.requestId, memory.answers.get(item.requestId)!]);
        continue;
      }
      if (memory.failed.has(item.requestId) || (lane.canSearch && !lane.canSearch(item))) continue;
      const pausedUntil = allowance.pausedUntil();
      if (pausedUntil > now()) { halted = new Stop("spotify_paused", Math.ceil((pausedUntil - now()) / 1000)); break; }
      if (!allowance.reserve(lane.identity(item))) {
        const until = allowance.pausedUntil();
        halted = until > now() ? new Stop("spotify_paused", Math.ceil((until - now()) / 1000)) : new Stop("budget");
        break;
      }
      if (run.searches > 0) await allowance.pace();
      run.searches += 1;
      let found: { answer: Answer } | null;
      try {
        found = await lane.search(item);
      } catch (error) {
        // A refusal is never retried around: everything waits for the pause it set.
        const retryAfterMs = getSpotifyRetryAfterMs(error);
        if (retryAfterMs !== null) { halted = new Stop("spotify_paused", Math.ceil(retryAfterMs / 1000)); break; }
        remember(memory.failed, item.requestId);
        halted = new Stop("spotify");
        break;
      }
      if (!found) { halted = new Stop("search_unavailable"); break; }
      remember(memory.answers, item.requestId, found.answer);
      answers.push([item.requestId, found.answer]);
    }
    // What was found is sent even when Spotify stopped answering partway.
    if (answers.length) await send(answers);
  } catch (error) {
    halted = error instanceof Stop ? error : new Stop("network");
  }
  if (halted) {
    run.stopped = halted.reason;
    if (halted.retryAfterSeconds !== undefined) run.retryAfterSeconds = halted.retryAfterSeconds;
  }
  return run;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const defaultStorage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/**
 * Wraps a lane's hourly reservation in its day's cap on this computer (UTC days), kept across
 * restarts under `key`. A search the hour refuses doesn't count against the day.
 */
export function withinDailySearchCap(
  reserve: (identity: string) => boolean,
  options: { key: string; dailySearches: number; storage?: Storage | null; now?: () => number },
): (identity: string) => boolean {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? Date.now;
  return (identity) => {
    const today = new Date(now()).toISOString().slice(0, 10);
    let searches = 0;
    try {
      const saved = JSON.parse(storage?.getItem(options.key) ?? "null") as { day?: unknown; searches?: unknown } | null;
      if (saved?.day === today && typeof saved.searches === "number" && saved.searches >= 0) searches = saved.searches;
    } catch { /* A broken record starts the day again. */ }
    if (searches >= options.dailySearches || !reserve(identity)) return false;
    try { storage?.setItem(options.key, JSON.stringify({ day: today, searches: searches + 1 })); } catch { /* The hour still holds. */ }
    return true;
  };
}

const MINUTE = 60_000;
/** Waits after a run that stopped, before Community is asked again. */
const BACKOFF = {
  /** Community without the route (until the Community side ships): an hour, doubling to twelve. */
  unsupported: { firstMs: 60 * MINUTE, maxMs: 12 * 60 * MINUTE },
  /** Community unreachable or failing (5xx, network): a minute, doubling to thirty. */
  network: { firstMs: MINUTE, maxMs: 30 * MINUTE },
  /** A Spotify search failed without a refusal: two minutes, doubling to thirty. */
  spotify: { firstMs: 2 * MINUTE, maxMs: 30 * MINUTE },
  signedOutMs: 15 * MINUTE,
  pausedMs: 5 * MINUTE,
  budgetMs: 5 * MINUTE,
  searchUnavailableMs: 10 * MINUTE,
  maxRetryAfterMs: 6 * 60 * MINUTE,
} as const;

export interface LookupSchedulerOptions<Memory> {
  run: (memory: Memory) => Promise<LookupRun>;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/**
 * Runs a lane: once when sync starts, then every 15 seconds while Community says this desktop is a
 * filler, every few hours while it says it isn't, and after a quiet, growing wait when Community or
 * Spotify can't be asked. One run at a time; nothing after sync stops.
 */
export class LookupScheduler<Memory> {
  private running: Promise<void> | null = null;
  private timer: unknown = null;
  private stopped = true;
  private failures: Partial<Record<"unsupported" | "network" | "spotify", number>> = {};
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(private readonly options: LookupSchedulerOptions<Memory>, private readonly memory: Memory) {
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  /** After each pull: starts the lane if it isn't already running or waiting. */
  poll(): void {
    if (!this.stopped && (this.running || this.timer)) return;
    this.stopped = false;
    this.trigger();
  }

  /** Sync stopped: no more asking until the next start. A run in progress finishes. */
  stop(): void {
    this.stopped = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.failures = {};
  }

  /** The current run, for tests. */
  get pending(): Promise<void> | null { return this.running; }

  private trigger(): void {
    if (this.running || this.stopped) return;
    this.timer = null;
    this.running = (async () => {
      let wait: number = LOOKUP_POLL_MS;
      try {
        const run = await this.options.run(this.memory).catch((): LookupRun => ({ filler: false, lookups: 0, answered: 0, searches: 0, stopped: "network" }));
        wait = this.waitAfter(run);
      } finally {
        this.running = null;
        if (!this.stopped) this.timer = this.setTimer(() => this.trigger(), wait);
      }
    })();
  }

  private growing(kind: "unsupported" | "network" | "spotify"): number {
    const failures = (this.failures[kind] ?? 0) + 1;
    this.failures[kind] = failures;
    return Math.min(BACKOFF[kind].maxMs, BACKOFF[kind].firstMs * 2 ** (failures - 1));
  }

  private waitAfter(run: LookupRun): number {
    const asked = Math.min((run.retryAfterSeconds ?? 0) * 1_000, BACKOFF.maxRetryAfterMs);
    if (run.stopped !== "unsupported") delete this.failures.unsupported;
    if (run.stopped !== "network" && run.stopped !== "throttled") delete this.failures.network;
    if (run.stopped !== "spotify") delete this.failures.spotify;
    switch (run.stopped) {
      case undefined: return run.filler ? LOOKUP_POLL_MS : NOT_A_FILLER_RECHECK_MS;
      case "unsupported": return this.growing("unsupported");
      case "network": case "throttled": return Math.max(this.growing("network"), asked);
      case "spotify": return this.growing("spotify");
      case "signed_out": return BACKOFF.signedOutMs;
      case "paused": return Math.max(BACKOFF.pausedMs, asked);
      case "spotify_paused": return Math.max(LOOKUP_POLL_MS, asked);
      case "budget": return BACKOFF.budgetMs;
      case "search_unavailable": return BACKOFF.searchUnavailableMs;
    }
  }
}
