import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { getUsageAccountDigest, isUsageReportDue, recordDiscoveryAnswer, recordTagifyOpen, retryAfterMs, USAGE_PAUSED_UNTIL_KEY, useTagifyUsage } from "../tagifyUsage";

describe("private Tagify usage recording", () => {
  let getUser: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    getUser = vi.fn().mockResolvedValue({ username: "stable-account", displayName: "A changeable name" });
    vi.stubGlobal("Spicetify", { Platform: { UserAPI: { getUser } } });
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("records an empty-library open without sending names, tokens, or song data", async () => {
    expect(await recordTagifyOpen("3.0.0")).toBe(true);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(Object.keys(body).sort()).toEqual(["accountDigest", "appVersion"]);
    expect(body.accountDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain("stable-account");
  });

  it("keeps the same identity after local data is cleared or the display name changes", async () => {
    const before = await getUsageAccountDigest();
    localStorage.clear();
    getUser.mockResolvedValue({ username: "stable-account", displayName: "Changed" });
    expect(await getUsageAccountDigest()).toBe(before);
    getUser.mockResolvedValue({ username: "another-account" });
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
    expect(isUsageReportDue(morning, "3.0.1", "3.0.1", Date.UTC(2026, 9, 10, 0, 0))).toBe(true);
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
