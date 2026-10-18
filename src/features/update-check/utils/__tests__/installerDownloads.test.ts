import { describe, expect, it } from "vitest";
import { findInstallerDownload, INSTALLER_RELEASES_URL } from "../installerDownloads";

const findMacInstallerDownload = (releases: unknown) => findInstallerDownload(releases, "mac");

function release(version: string, name = "TagifyInstaller-mac.dmg") {
  return {
    tag_name: version, draft: false, prerelease: false,
    assets: [{ name, browser_download_url: `${INSTALLER_RELEASES_URL}/download/${version}/${name}` }],
  };
}

describe("Mac installer selection", () => {
  it("chooses the highest stable Mac version regardless of release order and Windows-only updates", () => {
    const selected = release("v1.10.0");
    expect(findMacInstallerDownload([
      release("v1.9.0"), selected, release("v2.0.0", "TagifyInstaller.exe"),
      { ...release("v3.0.0"), draft: true }, { ...release("v4.0.0"), prerelease: true },
      release("v5.0.0-beta.1"),
    ])).toBe(selected.assets[0].browser_download_url);
  });

  it("prefers DMG over ZIP and supports a ZIP-only release", () => {
    const dmg = release("v1.0.2");
    const zip = release("v1.0.2", "TagifyInstaller-mac.zip");
    expect(findMacInstallerDownload([{ ...dmg, assets: [...zip.assets, ...dmg.assets] }]))
      .toBe(dmg.assets[0].browser_download_url);
    expect(findMacInstallerDownload([zip])).toBe(zip.assets[0].browser_download_url);
  });

  it("rejects malformed metadata and downloads outside the official matching release", () => {
    const valid = release("v1.0.2");
    expect(findMacInstallerDownload([null, {}, { ...valid, assets: null },
      { ...valid, assets: [{ name: valid.assets[0].name, browser_download_url: "https://example.com/TagifyInstaller-mac.dmg" }] },
      { ...valid, assets: release("v1.0.1").assets },
      { ...valid, assets: [{ name: valid.assets[0].name, browser_download_url: "https://tagify.fm/releases/manager/v1.0.2/TagifyInstaller-mac.dmg" }] },
    ])).toBeNull();
    expect(findMacInstallerDownload({})).toBeNull();
  });
});

describe("Windows installer selection", () => {
  it("chooses the highest stable release with the Windows installer and ignores Mac-only releases", () => {
    const selected = release("v1.0.14", "TagifyInstaller.exe");
    expect(findInstallerDownload([
      release("v1.0.12", "TagifyInstaller.exe"), selected, release("v1.0.15"),
      { ...release("v1.0.16", "TagifyInstaller.exe"), prerelease: true },
      release("v1.0.17-beta.1", "TagifyInstaller.exe"),
    ], "windows")).toBe(selected.assets[0].browser_download_url);
  });

  it("never accepts a download hosted outside the matching GitHub release", () => {
    const valid = release("v1.0.14", "TagifyInstaller.exe");
    expect(findInstallerDownload([
      { ...valid, assets: [{ name: "TagifyInstaller.exe", browser_download_url: "https://tagify.fm/download/windows" }] },
      { ...valid, assets: release("v1.0.13", "TagifyInstaller.exe").assets },
    ], "windows")).toBeNull();
  });
});
