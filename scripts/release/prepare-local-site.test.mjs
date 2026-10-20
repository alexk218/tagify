import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { INVITE_DESTINATION, RELEASE_HOST, WEBSITE_FILES, assertInviteDestinationLive, selectDownloads, siteRoutes } from './prepare-local-site.mjs';

const site = new URL('../../landing-page/', import.meta.url);
// The public tagify repository carries this script but not the website source, which stays in the monorepo.
const websiteSource = { skip: existsSync(site) ? false : 'the tagify.fm website source is only in the monorepo' };

// Every uploaded HTML page with its markup and canonical address.
async function publicPages() {
  const files = [];
  for (const name of WEBSITE_FILES) {
    if ((await stat(new URL(name, site))).isDirectory()) files.push(...(await readdir(new URL(name, site), { recursive: true })).filter(f => f.endsWith('.html')).map(f => `${name}/${f}`));
    else if (name.endsWith('.html')) files.push(name);
  }
  return Promise.all(files.map(async file => {
    const html = await readFile(new URL(file, site), 'utf8');
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    assert.ok(canonical, `${file} needs a canonical link`);
    return { file, html, canonical };
  }));
}

test('uploads robots.txt and a sitemap listing every public page by its canonical address', websiteSource, async () => {
  assert.ok(WEBSITE_FILES.includes('robots.txt') && WEBSITE_FILES.includes('sitemap.xml'));
  assert.match(await readFile(new URL('robots.txt', site), 'utf8'), /^Sitemap: https:\/\/tagify\.fm\/sitemap\.xml$/m);
  const sitemap = [...(await readFile(new URL('sitemap.xml', site), 'utf8')).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(sitemap.toSorted(), (await publicPages()).map(p => p.canonical).toSorted());
});

// Pages are served at addresses without a trailing slash, so links are resolved from the canonical address.
test('links reach pages by their canonical address and files the upload includes', websiteSource, async () => {
  const pages = await publicPages();
  const canonicals = new Set(pages.map(p => p.canonical));
  for (const { file, html, canonical } of pages) {
    for (const [, attr, value] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\b(href|src)="([^"]*)"/g)) {
      const url = new URL(value, canonical);
      if (url.origin !== 'https://tagify.fm' || url.pathname.startsWith('/download/')) continue;
      const path = decodeURIComponent(url.pathname);
      if ((attr === 'href' && !/\.[a-z]+$/.test(path)) || path.endsWith('.html')) {
        assert.ok(canonicals.has(url.origin + path), `${file}: ${value} should link to a page's canonical address`);
      } else {
        const uploaded = WEBSITE_FILES.includes(path.split('/')[1]) && (await stat(new URL('.' + path, site)).then(s => s.isFile(), () => false));
        assert.ok(uploaded, `${file}: ${value} is not part of the upload`);
      }
    }
  }
});

// Messaging apps fetch these images when a tagify.fm link is pasted, so each must be uploaded and stay small.
test('every link preview image is part of the upload and small enough for WhatsApp', websiteSource, async () => {
  for (const { file, html } of await publicPages()) {
    for (const [, value] of html.matchAll(/<meta (?:property|name)="(?:og|twitter):image" content="([^"]+)"/g)) {
      const url = new URL(value);
      assert.equal(url.origin, 'https://tagify.fm', `${file}: ${value} should be served by tagify.fm`);
      assert.ok(WEBSITE_FILES.includes(url.pathname.split('/')[1]), `${file}: ${value} is not part of the upload`);
      const { size } = await stat(new URL('.' + url.pathname, site));
      assert.ok(size < 300_000, `${file}: ${value} is ${size} bytes; WhatsApp skips preview images over about 300 KB`);
    }
  }
});

test('the old invite link sends friends to Community, before page links are matched to files', () => {
  const routes = siteRoutes({ mac: { url: 'https://github.com/mac' }, windows: { url: 'https://github.com/windows' } }, {});
  const invite = routes.findIndex(route => route.src === '^/invite/?$');
  assert.equal(INVITE_DESTINATION, 'https://community.tagify.fm/join');
  assert.equal(routes[invite].status, 302);
  assert.equal(routes[invite].headers.Location, INVITE_DESTINATION);
  assert.ok(invite < routes.findIndex(route => route.handle === 'filesystem'));
});

test('refuses to deploy the invite redirect before Community serves the general invite', async () => {
  const generalInvite = '<head><link rel="canonical" href="https://community.tagify.fm/join"/></head>';
  const answering = (status, body = generalInvite) => async (url, options) => {
    assert.equal(url, INVITE_DESTINATION);
    assert.equal(options.redirect, 'manual');
    return { status, headers: new Headers(), text: async () => body };
  };
  await assertInviteDestinationLive(answering(200));
  // Community's "not found" for an unknown path still answers 200.
  await assert.rejects(assertInviteDestinationLive(answering(200, '<title>Profile · Tagify Community</title>')), /isn't the general invite yet \(answered 200\)/);
  await assert.rejects(assertInviteDestinationLive(answering(404)), /answered 404/);
  await assert.rejects(assertInviteDestinationLive(answering(307)), /answered 307/);
});

const digest = 'sha256:' + 'a'.repeat(64);
const asset = (tag, name, url) => ({ name, state: 'uploaded', size: 10, digest, browser_download_url: url ?? `https://github.com/alexk218/tagify-installer/releases/download/${tag}/${name}` });
const release = (tag, names, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: names.map(name => asset(tag, name)), ...extra });

test('selects the newest stable release per platform independently', () => {
  const downloads = selectDownloads([
    release('v1.0.9', ['TagifyInstaller-mac.dmg']),
    release('v1.0.12', ['TagifyInstaller.exe']),
    release('v1.0.10', ['TagifyInstaller.exe']),
    release('v1.0.14', ['TagifyInstaller-mac.dmg', 'TagifyInstaller.exe'], { draft: true }),
    release('v1.0.15', ['TagifyInstaller-mac.dmg'], { prerelease: true }),
    release('v1.0.16-beta', ['TagifyInstaller-mac.dmg']),
  ]);
  assert.equal(downloads.mac.url, 'https://github.com/alexk218/tagify-installer/releases/download/v1.0.9/TagifyInstaller-mac.dmg');
  assert.equal(downloads.windows.url, 'https://github.com/alexk218/tagify-installer/releases/download/v1.0.12/TagifyInstaller.exe');
});

test('compares versions numerically', () => {
  const downloads = selectDownloads([release('v1.0.9', ['TagifyInstaller-mac.dmg', 'TagifyInstaller.exe']), release('v1.0.13', ['TagifyInstaller-mac.dmg', 'TagifyInstaller.exe']), release('v1.0.10', ['TagifyInstaller-mac.dmg', 'TagifyInstaller.exe'])]);
  assert.equal(downloads.mac.tag, 'v1.0.13');
  assert.equal(downloads.windows.tag, 'v1.0.13');
});

test('rejects downloads hosted outside the GitHub release or without a digest', () => {
  const offsite = { tag_name: 'v2.0.0', draft: false, prerelease: false, assets: [asset('v2.0.0', 'TagifyInstaller-mac.dmg', 'https://tagify.fm/releases/manager/v2.0.0/TagifyInstaller-mac.dmg'), { ...asset('v2.0.0', 'TagifyInstaller.exe'), digest: null }] };
  assert.throws(() => selectDownloads([offsite]), /No verified mac installer/);
});

test('after Community moves to tagify.fm, the old invite address redirecting there still counts as live', async () => {
  const moved = '<head><link rel="canonical" href="https://tagify.fm/join"/></head>';
  const answers = {
    'https://community.tagify.fm/join': { status: 308, headers: new Headers({ location: 'https://tagify.fm/join' }), text: async () => '' },
    'https://tagify.fm/join': { status: 200, headers: new Headers(), text: async () => moved },
  };
  await assertInviteDestinationLive(async (url) => answers[url]);
  // A redirect anywhere else isn't the invite.
  const elsewhere = { ...answers, 'https://community.tagify.fm/join': { ...answers['https://community.tagify.fm/join'], headers: new Headers({ location: 'https://example.com/join' }) } };
  await assert.rejects(assertInviteDestinationLive(async (url) => elsewhere[url]), /answered 308/);
  // The new page must name itself as canonical.
  const wrong = { ...answers, 'https://tagify.fm/join': { status: 200, headers: new Headers(), text: async () => '<title>Tagify</title>' } };
  await assert.rejects(assertInviteDestinationLive(async (url) => wrong[url]), /tagify\.fm\/join isn't the general invite yet/);
});

test('the release host keeps only update files and downloads, and sends every other page to tagify.fm', () => {
  const routes = siteRoutes({ mac: { url: 'https://github.com/mac' }, windows: { url: 'https://github.com/windows' } }, {});
  const hostRoutes = routes.filter(route => route.has?.some(condition => condition.type === 'host' && condition.value === RELEASE_HOST));
  assert.equal(RELEASE_HOST, 'releases.tagify.fm');
  // Both come before anything else, so the old pages never show on the release host.
  assert.deepEqual(routes.slice(0, 2), hostRoutes);
  assert.equal(hostRoutes[0].headers['X-Robots-Tag'], 'noindex');
  assert.equal(hostRoutes[0].continue, true);
  const away = hostRoutes[1];
  assert.equal(away.status, 308);
  assert.equal(away.headers.Location, 'https://tagify.fm/$1');
  const pattern = new RegExp(away.src);
  for (const path of ['/', '/faq', '/blog/zettelkasten-for-spotify', '/download', '/download/linux', '/releasesx']) assert.ok(pattern.test(path), path);
  for (const path of ['/download/mac', '/download/windows', '/releases/client/latest.json', '/releases/manager/appcast.xml', '/releases/manager/']) assert.ok(!pattern.test(path), path);
  assert.equal('/faq'.replace(pattern, '$1'), 'faq');
  // Every other route is for any host, so tagify.fm itself is unchanged until the move.
  for (const route of routes.slice(2)) assert.equal(route.has, undefined);
});
