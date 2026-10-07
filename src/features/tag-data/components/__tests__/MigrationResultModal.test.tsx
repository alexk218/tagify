import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrchestratorResult } from "@/services/MigrationOrchestrator";
import MigrationResultModal from "../MigrationResultModal";

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
    expect(screen.getByText(/Download a Tagify backup/)).toBeVisible();
    expect(screen.getByText(/Do not clear Spotify/)).toBeVisible();
    expect(screen.queryByText(/IndexedDB|localStorage|migration|clear browser cache/i)).not.toBeInTheDocument();
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
    expect(screen.getByText(/Choose Import in Tagify/)).toBeVisible();
    expect(screen.queryByText(/IndexedDB|localStorage|migration/i)).not.toBeInTheDocument();
  });
});
