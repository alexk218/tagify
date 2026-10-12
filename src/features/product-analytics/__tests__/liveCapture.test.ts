import { request } from "node:https";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { expect, it, vi } from "vitest";
import { flushProductEvents, recordProductEvent, setAnalyticsSharing } from "../productAnalytics";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";

// Explicit network QA only. Test events use a separate namespace and synthetic identity.
it.skipIf(process.env.TAGIFY_POSTHOG_LIVE_QA !== "1")("verifies automatic capture against the configured live project", async () => {
  const run = webcrypto.randomUUID();
  const bridgePath = process.env.TAGIFY_POSTHOG_QA_BRIDGE;
  if (bridgePath) {
    const js = readFileSync(bridgePath, "utf8");
    (window as any).__tagifyInstallerAnalyticsV1 = JSON.parse(js.slice(js.indexOf("=") + 1).trim().replace(/;$/, ""));
  }
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Spicetify", { Platform: { UserAPI: { getUser: async () => ({ username: `tagify-analytics-qa-${run}` }) } } });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    payload.batch = payload.batch.map((event: any) => ({ ...event, event: "tagify_analytics_qa", properties: { ...event.properties, qa_run: run, qa_event: event.event } }));
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const req = request(input, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, signal: init.signal ?? undefined }, response => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { data += chunk; });
        response.on("end", () => resolve({ ok: response.statusCode === 200, status: response.statusCode, headers: { get: (key: string) => response.headers[key] }, json: async () => JSON.parse(data) }));
      });
      req.on("error", reject); req.end(body);
    });
  }));
  const account = (await getUsageAccountDigest())!;
  try {
    recordProductEvent(account, "tagify_opened");
    expect(fetch).not.toHaveBeenCalled();
    recordProductEvent(account, "tracks_viewed");
    recordProductEvent(account, "tagging_completed");
    recordProductEvent(account, "rating_completed");
    if (bridgePath) {
      const pending = JSON.parse(localStorage.getItem(`tagify:product-analytics:v1:${account}`)!).events;
      expect(pending.every((event: any) => event.properties.installation_id === (window as any).__tagifyInstallerAnalyticsV1.installationId)).toBe(true);
    }
    expect(await flushProductEvents(account)).toBe(true);
    expect(JSON.parse(localStorage.getItem(`tagify:product-analytics:v1:${account}`)!).events).toEqual([]);
    console.log(`PostHog live QA run: ${run}`);
  } finally {
    setAnalyticsSharing(account, false);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    delete (window as any).__tagifyInstallerAnalyticsV1;
  }
});
