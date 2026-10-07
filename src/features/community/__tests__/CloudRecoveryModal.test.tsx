import React from "react";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudRecoveryModal, isCloudRecoveryStatus } from "../CloudRecoveryModal";

afterEach(() => {
  delete window.TagifySync;
  vi.restoreAllMocks();
});

describe("CloudRecoveryModal", () => {
  it("presents lost-replica recovery as a dedicated confirmation", async () => {
    const restoreFromCloud = vi.fn().mockResolvedValue(undefined);
    const preview = {
      annotations: 1248,
      taxonomyNodes: 73,
      appStateDocuments: 6,
      smartPlaylists: null,
      lastBackupAt: "2026-08-21T20:00:00.000Z",
      protectedDomains: ["smart-playlists"],
    };
    window.TagifySync = {
      getStatus: () => "recovery-available",
      getRecoveryPreview: () => preview,
      getLastRecovered: () => preview,
      restoreFromCloud,
    } as unknown as NonNullable<typeof window.TagifySync>;
    const onClose = vi.fn();

    render(<CloudRecoveryModal onClose={onClose} />);

    expect(screen.getByRole("heading", { name: "Recover Tagify data" })).toBeInTheDocument();
    expect(screen.getByText("Your local Tagify library appears to be missing")).toBeInTheDocument();
    expect(screen.getByText("1,248")).toBeInTheDocument();
    expect(screen.getByText("Your Community copy is still available.")).toBeInTheDocument();
    expect(screen.getByText("settings + smart playlists")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore from Community" }));
    await waitFor(() => {
      expect(restoreFromCloud).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("keeps recovery controls out of the ordinary Cloud Sync modal", () => {
    const source = readFileSync("src/features/community/CloudSyncModal.tsx", "utf8");
    const styles = readFileSync("src/features/community/CloudSyncModal.module.css", "utf8");
    expect(source).not.toContain("Restore from cloud");
    expect(source).not.toContain("local Tagify replica appears to have been reset");
    expect(source).not.toContain("Not end-to-end encrypted");
    expect(source).not.toContain("Synced data is readable by the Community service");
    expect(source).toContain("<Portal>");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain("overscroll-behavior: contain");
    expect(isCloudRecoveryStatus("recovery-available")).toBe(true);
    expect(isCloudRecoveryStatus("idle")).toBe(false);
  });

  it("ignores transient idle events until the recovery preview is cleared", () => {
    let preview: {
      annotations: number;
      taxonomyNodes: number;
      appStateDocuments: number;
      lastBackupAt: null;
      protectedDomains: string[];
    } | null = {
      annotations: 12,
      taxonomyNodes: 4,
      appStateDocuments: 2,
      lastBackupAt: null,
      protectedDomains: [],
    };
    window.TagifySync = {
      getStatus: () => "recovery-available",
      getRecoveryPreview: () => preview,
    } as unknown as NonNullable<typeof window.TagifySync>;
    const onClose = vi.fn();
    render(<CloudRecoveryModal onClose={onClose} />);

    act(() => {
      window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status: "idle" } }));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Recover Tagify data" })).toBeInTheDocument();

    preview = null;
    act(() => {
      window.dispatchEvent(new CustomEvent("tagify:syncStatus", { detail: { status: "idle" } }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
