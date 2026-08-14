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
  });

  it("passes taxonomy backups through to the importer", async () => {
    const onImportTagData = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <DataManager
        onExportTagData={vi.fn().mockResolvedValue(undefined)}
        onImportTagData={onImportTagData}
        onExportRekordbox={vi.fn()}
        onResetTagifyData={vi.fn().mockResolvedValue(undefined)}
        onRetryMigration={vi.fn()}
        lastSaved={null}
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
        onExportRekordbox={vi.fn()}
        onResetTagifyData={vi.fn().mockResolvedValue(undefined)}
        onRetryMigration={vi.fn()}
        lastSaved={null}
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
        onExportRekordbox={vi.fn()}
        onResetTagifyData={vi.fn().mockResolvedValue(undefined)}
        onRetryMigration={vi.fn()}
        lastSaved={null}
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
});
