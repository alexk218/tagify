import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { WEBSITE_FILES, selectDownloads } from './prepare-local-site.mjs';

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
