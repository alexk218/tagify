import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityOnboardingModal } from "../CommunityOnboardingModal";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import {
  setDesktopSyncConfiguration,
} from "@/services/sync/SyncLocalState";

describe("CommunityOnboardingModal actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    syncPairingService.cancelPending();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => { delete window.TagifySync; });

  it("keeps the compact first-run setup and automatic-onboarding dismissal choices", () => {
    render(<CommunityOnboardingModal onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Connect Tagify to Community" })).toBeInTheDocument();
    expect(screen.getByText("Back up your library and choose which tags appear on your public profile.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Don't ask again" }).className).toContain("quietAction");
    expect(screen.queryByRole("button", { name: "Get started" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Community setup progress" })).not.toBeInTheDocument();
    expect(screen.queryByText("Private sync first")).not.toBeInTheDocument();
    expect(screen.queryByText("Review before publishing")).not.toBeInTheDocument();
    expect(screen.queryByText("One account")).not.toBeInTheDocument();
  });

  it("uses only Cancel when setup was opened manually", () => {
    const onClose = vi.fn();
    render(
      <CommunityOnboardingModal
        onClose={onClose}
        launchContext="manual"
      />,
    );

    expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Don't ask again" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      sessionStorage.getItem("tagify:community:onboarding:snoozed-session"),
    ).toBeNull();
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

    render(<CommunityOnboardingModal onClose={vi.fn()} launchContext="manual" />);

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

    render(<CommunityOnboardingModal onClose={vi.fn()} launchContext="manual" />);
    fireEvent.click(screen.getByRole("button", { name: "Combine libraries" }));
    expect(screen.getByRole("heading", { name: "Combine your Tagify libraries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Combining libraries…" })).toBeDisabled();
    await act(async () => { finishCombine?.(); });
    expect(screen.getByText("Your Tagify libraries are combined.")).toBeInTheDocument();
  });

});
