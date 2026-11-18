import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityOnboardingModal } from "../CommunityOnboardingModal";
import { communityPairing } from "../communityPairing";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import {
  setDesktopSyncConfiguration,
} from "@/services/sync/SyncLocalState";
import { sharingStub, taxonomyFixture, tracksFixture } from "./sharingFixtures";

const shared = () => ({ sharing: sharingStub(null, { phase: "idle" }), tracks: tracksFixture(), taxonomy: taxonomyFixture() });

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

describe("CommunityOnboardingModal actions", () => {
  beforeEach(() => {
    communityPairing.reset();
    vi.restoreAllMocks();
    syncPairingService.cancelPending();
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(recordProductInteraction).mockClear();
  });

  it("starts connecting as soon as setup opens, and measures a start only once Community issues the code", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const begin = vi.spyOn(syncPairingService, "begin")
      .mockRejectedValueOnce(new Error("Community is unavailable"))
      .mockResolvedValueOnce({
        apiBaseUrl: "https://community.tagify.fm", deviceCode: "device-code", verifier: "verifier", userCode: "ABCD-EFGH",
        verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH", expiresAt: Date.now() + 60_000, interval: 60,
      });
    render(<CommunityOnboardingModal entry="prompt" {...shared()} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
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

  it("lets users cancel setup without adding a reminder", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(syncPairingService, "begin").mockImplementation(async () => {
      const pending = {
        apiBaseUrl: "https://community.tagify.fm", deviceCode: "device-code", verifier: "verifier", userCode: "ABCD-EFGH",
        verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH", expiresAt: Date.now() + 600_000, interval: 10,
      };
      localStorage.setItem("tagify:sync:pending-pairing", JSON.stringify(pending));
      return pending;
    });
    const onClose = vi.fn();
    render(<CommunityOnboardingModal entry="community" {...shared()} onClose={onClose} />);
    await screen.findByText("ABCD-EFGH");

    expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Don't ask again" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Cancel, unlike closing, stops waiting for the code.
    expect(syncPairingService.getPending()).toBeNull();
    expect(sessionStorage.getItem("tagify:community:onboarding:snoozed-session")).toBeNull();
    expect(localStorage.getItem("tagify:community:onboarding:v1")).toBeNull();
  });

  it("keeps waiting for the browser approval after setup is closed", () => {
    localStorage.setItem("tagify:sync:pending-pairing", JSON.stringify({
      apiBaseUrl: "https://community.tagify.fm", deviceCode: "device-code", verifier: "verifier",
      userCode: "ABCD-EFGH", verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH",
      expiresAt: Date.now() + 600_000, interval: 10,
    }));
    const onClose = vi.fn();
    render(<CommunityOnboardingModal entry="community" {...shared()} onClose={onClose} />);
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close Community setup" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(syncPairingService.getPending()?.userCode).toBe("ABCD-EFGH");
    expect(communityPairing.getState().pending?.userCode).toBe("ABCD-EFGH");
  });

  it("waits on two numbered steps, the code and a way back to the page", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    localStorage.setItem("tagify:sync:pending-pairing", JSON.stringify({
      apiBaseUrl: "https://community.tagify.fm", deviceCode: "device-code", verifier: "verifier",
      userCode: "ABCD-EFGH", verificationUri: "https://community.tagify.fm/device?code=ABCD-EFGH",
      expiresAt: Date.now() + 600_000, interval: 10,
    }));
    render(<CommunityOnboardingModal entry="community" {...shared()} onClose={vi.fn()} />);
    expect(screen.getByText("Sign in or create your free Community account")).toBeInTheDocument();
    expect(screen.getByText("Press Connect on the page that opened")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for you to approve…");
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open the page again/ }));
    expect(window.open).toHaveBeenCalledWith("https://community.tagify.fm/device?code=ABCD-EFGH", "_blank", "noopener,noreferrer");
    expect(screen.queryByText("Tagify 3.0")).not.toBeInTheDocument();
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

    render(<CommunityOnboardingModal entry="community" {...shared()} onClose={vi.fn()} />);

    expect(screen.getByText("Connected as Alex")).toBeInTheDocument();
    expect(screen.getByText("Connect Tagify to Community to share your tags.")).toBeInTheDocument();
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

    render(<CommunityOnboardingModal entry="community" {...shared()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Combine libraries" }));
    expect(screen.getByRole("heading", { name: "Combine your Tagify libraries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Combining libraries…" })).toBeDisabled();
    await act(async () => { finishCombine?.(); });
    expect(screen.getByText("Your Tagify libraries are combined.")).toBeInTheDocument();
  });

});
