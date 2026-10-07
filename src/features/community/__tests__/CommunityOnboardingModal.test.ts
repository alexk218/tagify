import { beforeEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_ONBOARDING_STORAGE_KEY,
  declineCommunityOnboarding,
  markCommunityOnboardingDone,
  needsCommunityOnboardingSetup,
  shouldShowCommunityOnboarding,
  snoozeCommunityOnboarding,
} from "../CommunityOnboardingModal";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";

describe("CommunityOnboardingModal visibility", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("shows for an unpaired user even if an old Not now dismissal stored the legacy done value", () => {
    localStorage.setItem(COMMUNITY_ONBOARDING_STORAGE_KEY, "done");

    expect(shouldShowCommunityOnboarding()).toBe(true);
  });

  it("hides only for the current session after Not now", () => {
    snoozeCommunityOnboarding();

    expect(shouldShowCommunityOnboarding()).toBe(false);
    expect(needsCommunityOnboardingSetup()).toBe(true);

    sessionStorage.clear();
    expect(shouldShowCommunityOnboarding()).toBe(true);
  });

  it("stays hidden after explicit decline or completed setup", () => {
    declineCommunityOnboarding();
    expect(shouldShowCommunityOnboarding()).toBe(false);
    expect(needsCommunityOnboardingSetup()).toBe(true);

    localStorage.clear();
    markCommunityOnboardingDone();
    expect(shouldShowCommunityOnboarding()).toBe(false);
    expect(needsCommunityOnboardingSetup()).toBe(true);
  });

  it("does not show when desktop sync is already configured", () => {
    setDesktopSyncConfiguration({
      accountId: "account-1",
      libraryId: "library-1",
      deviceId: "device-1",
      apiBaseUrl: "https://community.tagify.fm",
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "key",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
    });

    expect(shouldShowCommunityOnboarding()).toBe(false);
    expect(needsCommunityOnboardingSetup()).toBe(false);
  });
});
