import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncPairingService } from "@/services/sync/SyncPairingService";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { storageService } from "@/services/storage/StorageService";
import { CommunityOnboardingModal } from "../CommunityOnboardingModal";
import { CloudSyncModal } from "../CloudSyncModal";

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

  it.each([["Cloud Sync", CloudSyncModal], ["Community setup", CommunityOnboardingModal]] as const)("avoids redundant syncs and saves changed visibility before retrying in %s", async (_name, Modal) => {
    let status = "error";
    const emit = (next: string) => {
      status = next;
      window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status } }));
    };
    const syncNow = vi.spyOn(syncRuntime, "syncNow").mockImplementation(async () => { emit("syncing"); });
    const policy = {
      revision: 1, reviewedAt: "2026-10-01T00:00:00Z", enabled: true, shareTaxonomy: true,
      hiddenTagIds: [], hiddenNodeIds: [],
      entities: { track: { tags: true }, album: { tags: true }, artist: { tags: true } },
    };
    let failSave = true;
    vi.spyOn(syncRuntime, "communityRequest").mockImplementation(async (_path, options) => {
      if (options?.method === "PUT" && failSave) { failSave = false; throw new Error("Server unavailable"); }
      return { policy: options?.method === "PUT" ? { ...(options.body as { policy: typeof policy }).policy, revision: 2 } : policy };
    });
    vi.spyOn(storageService, "getTaxonomy").mockResolvedValue({
      categoryOrder: ["mood"], categoriesById: { mood: { id: "mood", name: "Mood", childIds: ["happy"], subcategoryIds: [] } },
      tagsById: { happy: { id: "happy", name: "Happy", parentId: "mood", subcategoryId: "mood" } },
      foldersById: {}, childrenByParentId: { mood: ["happy"] }, subcategoriesById: {},
      customAccentsById: {}, colorThemesById: {}, colorThemeOrder: [], ungroupedColorIds: [],
    });
    window.TagifySync = {
      getStatus: () => status, getInitialMergePreview: () => null, getBackupHealth: () => null, syncNow,
    } as unknown as NonNullable<typeof window.TagifySync>;
    render(<Modal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
    act(() => emit("idle"));
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    act(() => emit("publishing"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    act(() => emit("snapshot-required"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    act(() => emit("error"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    act(() => emit("idle"));
    fireEvent.click(screen.getByRole("button", { name: /Public visibility Sharing all tags/ }));
    expect(await screen.findByRole("button", { name: "Save visibility" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Exclude Mood/ }));
    expect(screen.getByRole("button", { name: "Save visibility first" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Exclude Mood/ }));
    expect(screen.getByRole("button", { name: "Save visibility" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Exclude Mood/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));
    await screen.findByText("Couldn't save your sharing choices. Please try again.");
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save visibility first" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save visibility" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save visibility" }));
    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(2));
    if (Modal === CommunityOnboardingModal) {
      expect(screen.getByText("Your Community setup is ready.")).toBeInTheDocument();
      return;
    }
    expect(screen.getByRole("button", { name: "Syncing…" })).toBeDisabled();
    act(() => emit("publishing"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    act(() => emit("idle"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
    act(() => emit("snapshot-required"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    act(() => emit("error"));
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
  });

  it.each([["Cloud Sync", CloudSyncModal], ["Community setup", CommunityOnboardingModal]] as const)("keeps backup retry available if visibility cannot load in %s", async (_name, Modal) => {
    vi.spyOn(syncRuntime, "communityRequest").mockRejectedValue(new Error("Temporarily offline"));
    vi.spyOn(storageService, "getTaxonomy").mockRejectedValue(new Error("Temporarily unavailable"));
    window.TagifySync = {
      getStatus: () => "error", getInitialMergePreview: () => null, getBackupHealth: () => null,
    } as unknown as NonNullable<typeof window.TagifySync>;
    render(<Modal onClose={vi.fn()} />);
    await waitFor(() => expect(syncRuntime.communityRequest).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
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

    render(<CloudSyncModal onClose={vi.fn()} />);

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

    render(<CloudSyncModal onClose={vi.fn()} />);
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

    render(<CloudSyncModal onClose={vi.fn()} />);

    expect(screen.getByText(/972 tagged items/)).toBeInTheDocument();
    expect(screen.getByText(/Smart Playlists pending/)).toBeInTheDocument();
    expect(screen.queryByText(/Smart Playlists protected/)).not.toBeInTheDocument();
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

    render(<CloudSyncModal onClose={vi.fn()} />);
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
