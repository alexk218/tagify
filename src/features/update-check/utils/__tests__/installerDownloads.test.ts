import { describe, expect, it } from "vitest";
import { findMacInstallerDownload, INSTALLER_RELEASES_URL } from "../installerDownloads";

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
    ])).toBeNull();
    expect(findMacInstallerDownload({})).toBeNull();
  });
});
