import { beforeEach, describe, expect, it, vi } from "vitest";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { IN_APP_SIGN_UP_SWITCH_KEY } from "../inAppSignUp";
import { openCommunityUrlSignedIn } from "../communityWebsiteLink";

vi.mock("@/services/sync/SyncRuntime", () => ({ syncRuntime: { communityRequest: vi.fn() } }));

describe("openCommunityUrlSignedIn", () => {
  const open = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    open.mockReset();
    vi.stubGlobal("open", open);
    localStorage.setItem(IN_APP_SIGN_UP_SWITCH_KEY, "on");
    setDesktopSyncConfiguration({
      accountId: "account-a", libraryId: "library-a", deviceId: "device-a",
      apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key",
      accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    });
  });

  it("opens the member's page through a one-time sign-in link", async () => {
    const request = vi.fn().mockResolvedValue({ url: "https://example.supabase.co/auth/v1/verify?token=one-time" });
    await openCommunityUrlSignedIn("https://tagify.fm/library/rewind?from=desktop_prompt", request);
    expect(request).toHaveBeenCalledWith("/api/v2/device/website-link", { method: "POST", body: { next: "/library/rewind?from=desktop_prompt" } });
    expect(open).toHaveBeenCalledWith("https://example.supabase.co/auth/v1/verify?token=one-time", "_blank", "noopener,noreferrer");
  });

  it("opens the plain page when Community can't give a link", async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error("Open tagify.fm and sign in there."), { status: 404 }));
    await openCommunityUrlSignedIn("https://tagify.fm/@alex", request);
    expect(open).toHaveBeenCalledWith("https://tagify.fm/@alex", "_blank", "noopener,noreferrer");
  });

  it("doesn't ask with the switch off, when not connected, or for another site", async () => {
    const request = vi.fn();
    localStorage.setItem(IN_APP_SIGN_UP_SWITCH_KEY, "off");
    await openCommunityUrlSignedIn("https://tagify.fm/@alex", request);
    localStorage.setItem(IN_APP_SIGN_UP_SWITCH_KEY, "on");
    await openCommunityUrlSignedIn("https://example.com/", request);
    localStorage.removeItem("tagify:sync:configuration");
    await openCommunityUrlSignedIn("https://tagify.fm/feed", request);
    expect(request).not.toHaveBeenCalled();
    expect(open.mock.calls.map(([url]) => url)).toEqual(["https://tagify.fm/@alex", "https://example.com/", "https://tagify.fm/feed"]);
  });
});
