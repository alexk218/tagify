import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrchestratorResult } from "@/services/MigrationOrchestrator";
import MigrationResultModal from "../MigrationResultModal";

const technicalTerms = /IndexedDB|localStorage|migration|database|clear browser cache/i;

describe("library update messages", () => {
  it("gives a safe next step without revealing storage errors or suggesting data deletion", () => {
    const result: OrchestratorResult = {
      success: false,
      dataSource: "localStorage",
      isFreshInstall: false,
      data: {} as OrchestratorResult["data"],
      migrationsRun: [],
      trackCount: 12,
      fallbackReason: "IndexedDB transaction failed for object store tracks",
    };
    render(<MigrationResultModal result={result} onClose={vi.fn()} />);
    expect(screen.getByText(/Choose Try again/)).toBeVisible();
    expect(screen.getByText(/Do not clear Spotify/)).toBeVisible();
    expect(screen.queryByText(technicalTerms)).not.toBeInTheDocument();
  });

  it("says changes aren't saved while the library can't be opened", () => {
    const result: OrchestratorResult = {
      success: false, fallbackMode: true, dataSource: "indexedDB", isFreshInstall: false,
      data: {} as OrchestratorResult["data"], migrationsRun: [], trackCount: 0,
      fallbackReason: "UnknownError",
    };
    render(<MigrationResultModal result={result} onClose={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("Tagify can't save changes right now")).toBeVisible();
    expect(screen.getByText(/changes you make now won't be saved/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.queryByText(technicalTerms)).not.toBeInTheDocument();
  });

  it("asks people who went back to an older Tagify to install the latest one instead of retrying", () => {
    const result: OrchestratorResult = {
      success: false, fallbackMode: true, dataSource: "indexedDB", isFreshInstall: false,
      data: {} as OrchestratorResult["data"], migrationsRun: [], trackCount: 0,
      fallbackReason: "VersionError",
    };
    render(<MigrationResultModal result={result} onClose={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("Your library was saved by a newer Tagify")).toBeVisible();
    expect(screen.getByText(/Nothing has been lost/)).toBeVisible();
    expect(screen.getByText(/Install the latest Tagify release/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.queryByText(technicalTerms)).not.toBeInTheDocument();
  });

  it("asks before restoring an older copy and passes the choice on", async () => {
    const asked: OrchestratorResult = {
      success: false, fallbackMode: true, dataSource: "indexedDB", isFreshInstall: false,
      data: {} as OrchestratorResult["data"], migrationsRun: [], trackCount: 1_204,
      olderCopy: { trackCount: 1_204 },
    };
    const onRetry = vi.fn().mockResolvedValue({ ...asked, success: true, fallbackMode: false, olderCopy: undefined, restoredOlderCopy: true });
    const onClose = vi.fn();
    render(<MigrationResultModal result={asked} onClose={onClose} onRetry={onRetry} />);

    expect(screen.getByText("Your library on this device is empty")).toBeVisible();
    expect(screen.getByText("1,204")).toBeVisible();
    expect(screen.getByText(/Changes you make aren't saved until you choose/)).toBeVisible();
    expect(screen.queryByText(technicalTerms)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore older copy" }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith({ olderCopy: "restore" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore older copy" })).toBeEnabled());
    // The restored state explains how to get later changes back.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after starting fresh", async () => {
    const asked: OrchestratorResult = {
      success: false, fallbackMode: true, dataSource: "indexedDB", isFreshInstall: false,
      data: {} as OrchestratorResult["data"], migrationsRun: [], trackCount: 3, olderCopy: { trackCount: 3 },
    };
    const onRetry = vi.fn().mockResolvedValue({ ...asked, success: true, fallbackMode: false, olderCopy: undefined });
    const onClose = vi.fn();
    render(<MigrationResultModal result={asked} onClose={onClose} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onRetry).toHaveBeenCalledWith({ olderCopy: "start-fresh" });
  });

  it("tells people how to get their newest changes back after an older copy is restored", () => {
    const result: OrchestratorResult = {
      success: true,
      dataSource: "indexedDB",
      isFreshInstall: false,
      data: {} as OrchestratorResult["data"],
      migrationsRun: ["restoredOlderCopy"],
      trackCount: 1_204,
      restoredOlderCopy: true,
    };
    render(<MigrationResultModal result={result} onClose={vi.fn()} />);
    expect(screen.getByText("Tagify restored an older copy of your library")).toBeVisible();
    expect(screen.getByText("1,204")).toBeVisible();
    expect(screen.getByText(/Skip tagify-older-copy files/)).toBeVisible();
    expect(screen.getByText(/Choose Import in Tagify/)).toBeVisible();
    expect(screen.queryByText(technicalTerms)).not.toBeInTheDocument();
  });
});
