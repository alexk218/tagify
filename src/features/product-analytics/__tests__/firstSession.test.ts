import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { recordProductEvent } from "../productAnalytics";
import { FIRST_SESSION_PREFIX, minutesBucket, readFirstSession, songsViewedBucket, tickFirstSession, writeFirstSession } from "../firstSession";
import { noteFirstSessionSongViewed, startFirstSessionWatch, stopFirstSessionWatch, TICK_MS } from "../firstSessionWatch";

const account = "0".repeat(64);
const queueKey = "tagify:product-analytics:v1:" + account;
const queued = () => (JSON.parse(localStorage.getItem(queueKey) || "{}").events ?? []) as Array<{ event: string; timestamp: string; properties: Record<string, unknown> }>;
const ended = () => queued().filter((event) => event.event === "first_session_ended");
let visibility: DocumentVisibilityState = "visible";

describe("first session of a brand-new account", () => {
  beforeEach(() => {
    localStorage.clear();
    stopFirstSessionWatch();
    const runtime = (window as any).__tagifyProductAnalyticsV1;
    for (const timer of runtime.timers.values()) clearTimeout(timer);
    runtime.blockedAccounts?.clear(); runtime.timers.clear(); runtime.requests.clear(); runtime.openedDays.clear(); runtime.pausedUntil = 0;
    vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: { digest: async () => new Uint8Array(32).buffer } });
    vi.stubGlobal("Spicetify", { Platform: { UserAPI: { getUser: async () => ({ username: "private-spotify-name" }) } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 1 }) }));
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => { stopFirstSessionWatch(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("starts at the first empty-library open, once per account and device", () => {
    recordProductEvent(account, "tagify_opened", { saved_songs: "1-9" });
    expect(readFirstSession(account)).toBeNull();
    (window as any).__tagifyProductAnalyticsV1.openedDays.clear();
    recordProductEvent(account, "tagify_opened", { saved_songs: "0" });
    const started = readFirstSession(account)!;
    expect(started).toMatchObject({ tagged: false, rated: false, songs: [], ended: false });
    writeFirstSession(account, { ...started, ended: true });
    (window as any).__tagifyProductAnalyticsV1.openedDays.clear();
    recordProductEvent(account, "tagify_opened", { saved_songs: "0" });
    expect(readFirstSession(account)!.ended).toBe(true);
  });

  it("follows tagging, rating and the last first-run tip", () => {
    recordProductEvent(account, "tagify_opened", { saved_songs: "0" });
    recordProductEvent(account, "first_run_tip_shown", { tip: "play" });
    recordProductEvent(account, "first_run_tip_done", { tip: "play", how: "action" });
    recordProductEvent(account, "first_run_tip_shown", { tip: "rate" });
    recordProductEvent(account, "rating_completed", { edit_surface: "tagify_page" });
    expect(readFirstSession(account)).toMatchObject({ rated: true, tagged: false, lastTip: "rate" });
    expect(readFirstSession(account)!.lastTipHow).toBeUndefined();
    recordProductEvent(account, "tagging_completed", { edit_surface: "tagify_page", songs: "1" });
    expect(readFirstSession(account)!.tagged).toBe(true);
  });

  it("counts only visible time with recent input, capped per heartbeat", () => {
    const start = 1_000_000;
    writeFirstSession(account, { startedAt: start, lastTickAt: start, lastActiveAt: start, activeMs: 0, tagged: false, rated: false, songs: [], ended: false });
    tickFirstSession(account, start + 30_000, true, start + 20_000);
    tickFirstSession(account, start + 60_000, false, start + 50_000);
    // A computer waking after an hour adds at most one heartbeat.
    tickFirstSession(account, start + 3_660_000, true, start + 3_660_000);
    expect(readFirstSession(account)!.activeMs).toBe(30_000 + 60_000);
  });

  it("buckets songs and minutes", () => {
    expect([0, 1, 3, 7, 12, 25].map(songsViewedBucket)).toEqual(["0", "1", "2-4", "5-9", "10-24", "25+"]);
    expect([0, 59_999, 60_000, 4 * 60_000, 9 * 60_000, 19 * 60_000, 39 * 60_000, 59 * 60_000, 61 * 60_000].map(minutesBucket))
      .toEqual(["0", "0", "1", "2-4", "5-9", "10-19", "20-39", "40-59", "60+"]);
  });

  it("ends after 30 minutes without activity and reports what the session reached", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    recordProductEvent(account, "tagify_opened", { saved_songs: "0" });
    await startFirstSessionWatch();
    noteFirstSessionSongViewed("spotify:track:a");
    noteFirstSessionSongViewed("spotify:track:b");
    noteFirstSessionSongViewed("spotify:track:a");
    recordProductEvent(account, "first_run_tip_shown", { tip: "tag" });
    recordProductEvent(account, "first_run_tip_done", { tip: "tag", how: "got_it" });
    for (let i = 0; i < 6; i++) { document.dispatchEvent(new Event("pointerdown")); vi.advanceTimersByTime(TICK_MS); }
    vi.advanceTimersByTime(40 * 60_000);
    expect(ended()).toHaveLength(1);
    // Three minutes of clicks, then up to five minutes of reading count as active.
    expect(ended()[0].properties).toMatchObject({ tagged: "no", rated: "no", songs_viewed: "2-4", last_tip: "tag", how: "got_it", minutes: "5-9", ended_by: "idle" });
    expect(readFirstSession(account)).toMatchObject({ ended: true, songs: [] });
    vi.advanceTimersByTime(60 * 60_000);
    expect(ended()).toHaveLength(1);
  });

  it("sends directly when Spotify closes", async () => {
    recordProductEvent(account, "tagify_opened", { saved_songs: "0" });
    await startFirstSessionWatch();
    recordProductEvent(account, "tagging_completed", { edit_surface: "keyboard", songs: "1" });
    window.dispatchEvent(new Event("pagehide"));
    expect(ended()[0].properties).toMatchObject({ tagged: "yes", last_tip: "none", ended_by: "closed" });
    expect(ended()[0].properties).not.toHaveProperty("how");
    const sent = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit).keepalive);
    expect(JSON.parse((sent![1] as RequestInit).body as string).batch.map((event: any) => event.event)).toContain("first_session_ended");
  });

  it("reports a session a quit cut off on the next start, dated to its last activity", async () => {
    const lastActiveAt = Date.now() - 3 * 3600_000;
    writeFirstSession(account, { startedAt: lastActiveAt - 600_000, lastTickAt: lastActiveAt, lastActiveAt, activeMs: 8 * 60_000, tagged: false, rated: false, songs: ["spotify:track:a"], ended: false });
    await startFirstSessionWatch();
    expect(ended()[0].properties).toMatchObject({ minutes: "5-9", songs_viewed: "1", ended_by: "next_open" });
    expect(Date.parse(ended()[0].timestamp)).toBe(lastActiveAt);
  });

  it("keeps a session that a reload interrupted only briefly", async () => {
    writeFirstSession(account, { startedAt: Date.now() - 60_000, lastTickAt: Date.now() - 10_000, lastActiveAt: Date.now() - 10_000, activeMs: 50_000, tagged: false, rated: false, songs: [], ended: false });
    await startFirstSessionWatch();
    expect(ended()).toHaveLength(0);
    expect(readFirstSession(account)!.ended).toBe(false);
  });

  it("sends nothing without a first session", async () => {
    await startFirstSessionWatch();
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(FIRST_SESSION_PREFIX + account)).toBeNull();
    expect(ended()).toHaveLength(0);
  });
});
