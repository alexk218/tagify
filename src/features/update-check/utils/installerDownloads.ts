export const INSTALLER_RELEASES_URL =
  "https://github.com/alexk218/tagify-installer/releases";
export const INSTALLER_RELEASES_API =
  "https://api.github.com/repos/alexk218/tagify-installer/releases?per_page=100";

const MAC_ASSETS = ["TagifyInstaller-mac.dmg", "TagifyInstaller-mac.zip", "Tagify.pkg"];

export function findMacInstallerDownload(releases: unknown): string | null {
  if (!Array.isArray(releases)) return null;

  const candidates: { version: number[]; url: string }[] = [];
  for (const release of releases) {
    if (!release || release.draft !== false || release.prerelease !== false ||
        typeof release.tag_name !== "string" || !Array.isArray(release.assets)) continue;
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name);
    if (!match) continue;
    const version = match.slice(1).map(Number);
    if (!version.every(Number.isSafeInteger)) continue;

    for (const name of MAC_ASSETS) {
      const url = `https://github.com/alexk218/tagify-installer/releases/download/${release.tag_name}/${name}`;
      if (release.assets.some((asset: { name?: string; browser_download_url?: string } | null) =>
        asset?.name === name && asset.browser_download_url === url)) {
        candidates.push({ version, url });
        break;
      }
    }
  }

  candidates.sort((a, b) => {
    for (let index = 0; index < 3; index++) {
      const difference = b.version[index] - a.version[index];
      if (difference) return difference;
    }
    return 0;
  });
  return candidates[0]?.url ?? null;
}
