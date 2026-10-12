import { classifySpotifyFailure, spotifyLocalPause, type SpotifyFailure } from "./spotifyRequestFailure";
import { spotifyRequestAccounting, requestFeature, type SpotifyRequestFeature } from "./spotifyRequestAccounting";
import { getSpotifyRetryAfterMs } from "./spotifyRateLimit";

interface RateLimiterConfig {
  maxRequestsPerSecond: number;
  maxRequestsPerMinute: number;
  maxConcurrent: number;
  maxQueued: number;
  queueTimeoutMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
  requestTimeoutMs: number;
}
export type SpotifyTransport = "desktop" | "graphql" | "fetch";
export interface RequestPriority { current: "foreground" | "background" }
export interface RequestOptions { assertCurrent?: () => void; accountingAtTransport?: boolean; feature?: SpotifyRequestFeature; resource?: string; priorityToken?: RequestPriority; signal?: AbortSignal; priority?: "foreground" | "background"; transport?: SpotifyTransport }
interface Job {
  feature: SpotifyRequestFeature;
  accountingAtTransport?: boolean;
  key: string;
  transport: SpotifyTransport;
  priorityToken?: RequestPriority;
  stalled?: boolean;
  run: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  consumers: number;
  started: boolean;
  priority: "foreground" | "background";
  timer?: ReturnType<typeof setTimeout>;
}
const stopped = (message: string) => Object.assign(new Error(message), { spotifyRequestStopped: true });
const aborted = () => new DOMException("Request cancelled", "AbortError");

/** Timed-out calls retain their identity and quarantine their transport, not unrelated work. */
export class RateLimiter {
  private config: RateLimiterConfig;
  private history: Array<{ at: number; background: boolean }> = [];
  private stalled = new Map<SpotifyTransport, number>();
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private generation = 0;
  private active = 0;
  private activeBackground = 0;
  private consecutiveErrors = 0;
  private circuitOpenedAt = 0;
  private blockedUntil = 0;
  private blockedCause?: SpotifyFailure;
  private wake?: ReturnType<typeof setTimeout>;
  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { maxRequestsPerSecond: 15, maxRequestsPerMinute: 300, maxConcurrent: 4,
      maxQueued: 200, queueTimeoutMs: 60_000, circuitBreakerThreshold: 10,
      circuitBreakerResetMs: 30_000, requestTimeoutMs: 10_000, ...config };
  }
  pause(retryAfterMs: number, cause?: SpotifyFailure): void {
    const until = Date.now() + retryAfterMs;
    if (until >= this.blockedUntil) { this.blockedUntil = until; this.blockedCause = cause; }
  }
  private gate(): Error | null {
    if (Date.now() < this.blockedUntil) return spotifyLocalPause((this.blockedUntil - Date.now()) / 1000, this.blockedCause);
    if (this.circuitOpenedAt && Date.now() - this.circuitOpenedAt < this.config.circuitBreakerResetMs)
      return stopped("Spotify requests paused after repeated failures");
    if (this.circuitOpenedAt) { this.circuitOpenedAt = 0; this.consecutiveErrors = 0; }
    return null;
  }
  private transportError(transport: SpotifyTransport): Error | null {
    return this.stalled.has(transport) ? Object.assign(stopped("Spotify is taking too long to respond. Your edits are saved. Wait for it to recover, or restart Spotify if updates remain paused."), { recoveryRequired: true }) : null;
  }
  promote(token: RequestPriority): void {
    token.current = "foreground";
    for (const job of this.jobs.values()) if (job.priorityToken === token) job.priority = "foreground";
    this.drain();
  }
  execute<T>(key: string, run: (signal: AbortSignal) => Promise<T>, options: RequestOptions = {}): Promise<T> {
    const feature = options.feature ?? requestFeature(key);
    if (!options.accountingAtTransport) spotifyRequestAccounting.record(feature, "requested", options.transport ?? "desktop");
    if (options.signal?.aborted) return Promise.reject(aborted());
    const error = this.gate() ?? this.transportError(options.transport ?? "desktop");
    if (error) return Promise.reject(error);
    const priority = options.priorityToken?.current ?? options.priority ?? "foreground";
    let job = this.jobs.get(key);
    if (!job) {
      const background = priority === "background";
      const backgroundLimit = Math.max(1, Math.floor(this.config.maxQueued * 0.75));
      if (background && this.queue.filter(item => item.priority === "background").length >= backgroundLimit)
        return Promise.reject(stopped("Background Spotify checks are waiting for capacity"));
      if (this.queue.length >= this.config.maxQueued) {
        const displaced = !background && this.queue.find(item => item.priority === "background");
        if (!displaced) return Promise.reject(stopped("Spotify request queue is full"));
        displaced.reject(stopped("Background Spotify check deferred for your current action"));
        this.removeQueued(displaced);
      }
      let resolve!: Job["resolve"], reject!: Job["reject"];
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      job = { key, feature, accountingAtTransport: options.accountingAtTransport, priorityToken: options.priorityToken, transport: options.transport ?? "desktop", run, promise, resolve, reject, controller: new AbortController(), consumers: 0,
        started: false, priority };
      const queued = job;
      job.timer = setTimeout(() => {
        queued.reject(stopped("Spotify request expired while waiting"));
        this.removeQueued(queued);
      }, this.config.queueTimeoutMs);
      this.jobs.set(key, job);
      this.queue.push(job);
    } else {
      spotifyRequestAccounting.record(feature, "shared", job.transport);
      if (priority !== "background") job.priority = "foreground";
    }
    const current = job;
    current.consumers++;
    const result = new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (error: unknown, value?: T) => {
        if (finished) return;
        finished = true;
        options.signal?.removeEventListener("abort", cancel);
        current.consumers--;
        if (!current.consumers && (error as { name?: string } | null)?.name === "AbortError") {
          current.controller.abort();
          if (!current.started) this.removeQueued(current);
        }
        if (error) reject(error); else resolve(value as T);
      };
      const cancel = () => { spotifyRequestAccounting.record(feature, "cancelled", current.transport); finish(aborted()); };
      options.signal?.addEventListener("abort", cancel, { once: true });
      current.promise.then(value => finish(null, value as T), error => finish(error));
    });
    this.drain();
    return result;
  }
  private removeQueued(job: Job) {
    if (job.started) return;
    if (job.timer) clearTimeout(job.timer);
    this.queue = this.queue.filter(item => item !== job);
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
  }
  private drain() {
    if (this.wake) { clearTimeout(this.wake); this.wake = undefined; }
    const error = this.gate();
    if (error) {
      for (const job of [...this.queue]) { job.reject(error); this.removeQueued(job); }
      return;
    }
    while (this.active < this.config.maxConcurrent && this.queue.length) {
      for (const job of [...this.queue]) {
        const unavailable = this.transportError(job.transport);
        if (unavailable) { job.reject(unavailable); this.removeQueued(job); }
      }
      if (!this.queue.length) return;
      let index = this.queue.findIndex(job => job.priority === "foreground");
      const background = index < 0;
      if (background) {
        if (this.activeBackground >= 1) return;
        index = 0;
      }
      const now = Date.now();
      this.history = this.history.filter(entry => now - entry.at < 60_000);
      const delay = (entries: typeof this.history, limit: number, windowMs: number) =>
        entries.length >= limit ? entries[entries.length - limit].at + windowMs - now : 0;
      const second = this.history.filter(entry => now - entry.at < 1000);
      const backgroundHistory = this.history.filter(entry => entry.background);
      const wait = Math.max(delay(second, this.config.maxRequestsPerSecond, 1000),
        delay(this.history, this.config.maxRequestsPerMinute, 60_000),
        background ? delay(backgroundHistory.filter(entry => now - entry.at < 1000), Math.max(1, Math.floor(this.config.maxRequestsPerSecond / 3)), 1000) : 0,
        background ? delay(backgroundHistory, Math.max(1, Math.floor(this.config.maxRequestsPerMinute * 0.4)), 60_000) : 0);
      if (wait > 0) { this.wake = setTimeout(() => this.drain(), wait); return; }
      const [job] = this.queue.splice(index, 1);
      clearTimeout(job.timer);
      job.started = true;
      if (!job.accountingAtTransport) spotifyRequestAccounting.record(job.feature, "dispatched", job.transport, job.key);
      this.active++;
      if (background) this.activeBackground++;
      this.history.push({ at: now, background });
      job.timer = setTimeout(() => {
        job.controller.abort();
        job.stalled = true;
        spotifyRequestAccounting.record(job.feature, "timedOut", job.transport);
        this.active--;
        if (background) this.activeBackground--;
        this.stalled.set(job.transport, (this.stalled.get(job.transport) ?? 0) + 1);
        job.reject(this.transportError(job.transport));
        this.drain();
      }, this.config.requestTimeoutMs);
      let task: Promise<unknown>;
      try { task = job.run(job.controller.signal); } catch (error) { task = Promise.reject(error); }
      const generation = this.generation;
      Promise.resolve(task).then(value => {
        if (generation !== this.generation) return;
        this.consecutiveErrors = 0;
        spotifyRequestAccounting.record(job.feature, "succeeded", job.transport);
        job.resolve(value);
      }, error => {
        if (generation !== this.generation) return;
        spotifyRequestAccounting.record(job.feature, "failed", job.transport);
        const retryAfter = getSpotifyRetryAfterMs(error);
        if (retryAfter !== null && classifySpotifyFailure(error)?.kind !== "local-pause") this.pause(retryAfter, classifySpotifyFailure(error));
        if (error?.name !== "AbortError" && ++this.consecutiveErrors >= this.config.circuitBreakerThreshold)
          this.circuitOpenedAt = Date.now();
        job.reject(error);
      }).finally(() => {
        clearTimeout(job.timer);
        if (generation !== this.generation) return;
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        if (job.stalled) {
          const remaining = (this.stalled.get(job.transport) ?? 1) - 1;
          if (remaining) this.stalled.set(job.transport, remaining); else this.stalled.delete(job.transport);
        } else {
          this.active--;
          if (background) this.activeBackground--;
        }
        this.drain();
      });
    }
  }
  getStats() {
    return { accounting: spotifyRequestAccounting.snapshot(), requestsLastSecond: this.history.filter(entry => Date.now() - entry.at < 1000).length,
      requestsLastMinute: this.history.filter(entry => Date.now() - entry.at < 60_000).length,
      stalledRequests: [...this.stalled.values()].reduce((sum, count) => sum + count, 0), pausedTransports: [...this.stalled.keys()],
      pendingRequests: this.jobs.size, queuedRequests: this.queue.length, activeRequests: this.active,
      circuitOpen: !!this.circuitOpenedAt, consecutiveErrors: this.consecutiveErrors, blockedUntil: this.blockedUntil };
  }
  reset() {
    this.generation++; this.active = 0; this.activeBackground = 0;
    for (const job of this.jobs.values()) { job.controller.abort(); job.reject(aborted()); clearTimeout(job.timer); }
    this.stalled.clear(); this.jobs.clear(); this.queue = []; this.history = []; this.blockedUntil = 0; this.blockedCause = undefined;
    this.circuitOpenedAt = 0; this.consecutiveErrors = 0;
    if (this.wake) clearTimeout(this.wake);
  }
}
// App and extension are separate bundles in the same Spotify window.
const shared = globalThis as typeof globalThis & { __tagifySpotifyRequestsV1?: RateLimiter };
export const graphqlRateLimiter = shared.__tagifySpotifyRequestsV1 ??= new RateLimiter();
export type { RateLimiterConfig };
