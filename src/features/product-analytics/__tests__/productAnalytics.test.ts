import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { recordProductEvent, setAnalyticsSharing, isAnalyticsSharing, flushProductEvents, canLinkInstallation } from "../productAnalytics";
const account = "0".repeat(64);
const key = "tagify:product-analytics:v1:" + account;
const installationId = "ad824ac0-c441-4f56-85a7-ff1434d865bc";
const queue = () => JSON.parse(localStorage.getItem(key) || "{}");

describe("automatic Tagify product analytics", () => {
  beforeEach(() => {
    const runtime = (window as any).__tagifyProductAnalyticsV1;
    for (const timer of runtime.timers.values()) clearTimeout(timer);
    for (const request of runtime.requests.values()) request.abort();
    runtime.blockedAccounts?.clear(); runtime.timers.clear(); runtime.requests.clear(); runtime.openedDays.clear(); runtime.pausedUntil = 0;
    delete (window as any).__tagifyInstallerAnalyticsV1;
    vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: { digest: async () => new Uint8Array(32).buffer } });
    vi.stubGlobal("Spicetify", { Platform: { UserAPI: { getUser: async () => ({ username: "private-spotify-name" }) } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 1 }) }));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function handoff(expiresAt = new Date(Date.now() + 3600000).toISOString()) {
    (window as any).__tagifyInstallerAnalyticsV1 = { schemaVersion: 2, enabled: true, installationId, expiresAt, token: "phc_test", host: "https://us.i.posthog.com" };
  }
  it("collects automatically for an unset choice without fabricating consent", async () => {
    recordProductEvent(account, "tagify_opened");
    expect(isAnalyticsSharing(account)).toBe(true);
    expect(queue().schemaVersion).toBe(2);
    expect(queue()).not.toHaveProperty("consentVersion");
    expect(await flushProductEvents(account)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ consentVersion: 1 }, { schemaVersion: 2 }])("ignores unpublished disabled client preferences (%j) without sending their queue", async (version) => {
    handoff();
    localStorage.setItem(key, JSON.stringify({ ...version, enabled: false, events: [{ event: "rating_completed", uuid: "prototype-event" }] }));
    recordProductEvent(account, "tagify_opened");
    expect(isAnalyticsSharing(account)).toBe(true);
    expect(queue()).toMatchObject({ schemaVersion: 2, enabled: true });
    expect(queue().events.map((event: any) => event.event)).toEqual(["tagify_opened"]);
    expect(queue().events[0].properties.installation_id).toBe(installationId);
    expect(await flushProductEvents(account)).toBe(true);
    expect(JSON.stringify(vi.mocked(fetch).mock.calls[0])).not.toContain("prototype-event");
  });
  it("does not reinterpret an older enabled record's linking scope", () => {
    handoff();
    localStorage.setItem(key, JSON.stringify({ consentVersion: 1, enabled: true, events: [] }));
    recordProductEvent(account, "tagging_completed");
    expect(queue().events[0].properties).not.toHaveProperty("installation_id");
  });
  it("uses a valid setup offer automatically only for an unset account", () => {
    handoff(); recordProductEvent(account, "tagging_completed");
    expect(queue().events[0].properties.installation_id).toBe(installationId);
  });
  it("accepts the live Ok acknowledgement without aliasing identities", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ status: "Ok" }) } as Response);
    localStorage.setItem(key, JSON.stringify({ consentVersion: 1, enabled: true, events: [] }));
    handoff(); setAnalyticsSharing(account, true);
    recordProductEvent(account, "tagging_completed");
    await flushProductEvents(account);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.batch[0].distinct_id).toBe("tagify-account-" + account);
    expect(body.batch[0].properties).toMatchObject({ $process_person_profile: false, $geoip_disable: true, $ip: null });
    expect(JSON.stringify(body)).not.toMatch(/private-spotify-name|installation_id|\$create_alias|\$identify/);
    expect(queue().events).toEqual([]);
  });
  it("preserves legacy linking scope and expires a link without affecting analytics", () => {
    vi.useFakeTimers(); handoff();
    localStorage.setItem(key, JSON.stringify({ consentVersion: 1, enabled: true, events: [] }));
    setAnalyticsSharing(account, true);
    recordProductEvent(account, "tagging_completed");
    expect(queue().events[0].properties).not.toHaveProperty("installation_id");
    setAnalyticsSharing(account, false); setAnalyticsSharing(account, true, true);
    recordProductEvent(account, "rating_completed");
    expect(queue().events[0].properties.installation_id).toBe(installationId);
    vi.setSystemTime(Date.now() + 2 * 3600000);
    expect(canLinkInstallation()).toBe(false);
    recordProductEvent(account, "tagging_completed");
    expect(queue().events[1].properties).not.toHaveProperty("installation_id");
    expect(isAnalyticsSharing(account)).toBe(true);
  });
  it("rejects absent, corrupt, expired and unbounded historical offers", () => {
    expect(canLinkInstallation()).toBe(false);
    (window as any).__tagifyInstallerAnalyticsV1 = "corrupt"; expect(canLinkInstallation()).toBe(false);
    handoff(new Date(Date.now() - 1).toISOString()); expect(canLinkInstallation()).toBe(false);
    handoff(new Date(Date.now() + 8 * 86400000).toISOString()); expect(canLinkInstallation()).toBe(false);
    setAnalyticsSharing(account, true, true); recordProductEvent(account, "rating_completed");
    expect(queue().events[0].properties).not.toHaveProperty("installation_id");
  });
  it("never transfers link permission to another account and requires fresh permission after opt-out", () => {
    handoff(); setAnalyticsSharing(account, true, true);
    const other = "1".repeat(64);
    localStorage.setItem("tagify:product-analytics:v1:" + other, JSON.stringify({ consentVersion: 1, enabled: true, events: [] }));
    setAnalyticsSharing(other, true); recordProductEvent(other, "rating_completed");
    expect(JSON.parse(localStorage.getItem("tagify:product-analytics:v1:" + other)!).events[0].properties).not.toHaveProperty("installation_id");
    setAnalyticsSharing(account, false);
    (window as any).__tagifyInstallerAnalyticsV1.installationId = "eccdcfce-4e1d-4abf-94b8-c77d03613f26";
    setAnalyticsSharing(account, true); recordProductEvent(account, "rating_completed");
    expect(queue().events[0].properties).not.toHaveProperty("installation_id");
    setAnalyticsSharing(account, false); setAnalyticsSharing(account, true, true); recordProductEvent(account, "rating_completed");
    expect(queue().events[0].properties.installation_id).toBe("eccdcfce-4e1d-4abf-94b8-c77d03613f26");
  });
  it("does not automatically link a legacy offer that promised another permission step", () => {
    handoff(); (window as any).__tagifyInstallerAnalyticsV1.schemaVersion = 1;
    recordProductEvent(account, "tagging_completed");
    expect(queue().events[0].properties).not.toHaveProperty("installation_id");
  });
  it("retries the same UUID and timestamp, preserving edits added in flight", async () => {
    setAnalyticsSharing(account, true); recordProductEvent(account, "tagging_completed");
    const original = queue().events[0];
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    expect(await flushProductEvents(account)).toBe(false);
    expect(queue().events[0]).toEqual(original);
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }) as Promise<Response>);
    const pending = flushProductEvents(account);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    recordProductEvent(account, "rating_completed");
    finish({ ok: true, json: async () => ({ status: 1 }) } as Response);
    expect(await pending).toBe(true);
    expect(queue().events.map((event: any) => event.event)).toEqual(["rating_completed"]);
  });
  it("revokes in-flight requests and clears PostHog and aggregate activity queues", async () => {
    setAnalyticsSharing(account, true); recordProductEvent(account, "tagging_completed");
    localStorage.setItem("tagify:usage:activity:" + account, "queued counters");
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }) as Promise<Response>);
    const pending = flushProductEvents(account);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(setAnalyticsSharing(account, false)).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(queue().events).toEqual([]);
    expect(localStorage.getItem("tagify:usage:activity:" + account)).toBeNull();
    finish({ ok: true, json: async () => ({ status: 1 }) } as Response);
    expect(await pending).toBe(false);
    recordProductEvent(account, "rating_completed");
    expect(queue().events).toEqual([]);
  });
  it("keeps accounts separate and refuses to send an old account's queue", async () => {
    setAnalyticsSharing(account, true); recordProductEvent(account, "tagging_completed");
    vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: { digest: async () => new Uint8Array(32).fill(1).buffer } });
    expect(await flushProductEvents(account)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(isAnalyticsSharing("invalid-account")).toBe(false);
    expect(queue().events).toHaveLength(1);
  });
  it("does not double-count repeated open checks, but records a new active day", () => {
    vi.useFakeTimers(); setAnalyticsSharing(account, true);
    recordProductEvent(account, "tagify_opened"); recordProductEvent(account, "tagify_opened");
    expect(queue().events).toHaveLength(1);
    vi.setSystemTime(Date.now() + 86400000); recordProductEvent(account, "tagify_opened");
    expect(queue().events).toHaveLength(2);
  });
  it("bounds offline queues and drops events older than seven days", () => {
    vi.useFakeTimers(); setAnalyticsSharing(account, true);
    for (let i = 0; i < 220; i++) recordProductEvent(account, "tagging_completed");
    expect(queue().events).toHaveLength(200);
    vi.setSystemTime(Date.now() + 8 * 86400000); recordProductEvent(account, "rating_completed");
    expect(queue().events).toHaveLength(1);
  });
  it("fails closed on corrupted storage and unsuccessful preference saves", () => {
    localStorage.setItem(key, "broken"); recordProductEvent(account, "tagging_completed");
    expect(isAnalyticsSharing(account)).toBe(false);
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error("disk full"); });
    expect(setAnalyticsSharing(account, true)).toBe(false);
    expect(isAnalyticsSharing(account)).toBe(false);
  });
  it("honors Retry-After and rejects quota-limited or malformed acknowledgements", async () => {
    setAnalyticsSharing(account, true); recordProductEvent(account, "tagging_completed");
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ status: 1, quota_limited: ["events"] }) } as Response);
    expect(await flushProductEvents(account)).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => "3600" } } as unknown as Response);
    expect(await flushProductEvents(account)).toBe(false);
    expect(await flushProductEvents(account)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(queue().events).toHaveLength(1);
  });
  it("sends the fixed update-banner details and nothing else", async () => {
    recordProductEvent(account, "update_download_clicked", { method: "release_page" });
    expect(queue().events[0].properties).toMatchObject({ method: "release_page" });
    expect(await flushProductEvents(account)).toBe(true);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(Object.keys(body.batch[0].properties).sort()).toEqual(["$geoip_disable", "$ip", "$process_person_profile", "app_version", "method"]);
  });
  it("sends the fixed connection details and nothing else", async () => {
    recordProductEvent(account, "tagify_opened", { sync_state: "not_connected" });
    recordProductEvent(account, "community_connect_completed", { entry: "prompt", relationship: "first_link" });
    expect(await flushProductEvents(account)).toBe(true);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    const details = body.batch.map(({ event, properties: { app_version: _version, $geoip_disable: _geo, $ip: _ip, $process_person_profile: _person, ...rest } }: any) => [event, rest]);
    expect(details).toEqual([
      ["tagify_opened", { sync_state: "not_connected" }],
      ["community_connect_completed", { entry: "prompt", relationship: "first_link" }],
    ]);
  });
  it.each([
    ["an unknown detail", "update_banner_shown", { update_kind: "minor", latest_version: "3.3.0" }],
    ["a sync state outside the fixed list", "tagify_opened", { sync_state: "paused" }],
    ["a connection detail on another event", "community_connect_started", { relationship: "reconnect" }],
    ["a value outside the fixed list", "update_banner_shown", { update_kind: "3.3.0" }],
    ["a detail that belongs to another event", "tagify_opened", { method: "direct" }],
  ])("drops an event with %s", (_label, event, details) => {
    recordProductEvent(account, event as any, details as any);
    expect(queue().events ?? []).toEqual([]);
  });
  it("discards stored events whose details were altered", () => {
    recordProductEvent(account, "update_banner_shown", { update_kind: "patch" });
    const stored = queue();
    stored.events[0].properties.update_kind = "https://example.com/private";
    localStorage.setItem(key, JSON.stringify(stored));
    recordProductEvent(account, "update_banner_dismissed");
    expect(queue().events.map((event: any) => event.event)).toEqual(["update_banner_dismissed"]);
  });
});
