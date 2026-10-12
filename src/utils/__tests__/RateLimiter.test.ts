import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RateLimiter } from "../RateLimiter";
import { getSpotifyRetryAfterMs } from "../spotifyRateLimit";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T12:00:00Z")); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it("counts pending requests at dispatch and deduplicates concurrent callers", async () => {
  const limiter = new RateLimiter({ maxRequestsPerSecond: 1 });
  let finish!: (value: string) => void;
  const lookup = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const first = limiter.execute("one", lookup);
  const duplicate = limiter.execute("one", lookup);
  const secondLookup = vi.fn().mockResolvedValue("second");
  const second = limiter.execute("two", secondLookup);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(secondLookup).not.toHaveBeenCalled();
  finish("first");
  await expect(first).resolves.toBe("first");
  await expect(duplicate).resolves.toBe("first");
  await vi.advanceTimersByTimeAsync(1000);
  await expect(second).resolves.toBe("second");
});
it("shares Spotify's cooldown across keys without automatically retrying 429s", async () => {
  const limiter = new RateLimiter();
  await expect(limiter.execute("one", async () => { throw { status: 429, headers: new Headers({ "Retry-After": "120" }) }; })).rejects.toMatchObject({ status: 429 });
  const lookup = vi.fn().mockResolvedValue("ok");
  await expect(limiter.execute("two", lookup)).rejects.toMatchObject({ status: 429 });
  expect(lookup).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(120_000);
  await expect(limiter.execute("two", lookup)).resolves.toBe("ok");
});
it("supports header dates, desktop messages, and a safe fallback when Retry-After is absent", () => {
  expect(getSpotifyRetryAfterMs({ message: "429 Too Many Requests" })).toBe(60_000);
  expect(getSpotifyRetryAfterMs({ extensions: { http: { status: 429, headers: { "retry-after": new Date(Date.now() + 120_000).toUTCString() } } } })).toBe(120_000);
  expect(getSpotifyRetryAfterMs(new Error("offline"))).toBeNull();
});
it("cancels queued consumers and retains timed-out uncancellable requests", async () => {
  const limiter = new RateLimiter({ maxConcurrent: 1, requestTimeoutMs: 100 });
  let finish!: (value: string) => void;
  const lookup = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const first = expect(limiter.execute("stuck", lookup)).rejects.toThrow("taking too long");
  const controller = new AbortController();
  const next = vi.fn().mockResolvedValue("next");
  const queued = expect(limiter.execute("queued", next, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await queued;
  await vi.advanceTimersByTimeAsync(100);
  await first;
  await expect(limiter.execute("stuck", lookup)).rejects.toThrow("taking too long");
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
  finish("late");
  await vi.advanceTimersByTimeAsync(0);
  await expect(limiter.execute("queued", next)).resolves.toBe("next");
});
it("keeps a shared request alive when only one consumer cancels", async () => {
  const limiter = new RateLimiter();
  let finish!: (value: string) => void;
  const lookup = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const first = expect(limiter.execute("shared", lookup, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  const second = limiter.execute("shared", lookup);
  controller.abort(); await first;
  finish("kept"); await expect(second).resolves.toBe("kept");
  expect(lookup).toHaveBeenCalledTimes(1);
});
it("admits foreground work by deferring queued background work", async () => {
  const limiter = new RateLimiter({ maxConcurrent: 2, maxQueued: 1 });
  let finish!: (value: string) => void;
  const first = limiter.execute("background", () => new Promise<string>(resolve => { finish = resolve; }), { priority: "background" });
  const queuedLookup = vi.fn().mockResolvedValue("queued");
  const queued = expect(limiter.execute("waiting", queuedLookup, { priority: "background" })).rejects.toThrow("deferred");
  await expect(limiter.execute("foreground", async () => "ready")).resolves.toBe("ready");
  await queued;
  expect(queuedLookup).not.toHaveBeenCalled();
  finish("done"); await first;
});
it("reserves starts for foreground work after exhausting the background allowance", async () => {
  const limiter = new RateLimiter();
  for (let i = 0; i < 120; i++) {
    const task = limiter.execute(`background-${i}`, async () => i, { priority: "background" });
    await vi.advanceTimersByTimeAsync(210); await task;
  }
  const background = vi.fn().mockResolvedValue("later");
  const queued = limiter.execute("next-background", background, { priority: "background" });
  const foreground = vi.fn().mockResolvedValue("immediate");
  await expect(limiter.execute("foreground", foreground)).resolves.toBe("immediate");
  expect(background).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000); await queued;
});
it("quarantines stalled desktop calls without blocking other transports and recovers on settlement", async () => {
  const limiter = new RateLimiter();
  const finishes: Array<() => void> = [];
  const stuck = Array.from({ length: 4 }, (_, i) => limiter.execute(`desktop-${i}`, () => new Promise<void>(resolve => finishes.push(resolve))).catch(error => error));
  await vi.advanceTimersByTimeAsync(10_000); await Promise.all(stuck);
  expect(limiter.getStats()).toMatchObject({ activeRequests: 0, stalledRequests: 4 });
  await expect(limiter.execute("desktop-new", async () => true)).rejects.toMatchObject({ recoveryRequired: true });
  await expect(limiter.execute("metadata", async () => "ready", { transport: "graphql" })).resolves.toBe("ready");
  await expect(limiter.execute("rest", async () => "ready", { transport: "fetch" })).resolves.toBe("ready");
  finishes.forEach(finish => finish()); await vi.advanceTimersByTimeAsync(0);
  expect(limiter.getStats().stalledRequests).toBe(0);
  await expect(limiter.execute("desktop-new", async () => true)).resolves.toBe(true);
});

it("promotes an existing background lookup without launching another request", async () => {
  const limiter = new RateLimiter({ maxRequestsPerMinute: 5 });
  await limiter.execute("background-1", async () => true, { priority: "background" });
  await limiter.execute("background-2", async () => true, { priority: "background" });
  const token = { current: "background" as "foreground" | "background" };
  const lookup = vi.fn().mockResolvedValue("ready");
  const pending = limiter.execute("shared", lookup, { priorityToken: token });
  expect(lookup).not.toHaveBeenCalled();
  limiter.promote(token);
  await expect(pending).resolves.toBe("ready");
  expect(lookup).toHaveBeenCalledTimes(1);
});
