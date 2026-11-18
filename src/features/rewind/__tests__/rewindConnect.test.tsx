import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityOnboardingModal } from "@/features/community/CommunityOnboardingModal";
import { policyFixture, sharingStub, taxonomyFixture } from "@/features/community/__tests__/sharingFixtures";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { PENDING_PAIRING_STORAGE_KEY, syncPairingService, type ApprovedPairing } from "@/services/sync/SyncPairingService";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { REWIND_URL } from "../rewindPromptRules";
import { communityPairing } from "@/features/community/communityPairing";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

vi.mock("@/features/community/CommunityShareDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/community/CommunityShareDialog")>()),
  CommunitySharePanel: () => <div>Your tags: Not public yet</div>,
}));

const sharing = sharingStub(policyFixture({ reviewedAt: null }));
const configuration = {
  accountId: "account-b", libraryId: "library-b", deviceId: "device-b",
  apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "key", accessToken: "access", refreshToken: "refresh",
  expiresAt: Date.now() + 60_000,
};
const setup = (entry: "rewind" | "prompt") => render(<CommunityOnboardingModal entry={entry} sharing={sharing} tracks={{}} taxonomy={taxonomyFixture()} onClose={vi.fn()} />);
const connectEvents = () => vi.mocked(recordProductInteraction).mock.calls.filter(([event]) => event.startsWith("community_"));

function pendingApproval() {
  localStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify({
    apiBaseUrl: configuration.apiBaseUrl, deviceCode: "device-code", verifier: "verifier",
    userCode: "ABCD-EFGH", verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH",
    expiresAt: Date.now() + 60_000, interval: 60,
  }));
  const approval: ApprovedPairing = { configuration, relationship: "first-link", previousAccount: null };
  vi.spyOn(syncPairingService, "poll").mockResolvedValue({ status: "approved", approval });
  vi.spyOn(syncPairingService, "complete").mockImplementation(async (next) => {
    setDesktopSyncConfiguration(next.configuration);
    syncPairingService.cancelPending();
    return { configuration: next.configuration, requiresReload: false };
  });
}

let opened: ReturnType<typeof vi.fn>;
beforeEach(() => {
  communityPairing.reset();
  syncPairingService.cancelPending();
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(recordProductInteraction).mockClear();
  opened = vi.fn().mockReturnValue(null);
  vi.stubGlobal("open", opened);
  window.TagifySync = {
    getStatus: () => "unlinked", getInitialMergePreview: () => null, getBackupHealth: () => null,
    activateCurrentAccount: vi.fn().mockResolvedValue(undefined),
  } as unknown as NonNullable<typeof window.TagifySync>;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    profile: { id: "account-b", handle: "alex-b", displayName: "Alex B" },
  }), { status: 200, headers: { "content-type": "application/json" } }));
});
afterEach(() => {
  delete window.TagifySync;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  syncPairingService.cancelPending();
});

describe("connecting to Community from the Rewind prompt", () => {
  it("says what connecting is for and what happens to the library", () => {
    pendingApproval();
    setup("rewind");
    expect(screen.getByRole("heading", { name: "See your Rewind 2026 on Community" })).toBeInTheDocument();
    expect(screen.getByText(/Your tags stay private unless you choose to publish them/)).toBeInTheDocument();
    expect(connectEvents()).toEqual([["community_setup_opened", { entry: "rewind" }]]);
  });

  it("lands the person on their Rewind once the connection is saved, and counts it as coming from Rewind", async () => {
    pendingApproval();
    setup("rewind");
    act(() => { void communityPairing.check(); });
    expect(await screen.findByText("Your tags: Not public yet")).toBeInTheDocument();

    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(REWIND_URL, "_blank", "noopener,noreferrer");
    expect(connectEvents()).toEqual([
      ["community_setup_opened", { entry: "rewind" }],
      ["community_connect_completed", { entry: "rewind", relationship: "first_link" }],
    ]);

    // The way back to it stays in setup.
    fireEvent.click(screen.getByRole("button", { name: "See your Rewind 2026" }));
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("leaves every other way of connecting as it was", async () => {
    pendingApproval();
    setup("prompt");
    expect(screen.queryByRole("heading", { name: "See your Rewind 2026 on Community" })).toBeNull();
    act(() => { void communityPairing.check(); });
    expect(await screen.findByText("Your tags: Not public yet")).toBeInTheDocument();
    expect(opened).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "See your Rewind 2026" })).toBeNull();
  });
});
