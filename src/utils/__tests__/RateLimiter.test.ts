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
