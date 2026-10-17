import { setAnalyticsSharing } from "@/features/product-analytics/productAnalytics";
vi.mock("@/features/product-analytics/config.json", () => ({ default: { token: "", host: "https://us.i.posthog.com" } }));
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { ACTIVITY_REPORT_INTERVAL_MS, activityDay, recordMeaningfulAction, getUsageAccountDigest, isUsageReportDue, recordDiscoveryAnswer, recordTagifyOpen, retryAfterMs, USAGE_PAUSED_UNTIL_KEY, useTagifyUsage } from "../tagifyUsage";

describe("private Tagify usage recording", () => {
  let getUser: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    localStorage.clear();
    getUser = vi.fn().mockResolvedValue({ username: "stable-account", displayName: "A changeable name" });
    vi.stubGlobal("Spicetify", { Platform: { UserAPI: { getUser } } });
    vi.stubGlobal("crypto", webcrypto);
    setAnalyticsSharing((await getUsageAccountDigest())!, true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ activityRecorded: true }) }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("automatically reports daily activity despite an unpublished disabled client preference", async () => {
    const digest = (await getUsageAccountDigest())!;
    localStorage.setItem(`tagify:product-analytics:v1:${digest}`, JSON.stringify({ schemaVersion: 2, enabled: false, events: [] }));
    await recordMeaningfulAction("rating");
    expect(await recordTagifyOpen("3.1.0")).toBe(true);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body).toMatchObject({ accountDigest: digest, activityCapable: true, activity: { rating: 1, tagging: 0 } });
  });

  it("stops optional activity while off and still sends a voluntarily submitted survey", async () => {
    setAnalyticsSharing((await getUsageAccountDigest())!, false);
    await recordMeaningfulAction("tagging");
    await recordTagifyOpen("3.1.0");
    expect(fetch).not.toHaveBeenCalled();
    await recordDiscoveryAnswer("3.1.0", { source: "reddit" });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.survey).toEqual({ source: "reddit" });
    expect(body).not.toHaveProperty("activity");
    expect(body).not.toHaveProperty("activityCapable");
  });

  it("aborts an optional aggregate report when sharing is turned off", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = recordTagifyOpen("3.1.0");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    setAnalyticsSharing((await getUsageAccountDigest())!, false);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish({ ok: true, json: async () => ({ activityRecorded: true }) } as Response);
    expect(await pending).toBe(false);
  });

  it("records an empty-library open without sending names, tokens, or song data", async () => {
    expect(await recordTagifyOpen("3.0.0")).toBe(true);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(Object.keys(body).sort()).toEqual(["accountDigest", "activityCapable", "appVersion"]);
    expect(body.accountDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain("stable-account");
  });

  it("keeps retried counters stable and preserves actions made during a request", async () => {
    await recordTagifyOpen("3.1.0");
    await recordMeaningfulAction("tagging");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    expect(await recordTagifyOpen("3.1.0")).toBe(false);
    const first = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).activity;
    expect(first).toMatchObject({ day: activityDay(), tagging: 1, rating: 0 });
    await recordMeaningfulAction("rating");
    await recordTagifyOpen("3.1.0");
    const retry = JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body)).activity;
    expect(retry).toEqual({ ...first, rating: 1 });
    await recordTagifyOpen("3.1.0");
    expect(fetch).toHaveBeenCalledTimes(3);
    getUser.mockResolvedValue({ username: "another-account" });
    setAnalyticsSharing((await getUsageAccountDigest())!, true);
    await recordTagifyOpen("3.1.0");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[3][1]?.body))).not.toHaveProperty("activity");
  });

  it("does not acknowledge counters when the old server accepts only presence", async () => {
    await recordMeaningfulAction("tagging");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ recorded: true }) } as Response);
    expect(await recordTagifyOpen("3.1.0")).toBe(false);
    await recordTagifyOpen("3.1.0");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).activity.tagging).toBe(1);
  });

  it("flushes inline edits without mounting the main app and stops after acknowledgement", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      const inline = await import("../tagifyUsage");
      await inline.recordMeaningfulAction("tagging");
      await inline.recordMeaningfulAction("rating");
      expect(fetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(ACTIVITY_REPORT_INTERVAL_MS);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).activity).toMatchObject({ tagging: 1, rating: 1 });
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { visibility.mockRestore(); vi.useRealTimers(); }
  });

  it("backs off inline counters while offline or rate-limited without losing later edits", async () => {
    vi.useFakeTimers(); vi.resetModules();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      const inline = await import("../tagifyUsage");
      await inline.recordMeaningfulAction("tagging");
      await vi.advanceTimersByTimeAsync(ACTIVITY_REPORT_INTERVAL_MS);
      expect(fetch).not.toHaveBeenCalled();
      online.mockReturnValue(true);
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => "3600" } } as unknown as Response);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      await inline.recordMeaningfulAction("tagging");
      await vi.advanceTimersByTimeAsync(59 * 60_000);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).activity.tagging).toBe(2);
    } finally { vi.clearAllTimers(); online.mockRestore(); visibility.mockRestore(); vi.useRealTimers(); }
  });

  it("does not flush the previous Spotify account's inline queue after a switch", async () => {
    vi.useFakeTimers(); vi.resetModules();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      const inline = await import("../tagifyUsage");
      await inline.recordMeaningfulAction("tagging");
      getUser.mockResolvedValue({ username: "another-account" });
    setAnalyticsSharing((await getUsageAccountDigest())!, true);
      await vi.advanceTimersByTimeAsync(ACTIVITY_REPORT_INTERVAL_MS);
      expect(fetch).not.toHaveBeenCalled();
      await inline.recordTagifyOpen("3.1.0");
      expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).not.toHaveProperty("activity");
      getUser.mockResolvedValue({ username: "stable-account" });
      await inline.recordTagifyOpen("3.1.0");
      expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).activity.tagging).toBe(1);
    } finally { vi.clearAllTimers(); visibility.mockRestore(); vi.useRealTimers(); }
  });

  it("sends an hour of steady tagging as four reports instead of sixty", async () => {
    // Keep hashing on the fake clock's microtasks.
    vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array(32).buffer }, randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" });
    setAnalyticsSharing("0".repeat(64), true);
    vi.useFakeTimers(); vi.resetModules();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    try {
      const inline = await import("../tagifyUsage");
      // The same version the inline flush reports, so no update report is due.
      const { default: { version } } = await import("@/package");
      await inline.recordTagifyOpen(version);
      vi.mocked(fetch).mockClear();
      for (let minute = 0; minute < 60; minute++) {
        await inline.recordMeaningfulAction("tagging");
        // Showing Spotify again checks too, but only sends when a report is due.
        await inline.recordTagifyOpen(version, { batchActivity: true });
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(fetch).toHaveBeenCalledTimes(4);
      const sent = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).activity.tagging);
      expect(sent.at(-1)).toBeGreaterThanOrEqual(45);
    } finally { vi.clearAllTimers(); visibility.mockRestore(); vi.useRealTimers(); }
  });

  it("keeps the same identity after local data is cleared or the display name changes", async () => {
    const before = await getUsageAccountDigest();
    localStorage.clear();
    getUser.mockResolvedValue({ username: "stable-account", displayName: "Changed" });
    expect(await getUsageAccountDigest()).toBe(before);
    getUser.mockResolvedValue({ username: "another-account" });
    setAnalyticsSharing((await getUsageAccountDigest())!, true);
    expect(await getUsageAccountDigest()).not.toBe(before);
  });

  it("throttles repeated opens but sends an answer immediately", async () => {
    await recordTagifyOpen("3.0.0");
    await recordTagifyOpen("3.0.0");
    expect(fetch).toHaveBeenCalledTimes(1);
    await recordDiscoveryAnswer("3.0.0", { source: "reddit" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).survey).toEqual({ source: "reddit" });
  });

  it("retries a failed answer with its own account on a later open", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    expect(await recordDiscoveryAnswer("3.0.0", { source: "friend", otherDetails: "a DJ" })).toBe(false);
    getUser.mockResolvedValue({ username: "another-account" });
    setAnalyticsSharing((await getUsageAccountDigest())!, true);
    await recordTagifyOpen("3.0.0");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).not.toHaveProperty("survey");
    getUser.mockResolvedValue({ username: "stable-account" });
    await recordTagifyOpen("3.0.0");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body)).survey.source).toBe("friend");
  });

  it("does not invent a user identity when Spotify's account is unavailable", async () => {
    getUser.mockResolvedValue({ displayName: "Only a name" });
    expect(await recordTagifyOpen("3.0.0")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports at most once per day, plus once after an update", () => {
    const morning = Date.UTC(2026, 9, 9, 8);
    expect(isUsageReportDue(0, null, "3.0.1", morning)).toBe(true);
    expect(isUsageReportDue(morning, "3.0.1", "3.0.1", Date.UTC(2026, 9, 9, 23, 59))).toBe(false);
    expect(isUsageReportDue(morning, "3.0.1", "3.0.1", Date.UTC(2026, 9, 10, 4, 0))).toBe(true);
    expect(isUsageReportDue(morning, "3.0.0", "3.0.1", morning + 60_000)).toBe(true);
    expect(isUsageReportDue(morning, null, "3.0.1", morning + 60_000)).toBe(true);
    expect(isUsageReportDue(morning + 60_000, "3.0.1", "3.0.1", morning)).toBe(true);
  });

  it("sends one open report per day instead of every hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 9, 8));
    await recordTagifyOpen("3.0.1");
    vi.setSystemTime(Date.UTC(2026, 9, 9, 20));
    await recordTagifyOpen("3.0.1");
    expect(fetch).toHaveBeenCalledTimes(1);
    await recordTagifyOpen("3.0.2");
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.UTC(2026, 9, 10, 8));
    await recordTagifyOpen("3.0.2");
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterMs("120", 0)).toBe(120_000);
    expect(retryAfterMs(new Date(90_000).toUTCString(), 0)).toBe(90_000);
    expect(retryAfterMs("999999999", 0)).toBe(24 * 60 * 60 * 1000);
    expect(retryAfterMs("soon", 0)).toBeNull();
    expect(retryAfterMs(null, 0)).toBeNull();
  });

  it("waits as long as Community asks after a rate limit, keeping a queued answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ recorded: false }), { status: 429, headers: { "Retry-After": "120" } }));
    expect(await recordDiscoveryAnswer("3.0.1", { source: "discord" })).toBe(false);
    expect(Number(localStorage.getItem(USAGE_PAUSED_UNTIL_KEY))).toBe(Date.now() + 120_000);

    vi.setSystemTime(Date.now() + 119_000);
    expect(await recordTagifyOpen("3.0.1")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1_000);
    expect(await recordTagifyOpen("3.0.1")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).survey).toEqual({ source: "discord" });
    vi.useRealTimers();
  });

  it("does not restart failed retries each time Spotify is shown again", async () => {
    // Keep hashing on the fake clock's microtasks.
    vi.stubGlobal("crypto", { subtle: { digest: async () => new Uint8Array(32).buffer } });
    setAnalyticsSharing("0".repeat(64), true);
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    const { unmount } = renderHook(() => useTagifyUsage("3.0.1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 5; index++) document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000 + 120_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    for (let index = 0; index < 5; index++) document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    unmount();
    vi.useRealTimers();
  });
});
