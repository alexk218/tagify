import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityOnboardingModal } from "../CommunityOnboardingModal";
import { CloudSyncModal } from "../CloudSyncModal";
import { PENDING_PAIRING_STORAGE_KEY, syncPairingService, type ApprovedPairing, type PairingRelationship } from "@/services/sync/SyncPairingService";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";

vi.mock("../CommunityPublicVisibilityReview", () => ({
  CommunityVisibilityReview: () => <div>Review your public visibility</div>,
}));

const configuration = {
  accountId: "account-b", libraryId: "library-b", deviceId: "device-b",
  apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "key", accessToken: "access", refreshToken: "refresh",
  expiresAt: Date.now() + 60_000,
};

describe.each([
  ["Community setup", CommunityOnboardingModal],
  ["Cloud Sync", CloudSyncModal],
] as const)("%s browser approval", (_name, Modal) => {
  let activateCurrentAccount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    syncPairingService.cancelPending();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify({
      apiBaseUrl: configuration.apiBaseUrl, deviceCode: "device-code", verifier: "verifier",
      userCode: "ABCD-EFGH", verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH",
      expiresAt: Date.now() + 60_000, interval: 60,
    }));
    activateCurrentAccount = vi.fn().mockResolvedValue(undefined);
    window.TagifySync = {
      getStatus: () => "unlinked", getInitialMergePreview: () => null, getBackupHealth: () => null,
      activateCurrentAccount,
    } as unknown as NonNullable<typeof window.TagifySync>;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      profile: { id: "account-b", handle: "alex-b", displayName: "Alex B" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
  });

  afterEach(() => {
    delete window.TagifySync;
    vi.useRealTimers();
    vi.restoreAllMocks();
    syncPairingService.cancelPending();
  });

  function approve(relationship: PairingRelationship = "first-link") {
    const approval: ApprovedPairing = { configuration, relationship, previousAccount: null };
    vi.spyOn(syncPairingService, "poll").mockResolvedValue({ status: "approved", approval });
    return vi.spyOn(syncPairingService, "complete").mockImplementation(async (next) => {
      setDesktopSyncConfiguration(next.configuration);
      syncPairingService.cancelPending();
      return { configuration: next.configuration, requiresReload: relationship === "account-switch" };
    });
  }

  it.each(["first-link", "reconnect", "account-switch"] as const)("connects a %s automatically without another confirmation", async (relationship) => {
    const complete = approve(relationship);
    render(<Modal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "I've approved it" }));

    expect(await screen.findByText("Review your public visibility")).toBeInTheDocument();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      relationship,
      configuration: expect.objectContaining({ accountId: "account-b", profile: expect.objectContaining({ displayName: "Alex B" }) }),
    }), { confirmedAccountSwitch: relationship === "account-switch" });
    expect(screen.queryByRole("button", { name: /Connect this account|Switch account/ })).not.toBeInTheDocument();
    if (relationship === "account-switch") {
      expect(screen.getByText(/Reload Spotify to finish switching accounts/)).toBeInTheDocument();
      expect(activateCurrentAccount).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    } else {
      await waitFor(() => expect(activateCurrentAccount).toHaveBeenCalledTimes(1));
    }
  });

  it("keeps the approval available to retry when connecting fails", async () => {
    const complete = approve().mockRejectedValueOnce(new Error("Connection failed"));
    render(<Modal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "I've approved it" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Review your public visibility")).toBeInTheDocument();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(activateCurrentAccount).toHaveBeenCalledTimes(1);
  });

  it("finishes when automatic polling sees browser approval without a desktop click", async () => {
    vi.useFakeTimers();
    const complete = approve();
    render(<Modal onClose={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(62_000); });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(activateCurrentAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Review your public visibility")).toBeInTheDocument();
  });

  it("shows connection progress and prevents overlapping completion", async () => {
    const complete = approve();
    let finish: (() => void) | undefined;
    complete.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ configuration: { ...configuration, profile: { handle: "alex-b", displayName: "Alex B" } }, requiresReload: false });
    }));
    render(<Modal onClose={vi.fn()} />);
    const approved = screen.getByRole("button", { name: "I've approved it" });
    fireEvent.click(approved);
    fireEvent.click(approved);

    expect(await screen.findByRole("status")).toHaveTextContent("Connecting as Alex B…");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(complete).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.(); });
    expect(await screen.findByText("Review your public visibility")).toBeInTheDocument();
  });
});
