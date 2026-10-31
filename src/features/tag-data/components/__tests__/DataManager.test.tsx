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
    render(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={vi.fn()} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()} historyControls={<button>Undo</button>} />);
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
        onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()}
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
        onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()}
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

  const renderDataManager = () =>
    render(
      <DataManager
        onExportTagData={vi.fn().mockResolvedValue(undefined)}
        onImportTagData={vi.fn()}
        onOpenStats={vi.fn()}
        onResetTagifyData={vi.fn().mockResolvedValue(undefined)}
        onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()}
      />,
    );
  const optionalButtonNames = [
    "Spotify update protection help",
    "Give feedback - shape Tagify's future",
    "Support Tagify :)",
    "Invite a friend to Tagify",
    "Join the Discord!",
  ];

  it("hides every optional top menu button with one setting", async () => {
    renderDataManager();
    for (const name of optionalButtonNames) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByTitle("Settings"));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Show optional buttons" }),
    );

    for (const name of optionalButtonNames) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(localStorage.getItem("tagify:showOptionalButtons")).toBe("false");
  });

  it("keeps the top menu quiet for members who hid buttons with the earlier toggles", () => {
    localStorage.setItem("tagify:showSupportButtons", "false");
    renderDataManager();
    for (const name of optionalButtonNames) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("opens the Stats view and shows when it is open", () => {
    const onOpenStats = vi.fn();
    const { rerender } = render(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={onOpenStats} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "View your stats" }));
    expect(onOpenStats).toHaveBeenCalledTimes(1);
    rerender(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={onOpenStats} statsOpen onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Close your stats" })).toHaveAttribute("aria-pressed", "true");
  });
  it("keeps the upgrade glow until Stats is clicked, including after remount", () => {
    localStorage.setItem("tagify:lastSeenVersion", "3.1.0");
    const props = { onExportTagData: vi.fn(), onImportTagData: vi.fn(), onOpenStats: vi.fn(), onResetTagifyData: vi.fn(), onRetryMigration: vi.fn(), onConnectCommunity: vi.fn(), onOpenSync: vi.fn() };
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

  it("opens the invite panel from the button beside Discord and closes it on Escape or a click elsewhere", async () => {
    render(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={vi.fn()} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()} />);
    const invite = screen.getByRole("button", { name: "Invite a friend to Tagify" });
    expect(invite.nextElementSibling).toBe(screen.getByTitle("Join the Discord!"));

    fireEvent.click(invite);
    expect(await screen.findByRole("dialog", { name: "Invite a friend" })).toBeInTheDocument();
    expect(invite).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invite).toHaveFocus();

    fireEvent.click(invite);
    await screen.findByRole("dialog", { name: "Invite a friend" });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the invite panel before opening Community setup", async () => {
    const onConnectCommunity = vi.fn();
    render(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={vi.fn()} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} onConnectCommunity={onConnectCommunity} onOpenSync={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Invite a friend to Tagify" }));
    // Not connected on this computer: the general link, with Community setup to add a name.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveTextContent("https://tagify.fm/join"));
    fireEvent.click(screen.getByRole("button", { name: "Connect Community" }));
    expect(onConnectCommunity).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not highlight Stats for a fresh installation", () => {
    render(<DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={vi.fn()} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()} />);
    expect(screen.getByRole("button", { name: "View your stats" }).className).not.toContain("statsIntroduction");
  });

});
