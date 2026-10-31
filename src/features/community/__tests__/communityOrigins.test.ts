import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMUNITY_ORIGIN, COMMUNITY_PAGES_ORIGIN } from "../communityLinks";
import { getDeviceLinkSecret } from "@/services/sync/SyncDeviceLinkIdentity";
import { restoreDesktopSyncConfiguration } from "@/services/sync/SyncInstallRecovery";

/*
 * Community's pages moved to tagify.fm on 2026-10-21, but installed apps store community.tagify.fm
 * as their sync address and key device proofs by it. Changing any of these API addresses would
 * break reconnects for every installed app, so they must never follow the pages.
 */
const API_ORIGIN = "https://community.tagify.fm";
const installerSecret = `tgfy_install_${"a".repeat(43)}`;
const accessToken = `header.${btoa(JSON.stringify({ sub: "account-a" })).replace(/=+$/, "")}.signature`;

describe("Community addresses", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.__tagifyInstallRecoveryRejected;
    delete window.__tagifyInstallRecoveryPromise;
    delete window.__tagifyRecoveryEnrollments;
    window.__tagifyInstallRecoveryKey = installerSecret;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(() => {
    localStorage.clear();
    delete window.__tagifyInstallRecoveryKey;
    vi.restoreAllMocks();
  });

  it("opens pages on tagify.fm and keeps API requests on community.tagify.fm", () => {
    expect(COMMUNITY_PAGES_ORIGIN).toBe("https://tagify.fm");
    expect(COMMUNITY_ORIGIN).toBe(API_ORIGIN);
  });

  it("keys the installer's linking proof to community.tagify.fm only", () => {
    expect(getDeviceLinkSecret(API_ORIGIN)).toBe(installerSecret);
    expect(getDeviceLinkSecret(COMMUNITY_PAGES_ORIGIN)).not.toBe(installerSecret);
  });

  it("recovers a connection through community.tagify.fm and keeps syncing there", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        status: "recovered", accountId: "account-a", libraryId: "library-a", deviceId: "device-a",
        supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "publishable-key",
        accessToken, refreshToken: "refresh-token", expiresAt: 1_800_000_000,
      }))
      .mockResolvedValueOnce(Response.json({ enrolled: true, methods: { installation: true, spotify: true } }));

    const recovered = await restoreDesktopSyncConfiguration();

    expect(fetch).toHaveBeenCalledWith(`${API_ORIGIN}/api/v2/device-recovery/token`, expect.objectContaining({ method: "POST" }));
    expect(recovered?.apiBaseUrl).toBe(API_ORIGIN);
  });
});
