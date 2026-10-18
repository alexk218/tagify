import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpotifyUpdateHelpModal, {
  BLOCK_SPOTIFY_UPDATES_COMMAND,
} from "../SpotifyUpdateHelpModal";
import DataManager from "../DataManager";

describe("SpotifyUpdateHelpModal", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("opens from the control bar update-protection icon", async () => {
    render(
      <DataManager
        onOpenStats={vi.fn()}
        onExportTagData={vi.fn()}
        onImportTagData={vi.fn()}
        onResetTagifyData={vi.fn()}
        onRetryMigration={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Spotify update protection help" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Keep Tagify available" }),
    ).toBeInTheDocument();
  });

  it("explains the limitation and copies the blocking command", async () => {
    render(<SpotifyUpdateHelpModal onClose={vi.fn()} />);

    expect(
      screen.getByRole("dialog", { name: "Keep Tagify available" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This does not back up your Tagify data."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy Spotify update blocking command",
      }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(BLOCK_SPOTIFY_UPDATES_COMMAND);
    });
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("offers the Windows installer without any terminal commands", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
    render(<SpotifyUpdateHelpModal onClose={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Get the Windows installer" }))
      .toHaveAttribute("href", "https://github.com/alexk218/tagify-installer/releases");
    expect(screen.getByText(/lets you block automatic Spotify updates/)).toHaveTextContent(/checks for Tagify and Spicetify updates/);
    expect(screen.queryByRole("button", { name: "Copy Spotify update blocking command" })).not.toBeInTheDocument();
    expect(document.querySelector("code")).toBeNull();
  });

  it("offers Mac installer guidance alongside the Terminal command", () => {
    render(<SpotifyUpdateHelpModal onClose={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Get the Mac installer" }))
      .toHaveAttribute("href", "https://github.com/alexk218/tagify-installer/releases");
    expect(screen.getByText("Or run once in Terminal")).toBeInTheDocument();
    expect(screen.getByText(BLOCK_SPOTIFY_UPDATES_COMMAND)).toBeInTheDocument();
  });

  it("keeps Linux guidance free of unsupported commands and installers", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Linux");
    render(<SpotifyUpdateHelpModal onClose={vi.fn()} />);

    expect(screen.getByText(/through the package manager/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.querySelector("code")).toBeNull();
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    render(<SpotifyUpdateHelpModal onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a useful error when clipboard access fails", async () => {
    writeText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<SpotifyUpdateHelpModal onClose={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy Spotify update blocking command",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Copy failed. Select the command and copy it manually.",
        ),
      ).toBeInTheDocument();
    });
  });
});
