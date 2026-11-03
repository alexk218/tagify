import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECONNECTION_EVENT, type ReconnectionState } from "@/services/sync/SyncInstallRecovery";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import { CloudSyncModal } from "../CloudSyncModal";
import { policyFixture, sharingStub } from "./sharingFixtures";

const approvalUrl = "https://tagify.fm/settings/devices/reconnect?code=BCDF-GHJK";

function show(state: ReconnectionState | null) {
  if (state) window.__tagifyReconnection = { state };
  else delete window.__tagifyReconnection;
  window.dispatchEvent(new CustomEvent(RECONNECTION_EVENT, { detail: state }));
}

function renderCloudSync() {
  window.TagifySync = {
    getStatus: () => "unlinked", getInitialMergePreview: () => null, getBackupHealth: () => null,
  } as unknown as NonNullable<typeof window.TagifySync>;
  return render(<CloudSyncModal sharing={sharingStub(policyFixture())} onOpenSharing={vi.fn()} onClose={vi.fn()} />);
}

describe("Cloud Sync while a reconnection waits for approval on Community", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    delete window.__tagifyReconnection;
    delete window.TagifySync;
    syncPairingService.cancelPending();
    vi.restoreAllMocks();
  });

  it("shows the code to check and opens the approval page", () => {
    show({ status: "waiting", userCode: "BCDF-GHJK", approvalUrl, expiresAt: Date.now() + 600_000 });
    renderCloudSync();

    expect(screen.getByText("Approve reconnecting this computer")).toBeInTheDocument();
    expect(screen.getByText("BCDF-GHJK")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Link Community account/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open approval page" }));
    expect(window.open).toHaveBeenCalledWith(approvalUrl, "_blank", "noopener,noreferrer");
  });

  it.each([
    [{ status: "declined" } as const, "Reconnecting wasn't approved", true],
    [{ status: "expired" } as const, "The request expired", true],
    [{ status: "rate-limited", retryAt: Date.now() + 3_600_000 } as const, "Too many requests for now", false],
    [{ status: "unavailable" } as const, "Couldn't reconnect automatically", false],
  ])("explains how a request ended and what to do next (%o)", (state, title, canAskAgain) => {
    show(state);
    renderCloudSync();

    expect(screen.getByRole("status")).toHaveTextContent(title);
    expect(screen.queryAllByRole("button", { name: "Ask again" })).toHaveLength(canAskAgain ? 1 : 0);
    expect(screen.getByRole("button", { name: "Link with a new code" })).toBeEnabled();
  });

  it("follows the request as it changes, and shows the connection once approved", () => {
    show({ status: "waiting", userCode: "BCDF-GHJK", approvalUrl, expiresAt: Date.now() + 600_000 });
    renderCloudSync();

    act(() => {
      setDesktopSyncConfiguration({
        accountId: "account-a", libraryId: "library-a", deviceId: "device-a", apiBaseUrl: "https://community.tagify.fm",
        supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key", accessToken: "access", refreshToken: "refresh",
        expiresAt: Date.now() + 60_000, profile: { id: "p", handle: "alex", displayName: "Alex" },
      });
      show(null);
    });

    expect(screen.queryByText("BCDF-GHJK")).not.toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });
});
