import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installOnboardingPreviewSandbox,
  ONBOARDING_PREVIEW_FLAG_KEY,
  ONBOARDING_PREVIEW_STORAGE_PREFIX,
} from "@/features/onboarding/preview/onboardingPreview";
import { isInAppSignUpEnabled } from "@/features/community/inAppSignUp";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getDesktopSyncConfiguration, getTagifyDatabaseName } from "../SyncLocalState";
import { PENDING_PAIRING_STORAGE_KEY, syncPairingService } from "../SyncPairingService";

const INSTALLED = Symbol.for("tagify.onboardingPreview.installed");
const proto = Storage.prototype;
const original = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
const originalFetch = globalThis.fetch;
type Installed = { original: { getItem: (key: string) => string | null }; target: object };
/** Reads what the real Tagify would see, past the preview's redirection. */
const rawGet = (key: string) => {
  const installed = (globalThis as Record<symbol, Installed | undefined>)[INSTALLED];
  return installed ? installed.original.getItem.call(localStorage, key) : localStorage.getItem(key);
};

function uninstall() {
  const installed = (globalThis as Record<symbol, Installed | undefined>)[INSTALLED];
  if (installed) Object.assign(installed.target, installed.original);
  Object.assign(proto, original);
  globalThis.fetch = originalFetch;
  delete (globalThis as Record<symbol, unknown>)[INSTALLED];
}

/** Signing up inside the onboarding preview reaches Community but leaves the real Tagify as it was. */
describe("Community sign-up in the onboarding preview", () => {
  beforeEach(async () => {
    uninstall();
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.clear();
    localStorage.setItem("tagify:switch:in-app-sign-up", "off");
    localStorage.setItem(ONBOARDING_PREVIEW_FLAG_KEY, "fresh");
    installOnboardingPreviewSandbox();
    expect(await indexedDBStorage.init()).toBe(true);
  });

  afterEach(() => {
    syncPairingService.cancelPending();
    indexedDBStorage.resetConnection();
    uninstall();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows sign-up inside Tagify even where the real settings turned it off", () => {
    expect(isInAppSignUpEnabled()).toBe(true);
  });

  it("keeps the new account's connection and library in the preview only", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/api/v2/device-authorizations")) {
        return Response.json({
          deviceCode: "device-code", userCode: "ABCD-EFGH",
          verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH",
          expiresIn: 600, interval: 5,
        });
      }
      const payload = btoa(JSON.stringify({ sub: "preview-account", iss: "https://example.supabase.co/auth/v1" })).replace(/=+$/, "");
      return Response.json({
        accessToken: `header.${payload}.signature`, refreshToken: "refresh", libraryId: "library-p",
        deviceId: "device-p", supabasePublishableKey: "key", expiresAt: Date.now() + 60_000,
      });
    });

    await syncPairingService.begin("https://community.tagify.fm", "Tagify", "macos");
    expect(localStorage.getItem(PENDING_PAIRING_STORAGE_KEY)).not.toBeNull();
    const approval = await syncPairingService.poll();
    if (approval.status !== "approved") throw new Error("Pairing was not approved");
    await syncPairingService.complete(approval.approval);

    expect(getDesktopSyncConfiguration()?.accountId).toBe("preview-account");
    // The real settings never see the preview account.
    expect(rawGet("tagify:sync:configuration")).toBeNull();
    expect(rawGet("tagify:sync:account-id")).toBeNull();
    expect(rawGet(`${ONBOARDING_PREVIEW_STORAGE_PREFIX}tagify:sync:configuration`)).not.toBeNull();
    // Its library stays the preview's own database: nothing named after the account appears.
    expect(getTagifyDatabaseName()).toBe("tagify-onboarding-preview-db:tagify-db");
    const names = (await indexedDB.databases()).map((database) => database.name);
    expect(names.some((name) => name?.startsWith("tagify-db:"))).toBe(false);
  });
});
