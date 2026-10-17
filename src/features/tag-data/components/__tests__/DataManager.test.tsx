import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DataManager from "../DataManager";
import { buildTaxonomyFromCategoryTree, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure } from "@/types/tagData";

const taxonomyBackup: TagDataStructure = {
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  taxonomy: buildTaxonomyFromCategoryTree([
    {
      id: "genre",
      name: "Genre",
      subcategories: [
        {
          id: "electronic",
          name: "Electronic",
          tags: [{ id: "house", name: "House" }],
        },
      ],
    },
  ]),
  tracks: {},
  playlists: {},
      artists: {},
};

describe("DataManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete window.TagifySync;
  });

  it("replaces the last-saved status with editing controls beside Settings", () => {
    render(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={vi.fn()} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} historyControls={<button>Undo</button>} />);
    expect(screen.queryByText(/Last saved/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" }).parentElement!.nextElementSibling).toBe(screen.getByRole("button", { name: "Settings" }));
  });

  it("passes taxonomy backups through to the importer", async () => {
    const onImportTagData = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <DataManager
        onExportTagData={vi.fn().mockResolvedValue(undefined)}
        onImportTagData={onImportTagData}
        onOpenStats={vi.fn()}
        onResetTagifyData={vi.fn().mockResolvedValue(undefined)}
        onRetryMigration={vi.fn()}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected backup file input");
    }

    const file = new File(
      [JSON.stringify(taxonomyBackup)],
      "tagify-backup.json",
      { type: "application/json" },
    );

    fireEvent.change(fileInput, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onImportTagData).toHaveBeenCalledWith(taxonomyBackup);
    });
  });

  it("rejects non-object JSON payloads before import", async () => {
    const onImportTagData = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <DataManager
        onExportTagData={vi.fn().mockResolvedValue(undefined)}
        onImportTagData={onImportTagData}
        onOpenStats={vi.fn()}
        onResetTagifyData={vi.fn().mockResolvedValue(undefined)}
        onRetryMigration={vi.fn()}
      />,
    );

    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected backup file input");
    }

    const file = new File(["123"], "invalid-backup.json", {
      type: "application/json",
    });

    fireEvent.change(fileInput, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onImportTagData).not.toHaveBeenCalled();
      expect(Spicetify.showNotification).toHaveBeenCalledWith(
        "Invalid backup file format",
        true,
      );
    });
  });

  it("controls update protection independently from support buttons", async () => {
    render(
      <DataManager
        onExportTagData={vi.fn().mockResolvedValue(undefined)}
        onImportTagData={vi.fn()}
        onOpenStats={vi.fn()}
        onResetTagifyData={vi.fn().mockResolvedValue(undefined)}
        onRetryMigration={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Spotify update protection help" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Settings"));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Show support buttons" }),
    );

    expect(
      screen.getByRole("button", { name: "Spotify update protection help" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("tagify:showSupportButtons")).toBe("false");

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Show update protection button",
      }),
    );

    expect(
      screen.queryByRole("button", {
        name: "Spotify update protection help",
      }),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("tagify:showUpdateProtectionButton")).toBe(
      "false",
    );
  });

  it("opens the Stats view and shows when it is open", () => {
    const onOpenStats = vi.fn();
    const { rerender } = render(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={onOpenStats} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "View your stats" }));
    expect(onOpenStats).toHaveBeenCalledTimes(1);
    rerender(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={onOpenStats} statsOpen onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Close your stats" })).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps the upgrade glow until Stats is clicked, including after remount", () => {
    localStorage.setItem("tagify:lastSeenVersion", "3.1.0");
    const props = { onExportTagData: vi.fn(), onImportTagData: vi.fn(), onOpenStats: vi.fn(), onResetTagifyData: vi.fn(), onRetryMigration: vi.fn() };
    const first = render(<DataManager {...props} />);
    expect(screen.getByRole("button", { name: "View your stats" }).className).toContain("statsIntroduction");
    localStorage.setItem("tagify:lastSeenVersion", "3.2.0");
    first.unmount();
    const second = render(<DataManager {...props} />);
    const button = screen.getByRole("button", { name: "View your stats" });
    expect(button.className).toContain("statsIntroduction");
    fireEvent.click(button);
    expect(props.onOpenStats).toHaveBeenCalledOnce();
    expect(button.className).not.toContain("statsIntroduction");
    second.unmount();
    render(<DataManager {...props} />);
    expect(screen.getByRole("button", { name: "View your stats" }).className).not.toContain("statsIntroduction");
  });

  it("does not highlight Stats for a fresh installation", () => {
    render(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={vi.fn()} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} />);
    expect(screen.getByRole("button", { name: "View your stats" }).className).not.toContain("statsIntroduction");
  });

});
