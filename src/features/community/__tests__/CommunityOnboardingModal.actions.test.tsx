import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityOnboardingModal } from "../CommunityOnboardingModal";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import {
  setDesktopSyncConfiguration,
} from "@/services/sync/SyncLocalState";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

describe("CommunityOnboardingModal actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    syncPairingService.cancelPending();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(recordProductInteraction).mockClear();
  });

  it("measures a started connection only after Community issues the approval code", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const begin = vi.spyOn(syncPairingService, "begin")
      .mockRejectedValueOnce(new Error("Community is unavailable"))
      .mockResolvedValueOnce({
        apiBaseUrl: "https://community.tagify.fm", deviceCode: "device-code", verifier: "verifier", userCode: "ABCD-EFGH",
        verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH", expiresAt: Date.now() + 60_000, interval: 60,
      });
    render(<CommunityOnboardingModal entry="prompt" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();

    expect(begin).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordProductInteraction).mock.calls).toEqual([
      ["community_setup_opened", { entry: "prompt" }],
      ["community_connect_failed", { entry: "prompt", stage: "start" }],
      ["community_connect_started", { entry: "prompt" }],
    ]);
    expect(JSON.parse(localStorage.getItem("tagify:community-connect-attempt:v1") || "null")).toEqual({ entry: "prompt" });
  });

  afterEach(() => { delete window.TagifySync; });

  it("lets users cancel setup without adding a reminder", () => {
    const onClose = vi.fn();
    render(<CommunityOnboardingModal entry="community" onClose={onClose} />);

    expect(screen.getByRole("heading", { name: "Connect Tagify to Community" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Don't ask again" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("tagify:community:onboarding:snoozed-session")).toBeNull();
    expect(localStorage.getItem("tagify:community:onboarding:v1")).toBeNull();
  });

  it("does not offer a redundant Finish later action after connecting", () => {
    setDesktopSyncConfiguration({
      accountId: "account-a",
      libraryId: "library-a",
      deviceId: "device-a",
      apiBaseUrl: "https://community.tagify.fm",
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "key",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
      profile: { handle: "alex", displayName: "Alex" },
    });

    render(<CommunityOnboardingModal entry="community" onClose={vi.fn()} />);

    expect(screen.getByText("Connected as Alex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish later" })).not.toBeInTheDocument();
  });

  it("keeps the library review visible while a combined backup is being saved", async () => {
    setDesktopSyncConfiguration({
      accountId: "account-a",
      libraryId: "library-a",
      deviceId: "device-a",
      apiBaseUrl: "https://community.tagify.fm",
      supabaseUrl: "https://example.supabase.co",
      supabasePublishableKey: "key",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
      profile: { handle: "alex", displayName: "Alex" },
    });
    let status = "merge-required";
    let finishCombine: (() => void) | undefined;
    const review = {
      version: 1,
      supported: true,
      communityHeadCursor: 5,
      communityChecksum: null,
      device: { annotations: 4341, taxonomy: 893, smartPlaylists: 29, savedSettings: 8 },
      community: { annotations: 250, taxonomy: 880, smartPlaylists: 0, savedSettings: 0 },
      additionsFromDevice: 4091,
      additionsFromCommunity: 0,
      unchanged: 200,
      conflicts: [],
      labels: {},
    };
    window.TagifySync = {
      getStatus: () => status,
      getInitialMergePreview: () => review,
      getBackupHealth: () => null,
      commitInitialMerge: () => {
        status = "syncing";
        window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status } }));
        return new Promise((resolve) => { finishCombine = () => resolve({ version: 1, headCursor: 6, additionsFromDevice: 4091, additionsFromCommunity: 0, conflictsResolved: 0 }); });
      },
      downloadInitialMergeBackup: vi.fn(),
    } as unknown as NonNullable<typeof window.TagifySync>;

    render(<CommunityOnboardingModal entry="community" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Combine libraries" }));
    expect(screen.getByRole("heading", { name: "Combine your Tagify libraries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Combining libraries…" })).toBeDisabled();
    await act(async () => { finishCombine?.(); });
    expect(screen.getByText("Your Tagify libraries are combined.")).toBeInTheDocument();
  });

});
