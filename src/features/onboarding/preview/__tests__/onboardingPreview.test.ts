import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  assertNotInOnboardingPreview,
  exitOnboardingPreview,
  installOnboardingPreviewSandbox,
  isOnboardingPreviewActive,
  ONBOARDING_PREVIEW_FLAG_KEY,
  onboardingPreviewDatabaseName,
  previewResponseFor,
  startOnboardingPreview,
} from "../onboardingPreview";
import { canUseOnboardingPreview } from "../onboardingPreviewAccess";
import { getTagifyDatabaseName, hasCommunityLibraryOnThisComputer } from "@/services/sync/SyncLocalState";
import { spotifyWrite } from "@/services/SpotifyRequests";

const proto = Storage.prototype;
const original = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
const rawGet = (key: string) => {
  const installed = (globalThis as Record<symbol, { original: { getItem: (k: string) => string | null } } | undefined>)[INSTALLED];
  return installed ? installed.original.getItem.call(localStorage, key) : localStorage.getItem(key);
};
const originalFetch = globalThis.fetch;
const INSTALLED = Symbol.for("tagify.onboardingPreview.installed");

function uninstall() {
  const installed = (globalThis as Record<symbol, { original: object; target: object } | undefined>)[INSTALLED];
  if (installed) Object.assign(installed.target, installed.original);
  Object.assign(proto, original);
  globalThis.fetch = originalFetch;
  delete (globalThis as Record<symbol, unknown>)[INSTALLED];
}

/** What a real page load does: the flag is read, then the sandbox goes in before anything else. */
function loadPage() {
  uninstall();
  installOnboardingPreviewSandbox();
}

beforeEach(() => { uninstall(); localStorage.clear(); });
afterEach(() => { uninstall(); localStorage.clear(); });

describe("onboarding preview sandbox", () => {
  it("does nothing until a preview is started", () => {
    localStorage.setItem("tagify:first-run:v2", "done");
    loadPage();
    expect(isOnboardingPreviewActive()).toBe(false);
    expect(localStorage.getItem("tagify:first-run:v2")).toBe("done");
    expect(getTagifyDatabaseName()).toBe("tagify-db");
  });

  it("shows a brand-new user's storage and leaves the real values exactly as they were", () => {
    localStorage.setItem("tagify:first-run:v2", "done");
    localStorage.setItem("tagify:sync:account-id", "real-account");
    localStorage.setItem("tagify:sync:configuration", "{\"accountId\":\"real-account\"}");
    localStorage.setItem("spotify-own-key", "kept");
    const reload = vi.fn();
    startOnboardingPreview(reload);
    expect(reload).toHaveBeenCalledOnce();
    loadPage();

    expect(isOnboardingPreviewActive()).toBe(true);
    expect(localStorage.getItem("tagify:first-run:v2")).toBeNull();
    expect(localStorage.getItem("tagify:sync:configuration")).toBeNull();
    // Spotify's own keys are never redirected.
    expect(localStorage.getItem("spotify-own-key")).toBe("kept");

    localStorage.setItem("tagify:first-run:v2", "started");
    localStorage.removeItem("tagify:sync:account-id");
    expect(localStorage.getItem("tagify:first-run:v2")).toBe("started");

    exitOnboardingPreview(reload);
    loadPage();
    expect(isOnboardingPreviewActive()).toBe(false);
    expect(localStorage.getItem("tagify:first-run:v2")).toBe("done");
    expect(localStorage.getItem("tagify:sync:account-id")).toBe("real-account");
    expect(localStorage.getItem("tagify:sync:configuration")).toBe("{\"accountId\":\"real-account\"}");
  });

  it("starts each preview from scratch, also after Start over", () => {
    startOnboardingPreview(() => {});
    loadPage();
    localStorage.setItem("tagify:first-run:v2", "started");
    startOnboardingPreview(() => {});
    loadPage();
    expect(localStorage.getItem("tagify:first-run:v2")).toBeNull();
    expect(rawGet(ONBOARDING_PREVIEW_FLAG_KEY)).toBe("on");
  });

  it("runs normally when the flag is set but the sandbox didn't install on this page", () => {
    startOnboardingPreview(() => {});
    uninstall();
    expect(isOnboardingPreviewActive()).toBe(false);
    expect(getTagifyDatabaseName()).toBe("tagify-db");
    expect(() => assertNotInOnboardingPreview("A change to Spotify")).not.toThrow();
  });

  it("opens separate databases and never reports the real Community library", async () => {
    startOnboardingPreview(() => {});
    loadPage();
    expect(getTagifyDatabaseName()).toBe("tagify-onboarding-preview-db:tagify-db");
    expect(onboardingPreviewDatabaseName("tagify-tagged-by-others")).toBe("tagify-onboarding-preview-db:tagify-tagged-by-others");
    await expect(hasCommunityLibraryOnThisComputer()).resolves.toBe(false);
  });

  it("refuses Spotify writes and Community pairing during the preview", async () => {
    startOnboardingPreview(() => {});
    loadPage();
    const run = vi.fn();
    await expect(spotifyWrite(run)).rejects.toThrow("isn't saved in the onboarding preview");
    expect(run).not.toHaveBeenCalled();
    expect(() => assertNotInOnboardingPreview("Connecting to Community")).toThrow();
  });
});

describe("onboarding preview requests", () => {
  it("drops product analytics", async () => {
    const response = await previewResponseFor("https://us.i.posthog.com/batch/", { method: "POST", body: "{}" });
    expect(response?.status).toBe(200);
  });

  it("answers Community's prompt history as a new account that has seen only what the preview showed", async () => {
    const response = await previewResponseFor("https://community.tagify.fm/api/v1/tagify-usage", {
      method: "POST",
      body: JSON.stringify({ accountDigest: "x", promptHistory: { discoverySurveyDismissed: true } }),
    });
    await expect(response?.json()).resolves.toMatchObject({
      promptHistory: { mobileTaggingIntroSeen: false, discoverySurveyDismissed: true },
    });
  });

  it("lets Community reads and Spotify through, and refuses other Community writes", async () => {
    expect(await previewResponseFor("https://community.tagify.fm/api/v1/entities/track/abc")).toBeNull();
    expect(await previewResponseFor("https://api.spotify.com/v1/me/tracks", { method: "PUT" })).toBeNull();
    expect((await previewResponseFor("https://community.tagify.fm/api/v2/sync/push", { method: "POST" }))?.status).toBe(503);
    expect((await previewResponseFor("https://abc.supabase.co/rest/v1/rpc/x", { method: "POST" }))?.status).toBe(503);
  });

  it("routes the page's fetch through the preview answers", async () => {
    const real = vi.fn(async () => new Response("real"));
    globalThis.fetch = real as unknown as typeof fetch;
    startOnboardingPreview(() => {});
    installOnboardingPreviewSandbox();
    await fetch("https://us.i.posthog.com/batch/", { method: "POST" });
    expect(real).not.toHaveBeenCalled();
    await fetch("https://api.spotify.com/v1/me");
    expect(real).toHaveBeenCalledOnce();
  });
});

describe("who can start the preview", () => {
  it("is limited to the Tagify team's Spotify accounts", async () => {
    await expect(canUseOnboardingPreview(async () => "someone-else")).resolves.toBe(false);
    await expect(canUseOnboardingPreview(async () => null)).resolves.toBe(false);
    await expect(canUseOnboardingPreview(async () => "f4e49fd5b8f792647ef7054a3bbf85c88d9002875d6f7d65c77be364304565ec")).resolves.toBe(true);
  });
});

describe("bundle entries", () => {
  it("install the sandbox before anything else in every bundle", () => {
    const src = path.resolve(__dirname, "../../../..");
    const entries = readdirSync(path.join(src, "extensions"))
      .filter((name) => /\.(js|ts)$/.test(name) && name !== "productAnalyticsBridge.ts")
      .map((name) => path.join(src, "extensions", name));
    entries.push(path.join(src, "app.tsx"));
    for (const file of entries) {
      const firstImport = readFileSync(file, "utf8").split("\n").find((line) => line.startsWith("import"));
      expect(firstImport, path.relative(src, file)).toMatch(/import "(\.\.|@)\/features\/onboarding\/preview\/installSandbox";/);
    }
  });
});
