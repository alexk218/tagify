import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { capture, configuration, eventUUID } from './posthog.mjs';

const assets = {
  'TagifyInstaller-mac.dmg': ['macos', 'dmg'], 'TagifyInstaller-mac.zip': ['macos', 'zip'],
  'Tagify.pkg': ['macos', 'pkg'], 'TagifyInstaller.exe': ['windows', 'exe'],
};
export async function releases(request = fetch, token = process.env.GITHUB_TOKEN) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const response = await request(`https://api.github.com/repos/alexk218/tagify-installer/releases?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}). No partial snapshot was sent.`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('GitHub returned invalid release data.');
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  throw new Error('Release pagination exceeded its safety limit. No partial snapshot was sent.');
}
export function snapshot(releases, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const seen = new Set();
  const events = [];
  for (const release of releases) {
    if (release.draft) continue;
    for (const asset of release.assets ?? []) {
      const format = Object.hasOwn(assets, asset.name) ? assets[asset.name] : undefined;
      if (!format) continue;
      if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.download_count) || asset.download_count < 0 || typeof release.tag_name !== 'string' || release.tag_name.length > 100) throw new Error('Invalid release asset counter.');
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      events.push({
        uuid: eventUUID(`tagify-installer-download-v1:${date}:${asset.id}`), event: 'installer_download_snapshot',
        timestamp: `${date}T00:00:00Z`, distinct_id: 'tagify-installer-github-downloads',
        properties: { schema_version: 1, sample_date: date, observed_at: now.toISOString(), repository: 'alexk218/tagify-installer',
          asset_id: asset.id, platform: format[0], format: format[1], release_version: release.tag_name,
          release_channel: release.prerelease ? 'prerelease' : 'stable', download_count: asset.download_count,
          $process_person_profile: false, $geoip_disable: true, $ip: null },
      });
    }
  }
  if (!events.length) throw new Error('No supported installer assets were found.');
  return { schemaVersion: 1, date, events };
}

export function validateSnapshot(report) {
  if (report?.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(report.date) || !Array.isArray(report.events) || !report.events.length || report.events.length > 10_000) throw new Error('Not a download snapshot.');
  const seen = new Set();
  for (const event of report.events) {
    const p = event?.properties;
    const name = p && Object.keys(assets).find(name => assets[name][0] === p.platform && assets[name][1] === p.format);
    if (!name || !['stable', 'prerelease'].includes(p.release_channel) || typeof p.observed_at !== 'string' || p.observed_at.slice(0, 10) !== report.date || seen.has(p.asset_id)) throw new Error('Invalid download snapshot event.');
    seen.add(p.asset_id);
    const expected = snapshot([{ tag_name: p.release_version, prerelease: p.release_channel === 'prerelease', assets: [{ id: p.asset_id, name, download_count: p.download_count }] }], new Date(p.observed_at)).events[0];
    // Permit only the exact, public counter schema when replaying saved artifacts.
    for (const [actual, wanted] of [[event, expected], [p, expected.properties]]) {
      if (Object.keys(actual).length !== Object.keys(wanted).length || Object.keys(wanted).some(key => key !== 'properties' && actual[key] !== wanted[key])) throw new Error('Invalid download snapshot event.');
    }
  }
  return report;
}

export async function main(args = process.argv.slice(2)) {
  const dry = args.includes('--dry-run');
  const replay = args.indexOf('--replay');
  const config = dry ? null : configuration();
  const report = replay >= 0 ? JSON.parse(await readFile(args[replay + 1], 'utf8')) : snapshot(await releases());
  validateSnapshot(report);
  const output = process.env.TAGIFY_DOWNLOAD_SNAPSHOT ?? 'installer-download-snapshot.json';
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY && replay < 0) {
    const totals = {};
    for (const event of report.events) totals[event.properties.platform] = (totals[event.properties.platform] ?? 0) + event.properties.download_count;
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Installer download snapshot — ${report.date}\n\n| Platform | Cumulative downloads |\n|---|---:|\n${Object.entries(totals).map(([platform, count]) => `| ${platform} | ${count} |`).join('\n')}\n\nThese are GitHub asset downloads, not unique people or installations. The first observation is a baseline, not downloads today.\n`);
  }
  if (!dry) await capture(report.events, config);
  console.log(`${dry ? 'Prepared only' : 'Delivered'} ${report.events.length} asset counters for ${report.date}. Snapshot: ${output}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
