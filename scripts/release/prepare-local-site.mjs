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
/** Where tagify.fm/invite (the invite link Tagify 3.3.1 and earlier shared) now sends friends. */
export const INVITE_DESTINATION = 'https://community.tagify.fm/join';
/**
 * Community's addresses for the general invite. Community is moving to tagify.fm
 * (packages/tagify-community/docs/DOMAIN_MOVE_PLAN.md); afterwards community.tagify.fm/join
 * redirects there, so either one serving the invite counts as live.
 */
export const INVITE_PAGES = ['https://community.tagify.fm/join', 'https://tagify.fm/join'];
/**
 * The release host's own address. Once Community serves tagify.fm, this project keeps only the
 * update files and download redirects there; every other page goes to the same path on tagify.fm.
 */
export const RELEASE_HOST = 'releases.tagify.fm';
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

/**
 * Stops a deploy whose /invite would send friends to a Community page that isn't live yet.
 * Community answers unknown paths with a 200 "not found", so the page must be the general invite.
 */
export async function assertInviteDestinationLive(fetchPage = fetch) {
  let url = INVITE_DESTINATION;
  let response = await fetchPage(url, { redirect: 'manual' });
  // After the move, the old address answers with one redirect to the invite's new home.
  const location = response.headers?.get?.('location');
  if ([301, 308].includes(response.status) && location && INVITE_PAGES.includes(new URL(location, url).href)) {
    url = new URL(location, url).href;
    response = await fetchPage(url, { redirect: 'manual' });
  }
  const live = response.status === 200 && (await response.text()).includes(`<link rel="canonical" href="${url}"/>`);
  if (!live) throw Error(`${url} isn't the general invite yet (answered ${response.status}); deploy Community's general invite before tagify.fm, so tagify.fm/invite doesn't lead to a missing page.`);
}

const escapeRoute = path => '^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';

/** Vercel routes for the upload: download and legacy redirects, then the site's own pages. */
export function siteRoutes(downloads, legacyRedirects) {
  const redirect = (src, location) => ({ src, status: 302, headers: { Location: location, 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
  const onReleaseHost = [{ type: 'host', value: RELEASE_HOST }];
  return [
    // The release host never shows the old pages: search engines skip it, and people land on tagify.fm.
    { src: '/(.*)', has: onReleaseHost, headers: { 'X-Robots-Tag': 'noindex' }, continue: true },
    { src: '^/(?!download/(?:mac|windows)$|releases/)(.*)$', has: onReleaseHost, status: 308, headers: { Location: 'https://tagify.fm/$1' } },
    redirect('/download/mac', downloads.mac.url),
    redirect('/download/windows', downloads.windows.url),
    ...Object.entries(legacyRedirects).map(([path, location]) => redirect(escapeRoute(path), location)),
    { src: '/releases/(.*)', headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=0, s-maxage=300' }, continue: true },
    redirect('^/invite/?$', INVITE_DESTINATION),
    { handle: 'filesystem' },
    // Serve page links such as /faq from faq.html.
    { src: '^/([a-z0-9-]+)$', dest: '/$1.html', check: true },
  ];
}

async function main() {
  // The website source is always this package's landing-page; there is no external override.
  if (process.argv.length !== 3) throw Error('Usage: node prepare-local-site.mjs fresh-output');
  const output = resolve(process.argv[2]);
  try { await access(output); throw Error('Output exists; choose a fresh directory.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'tagify-release' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  await assertInviteDestinationLive();
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

  const routes = siteRoutes(downloads, legacyRedirects);
  await mkdir(join(output, '.vercel'), { recursive: true });
  await writeFile(join(output, '.vercel/project.json'), JSON.stringify({ projectId: 'prj_an6hlIOtbHEoHqll0Nn7vkABKGpG', orgId: 'team_4DygfnNFb6qjpweqfOmmxASG', projectName: 'tagify' }));
  await writeFile(join(output, '.vercel/output/config.json'), JSON.stringify({ version: 3, routes }, null, 2) + '\n');
  await writeFile(join(output, 'release-manifest.json'), JSON.stringify({ downloads, legacyRedirects }, null, 2) + '\n');
  console.log(`Prepared ${root}\nMac: ${downloads.mac.url}\nWindows: ${downloads.windows.url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
