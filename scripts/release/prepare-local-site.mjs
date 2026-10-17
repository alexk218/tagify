import process from 'node:process';
import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Build an isolated, static Vercel upload of the website. Release files live only on GitHub;
// tagify.fm redirects to them and never serves a download itself.
const project = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const INSTALLER_REPOSITORY = 'alexk218/tagify-installer';
const PLATFORM_ASSETS = { mac: 'TagifyInstaller-mac.dmg', windows: 'TagifyInstaller.exe' };
// Public files from landing-page. Tests, notes and tooling there are never uploaded.
export const WEBSITE_FILES = ['index.html', 'how-it-works.html', 'faq.html', 'blog', 'assets', 'styles', 'scripts', 'favicon.ico', 'site.webmanifest', 'robots.txt', 'sitemap.xml'];

export function stableVersion(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag ?? '');
  return match ? match.slice(1).map(Number) : null;
}

const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Pick the newest stable release that carries each platform's installer, ignoring GitHub's shared "Latest" badge.
export function selectDownloads(releases) {
  const downloads = {};
  for (const [platform, name] of Object.entries(PLATFORM_ASSETS)) {
    let best = null;
    for (const release of releases) {
      const version = stableVersion(release?.tag_name);
      if (!version || release.draft !== false || release.prerelease !== false) continue;
      const url = `https://github.com/${INSTALLER_REPOSITORY}/releases/download/${release.tag_name}/${name}`;
      const asset = release.assets?.find(a => a?.name === name && a.browser_download_url === url && a.state === 'uploaded' && a.size > 0 && /^sha256:[a-f0-9]{64}$/.test(a.digest ?? ''));
      if (asset && (!best || compareVersions(version, best.version) > 0)) {
        best = { version, tag: release.tag_name, url, digest: asset.digest, size: asset.size };
      }
    }
    if (!best) throw Error(`No verified ${platform} installer on GitHub Releases.`);
    downloads[platform] = best;
  }
  return downloads;
}

const escapeRoute = path => '^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';

async function main() {
  // The website source is always this package's landing-page; there is no external override.
  if (process.argv.length !== 3) throw Error('Usage: node prepare-local-site.mjs fresh-output');
  const output = resolve(process.argv[2]);
  try { await access(output); throw Error('Output exists; choose a fresh directory.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'tagify-release' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${INSTALLER_REPOSITORY}/releases?per_page=100`, { headers });
  if (!response.ok) throw Error(`GitHub release list unavailable: ${response.status}`);
  const downloads = selectDownloads(await response.json());

  const root = join(output, '.vercel/output/static');
  await mkdir(root, { recursive: true });
  const site = join(project, 'landing-page');
  for (const name of WEBSITE_FILES) await cp(join(site, name), join(root, name), { recursive: true });
  const indexPath = join(root, 'index.html');
  await writeFile(indexPath, (await readFile(indexPath, 'utf8')).replaceAll('https://tagify.fm/releases/install/install.sh', 'https://raw.githubusercontent.com/alexk218/tagify/main/install.sh'));

  // Frozen update metadata read by builds released October 12-14, 2026. Text only; it points those builds to GitHub.
  const legacy = join(project, 'scripts/release/legacy-tagify-fm');
  await cp(join(legacy, 'releases'), join(root, 'releases'), { recursive: true });
  const legacyRedirects = JSON.parse(await readFile(join(legacy, 'redirects.json'), 'utf8'));
  for (const destination of Object.values(legacyRedirects)) {
    if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com)\/alexk218\//.test(destination)) throw Error(`Redirect must point to GitHub: ${destination}`);
  }

  const redirect = (src, location) => ({ src, status: 302, headers: { Location: location, 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
  const routes = [
    redirect('/download/mac', downloads.mac.url),
    redirect('/download/windows', downloads.windows.url),
    ...Object.entries(legacyRedirects).map(([path, location]) => redirect(escapeRoute(path), location)),
    { src: '/releases/(.*)', headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=0, s-maxage=300' }, continue: true },
    { handle: 'filesystem' },
    // Serve page links such as /faq from faq.html.
    { src: '^/([a-z0-9-]+)$', dest: '/$1.html', check: true },
  ];
  await mkdir(join(output, '.vercel'), { recursive: true });
  await writeFile(join(output, '.vercel/project.json'), JSON.stringify({ projectId: 'prj_an6hlIOtbHEoHqll0Nn7vkABKGpG', orgId: 'team_4DygfnNFb6qjpweqfOmmxASG', projectName: 'tagify' }));
  await writeFile(join(output, '.vercel/output/config.json'), JSON.stringify({ version: 3, routes }, null, 2) + '\n');
  await writeFile(join(output, 'release-manifest.json'), JSON.stringify({ downloads, legacyRedirects }, null, 2) + '\n');
  console.log(`Prepared ${root}\nMac: ${downloads.mac.url}\nWindows: ${downloads.windows.url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
