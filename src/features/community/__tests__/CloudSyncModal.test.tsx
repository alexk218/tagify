import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import { CommunityOnboardingModal } from "../CommunityOnboardingModal";
import { CloudSyncModal } from "../CloudSyncModal";
import { policyFixture, sharingStub, taxonomyFixture, tracksFixture } from "./sharingFixtures";

const sharing = () => sharingStub(policyFixture());

const configuration = {
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
};

describe("CloudSyncModal revoked device recovery", () => {
  beforeEach(() => {
    localStorage.clear();
    setDesktopSyncConfiguration(configuration);
    vi.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => {
    delete window.TagifySync;
    syncPairingService.cancelPending();
    vi.restoreAllMocks();
  });

  it("enables Sync now by backup state alone and shows sharing in one line", async () => {
    let status = "publication-review-required";
    const emit = (next: string) => {
      status = next;
      window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status } }));
    };
    const syncNow = vi.fn(async () => { emit("syncing"); });
    window.TagifySync = {
      getStatus: () => status, getInitialMergePreview: () => null, getBackupHealth: () => null, syncNow,
    } as unknown as NonNullable<typeof window.TagifySync>;
    const onOpenSharing = vi.fn();
    const { rerender } = render(<CloudSyncModal sharing={sharingStub(policyFixture({ reviewedAt: null }))} onOpenSharing={onOpenSharing} onClose={vi.fn()} />);

    // A pending sharing choice no longer blocks backing up.
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("Your tags: Not public yet")).toBeInTheDocument();
    expect(screen.queryByText(/Public visibility/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
    act(() => emit("idle"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    act(() => emit("publishing"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    act(() => emit("error"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    expect(onOpenSharing).toHaveBeenCalledTimes(1);

    rerender(<CloudSyncModal sharing={sharingStub(policyFixture())} onOpenSharing={onOpenSharing} onClose={vi.fn()} />);
    expect(screen.getByText("Your tags: Public")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onOpenSharing).toHaveBeenCalledTimes(2);

    rerender(<CloudSyncModal sharing={sharingStub(null, { phase: "error" })} onOpenSharing={onOpenSharing} onClose={vi.fn()} />);
    expect(screen.getByText("Your tags: Couldn't check")).toBeInTheDocument();
  });

  it("asks for the sharing choice right after connecting, then finishes setup", async () => {
    window.TagifySync = {
      getStatus: () => "publication-review-required", getInitialMergePreview: () => null, getBackupHealth: () => null,
    } as unknown as NonNullable<typeof window.TagifySync>;
    const props = { tracks: tracksFixture(), taxonomy: taxonomyFixture(), onClose: vi.fn() };
    const { rerender } = render(<CommunityOnboardingModal entry="community" sharing={sharingStub(null)} {...props} />);
    expect(screen.getByText("Checking what's public…")).toBeInTheDocument();

    rerender(<CommunityOnboardingModal entry="community" sharing={sharingStub(policyFixture({ reviewedAt: null }))} {...props} />);
    expect(screen.getByText((_, node) => node?.textContent === "3 tags on 3 songs would appear on your profile.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish my tags" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Choose what to share first" })).not.toBeInTheDocument();

    rerender(<CommunityOnboardingModal entry="community" sharing={sharingStub(policyFixture())} {...props} />);
    expect(await screen.findByText("Your Community setup is ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View my profile" })).toBeInTheDocument();
  });

  it("finishes setup without publishing for a member who keeps tags private", async () => {
    window.TagifySync = {
      getStatus: () => "idle", getInitialMergePreview: () => null, getBackupHealth: () => null,
    } as unknown as NonNullable<typeof window.TagifySync>;
    render(<CommunityOnboardingModal entry="community" sharing={sharingStub(policyFixture({ enabled: false }))} tracks={tracksFixture()} taxonomy={taxonomyFixture()} onClose={vi.fn()} />);
    expect(await screen.findByText(/your tags stay private. You can publish them any time from Community in Tagify./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View my profile" })).not.toBeInTheDocument();
  });

  it("reconnects a revoked device without discarding its local library", async () => {
    const unlinkLocal = vi.fn().mockResolvedValue(undefined);
    window.TagifySync = {
      getStatus: () => "reauthorize",
      getInitialMergePreview: () => null,
      getBackupHealth: () => null,
      unlinkLocal,
    } as unknown as NonNullable<typeof window.TagifySync>;
    vi.spyOn(syncPairingService, "begin").mockResolvedValue({
      apiBaseUrl: "https://community.tagify.fm",
      deviceCode: "device-code",
      verifier: "verifier",
      userCode: "ABCD-EFGH",
      verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH",
      expiresAt: Date.now() + 60_000,
      interval: 5,
    });

    render(<CloudSyncModal sharing={sharing()} onOpenSharing={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("Device revoked")).toBeInTheDocument();
    expect(screen.getByText("Reconnect required")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect device" }));

    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(unlinkLocal).not.toHaveBeenCalled();
  });

  it("can disconnect an already-revoked device while keeping its local data", async () => {
    const unlinkLocal = vi.fn().mockResolvedValue(undefined);
    window.TagifySync = {
      getStatus: () => "reauthorize",
      getInitialMergePreview: () => null,
      getBackupHealth: () => null,
      unlinkLocal,
    } as unknown as NonNullable<typeof window.TagifySync>;

    render(<CloudSyncModal sharing={sharing()} onOpenSharing={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep data on this device only" }));

    await waitFor(() => expect(unlinkLocal).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Link Community account" })).toBeInTheDocument();
  });

  it("does not claim Smart Playlists are protected before app state reaches Community", () => {
    window.TagifySync = {
      getStatus: () => "idle",
      getInitialMergePreview: () => null,
      getBackupHealth: () => ({
        lastBackupAt: null,
        annotations: 972,
        taxonomyNodes: 64,
        appStateDocuments: 0,
        protectedDomains: ["smart-playlists"],
      }),
    } as unknown as NonNullable<typeof window.TagifySync>;

    render(<CloudSyncModal sharing={sharing()} onOpenSharing={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText(/972 tagged items/)).toBeInTheDocument();
    expect(screen.getByText(/Smart Playlists pending/)).toBeInTheDocument();
    expect(screen.queryByText(/Smart Playlists protected/)).not.toBeInTheDocument();
  });

  it("asks which saved settings to keep and explains what is not backed up yet", async () => {
    const resolveSettingsChoice = vi.fn().mockResolvedValue(undefined);
    let needsChoice = ["smart-playlists"];
    window.TagifySync = {
      getStatus: () => "idle",
      getInitialMergePreview: () => null,
      getBackupHealth: () => ({
        lastBackupAt: null, annotations: 12, taxonomyNodes: 4, appStateDocuments: 3, protectedDomains: ["smart-playlists"],
        notBackedUp: ["preferences"], needsChoice, retrying: ["local-files"], deviceOnlyChanges: 2,
      }),
      resolveSettingsChoice: async (...args: unknown[]) => { await resolveSettingsChoice(...args); needsChoice = []; },
    } as unknown as NonNullable<typeof window.TagifySync>;

    render(<CloudSyncModal sharing={sharing()} onOpenSharing={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("Choose which saved settings to keep")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Your saved settings changed on another device too" })).toHaveTextContent("Smart Playlists");
    expect(screen.getByText(/Preferences is too large to back up to Community/)).toBeInTheDocument();
    expect(screen.getByText(/Local files haven't backed up yet/)).toBeInTheDocument();
    expect(screen.getByText(/2 items have values Community can't save/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep this device's" }));
    await waitFor(() => expect(resolveSettingsChoice).toHaveBeenCalledWith("smart-playlists", "device"));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Your saved settings changed on another device too" })).not.toBeInTheDocument());
    expect(screen.queryByText("Choose which saved settings to keep")).not.toBeInTheDocument();
  });

  it("keeps library choices and shows a failed combine instead of silently restarting review", async () => {
    let status = "merge-required";
    const review = {
      version: 1,
      supported: true,
      communityHeadCursor: 12,
      communityChecksum: null,
      device: { annotations: 4341, taxonomy: 893, smartPlaylists: 29, savedSettings: 8 },
      community: { annotations: 250, taxonomy: 880, smartPlaylists: 0, savedSettings: 0 },
      additionsFromDevice: 4091,
      additionsFromCommunity: 0,
      unchanged: 200,
      conflicts: [{
        id: "annotation:spotify:track:same:field:rating",
        kind: "annotation-field",
        subjectId: "spotify:track:same",
        field: "rating",
        deviceValue: 4,
        communityValue: 5,
      }],
      labels: { "annotation:spotify:track:same:field:rating": "Test song" },
    };
    let failCombine: ((reason: Error) => void) | undefined;
    const commitInitialMerge = vi.fn(() => {
      status = "syncing";
      window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status } }));
      return new Promise<never>((_resolve, reject) => { failCombine = reject; });
    });
    window.TagifySync = {
      getStatus: () => status,
      getInitialMergePreview: () => review,
      getBackupHealth: () => null,
      commitInitialMerge,
      downloadInitialMergeBackup: vi.fn(),
    } as unknown as NonNullable<typeof window.TagifySync>;

    render(<CloudSyncModal sharing={sharing()} onOpenSharing={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Use this device for differences" }));
    fireEvent.click(screen.getByRole("button", { name: "Combine libraries" }));
    expect(screen.getByRole("button", { name: "Combining libraries…" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Use this device for differences" })).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      status = "merge-required";
      window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status } }));
      failCombine?.(new Error("sync_error: database timed out"));
    });
    expect(screen.getByRole("radio", { name: "Use this device for differences" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't combine your libraries yet");
    expect(screen.getByRole("button", { name: "Combine libraries" })).toBeEnabled();
  });
});
