import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UpdateBanner from "../UpdateBanner";
import { useUpdateChecker } from "../../hooks/useUpdateChecker";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: vi.fn() }));

function UpdateNotice() {
  const { updateInfo, dismissUpdate } = useUpdateChecker({
    currentVersion: "3.0.0",
    repoOwner: "alexk218",
    repoName: "tagify",
    delayMs: 0,
  });
  return updateInfo ? <UpdateBanner updateInfo={updateInfo} onDismiss={dismissUpdate} /> : null;
}

describe("Update reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v3.1.0", body: "A new release." }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("offers only a temporary close and reminds again when reopened, including old hidden releases", async () => {
    localStorage.setItem("tagify:dismissedVersions", JSON.stringify(["3.1.0"]));
    const firstSession = render(<UpdateNotice />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Tagify 3.1.0 is available!")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/don't remind me/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Close this notification"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByText("Tagify 3.1.0 is available!")).not.toBeInTheDocument();
    firstSession.unmount();

    render(<UpdateNotice />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Tagify 3.1.0 is available!")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Show changelog"));
    expect(screen.getByText("A new release.")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Show update instructions"));
    expect(screen.getByText("Manual Install")).toBeInTheDocument();
  });
});

const releasesUrl = "https://github.com/alexk218/tagify-installer/releases";
const macUrl = `${releasesUrl}/download/v1.0.2/TagifyInstaller-mac.dmg`;
const windowsUrl = `${releasesUrl}/download/v1.0.3/TagifyInstaller.exe`;
const macReleases = [
  { tag_name: "v1.0.3", draft: false, prerelease: false, assets: [{ name: "TagifyInstaller.exe", browser_download_url: windowsUrl }] },
  { tag_name: "v1.0.2", draft: false, prerelease: false, assets: [{ name: "TagifyInstaller-mac.dmg", browser_download_url: macUrl }] },
];

function renderBanner(platform = "Macintosh") {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform);
  render(<UpdateBanner updateInfo={{ hasUpdate: true, latestVersion: "3.0.1" }} onDismiss={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "How to Update" }));
}

describe("Platform installer guidance", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => macReleases }));
    vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leads with the Mac installer and downloads the Mac asset despite a newer Windows release", async () => {
    renderBanner();
    expect(screen.getByText(/Use the Mac installer/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Download Mac Installer" }));
    expect(window.open).toHaveBeenCalledWith(macUrl, "_blank", "noopener,noreferrer");
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/alexk218/tagify-installer/releases?per_page=100", expect.anything());
    expect(screen.queryByText(/curl -fsSL/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I Have Installer" })).toBeInTheDocument();
  });

  it("keeps existing-installer guidance and manual Terminal updating available on Mac", async () => {
    renderBanner();
    await screen.findByRole("button", { name: "Download Mac Installer" });
    fireEvent.click(screen.getByRole("button", { name: "I Have Installer" }));
    expect(screen.getByText(/choose the update shown for your setup/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manual Install" }));
    expect(screen.getByText(/curl -fsSL/)).toBeInTheDocument();
    expect(screen.getByText("macOS (Terminal)")).toBeInTheDocument();
  });

  it("uses the releases list for Mac's View on GitHub action", async () => {
    renderBanner();
    await screen.findByRole("button", { name: "Download Mac Installer" });
    fireEvent.click(screen.getByRole("button", { name: "View on GitHub" }));
    expect(window.open).toHaveBeenCalledWith(releasesUrl, "_blank", "noopener,noreferrer");
  });

  it("offers GitHub downloads when the lookup fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: "View Mac downloads" }));
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't find the Mac download/);
    expect(window.open).toHaveBeenCalledWith(releasesUrl, "_blank", "noopener,noreferrer");
  });

  it("keeps Windows installer guidance and downloads the exe from the newest GitHub release", async () => {
    renderBanner("Windows NT 10.0");
    expect(screen.getByText(/click the/)).toHaveTextContent('"Update Tagify"');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I Need Installer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Installer" }));
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/alexk218/tagify-installer/releases?per_page=100", expect.anything());
    expect(window.open).toHaveBeenCalledWith(windowsUrl, "_blank", "noopener,noreferrer");
  });

  it("offers the GitHub releases page when the Windows lookup fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderBanner("Windows NT 10.0");
    fireEvent.click(screen.getByRole("button", { name: "I Need Installer" }));
    fireEvent.click(await screen.findByRole("button", { name: "View Windows downloads" }));
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't find the Windows download/);
    expect(window.open).toHaveBeenCalledWith(releasesUrl, "_blank", "noopener,noreferrer");
  });

  it("shows manual instructions on Linux without Windows installer tabs", () => {
    renderBanner("Linux");
    expect(screen.getByText("Linux (Terminal)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I Need Installer" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Update reminder measurements", () => {
  const info = { hasUpdate: true, latestVersion: "3.3.0", currentVersion: "3.2.0" };
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => macReleases }));
    vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const calls = () => vi.mocked(recordProductInteraction).mock.calls;

  it("reports the banner once a day with the size of the update", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
    const first = render(<UpdateBanner updateInfo={info} onDismiss={vi.fn()} />);
    first.unmount();
    render(<UpdateBanner updateInfo={info} onDismiss={vi.fn()} />);
    expect(calls()).toEqual([["update_banner_shown", { update_kind: "minor" }]]);
  });

  it("reports opening the instructions and downloading the installer", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
    render(<UpdateBanner updateInfo={info} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "How to Update" }));
    fireEvent.click(screen.getByRole("button", { name: "I Need Installer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Installer" }));
    expect(calls()).toContainEqual(["update_instructions_opened"]);
    expect(calls()).toContainEqual(["update_download_clicked", { method: "direct" }]);
  });

  it("reports the releases page on Mac", async () => {
    renderBanner();
    await screen.findByRole("button", { name: "Download Mac Installer" });
    fireEvent.click(screen.getByRole("button", { name: "View on GitHub" }));
    expect(calls()).toContainEqual(["update_download_clicked", { method: "release_page" }]);
  });

  it("reports a copied install command only after it is copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Linux");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<UpdateBanner updateInfo={info} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "How to Update" }));
    await act(async () => { fireEvent.click(screen.getByTitle("Copy command to clipboard")); });
    expect(writeText).toHaveBeenCalled();
    expect(calls()).toContainEqual(["update_download_clicked", { method: "command" }]);
  });

  it("reports closing the banner", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<UpdateBanner updateInfo={info} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTitle("Close this notification"));
    act(() => { vi.advanceTimersByTime(300); });
    expect(onDismiss).toHaveBeenCalled();
    expect(calls()).toContainEqual(["update_banner_dismissed"]);
    vi.useRealTimers();
  });
});
