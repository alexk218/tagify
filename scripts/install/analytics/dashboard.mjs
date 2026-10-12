import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';

const tag = 'tagify-installer-analytics-v1';
const events = `event LIKE 'installer_%' AND event != 'installer_download_snapshot' AND timestamp >= now() - INTERVAL 30 DAY`;
const operationRows = `SELECT properties.operation_id AS operation_id, any(properties.operation) AS operation,
  any(properties.platform) AS platform, any(distinct_id) AS installation,
  countIf(event = 'installer_operation_started') > 0 AS started,
  countIf(event = 'installer_operation_finished' AND properties.outcome = 'success') > 0 AS succeeded,
  countIf(event = 'installer_operation_finished' AND properties.outcome = 'failure') > 0 AS failed,
  countIf(event = 'installer_operation_finished' AND properties.outcome = 'cancelled') > 0 AS cancelled
  FROM events WHERE ${events} AND properties.operation_id IS NOT NULL GROUP BY operation_id`;
function table(id, name, description, query) {
  return { id, name, description, query: { kind: 'DataVisualizationNode', display: 'ActionsTable', source: { kind: 'HogQLQuery', query } } };
}
function trend(id, name, description, event, properties = []) {
  return { id, name, description, query: { kind: 'InsightVizNode', source: {
    kind: 'TrendsQuery', dateRange: { date_from: '-30d' }, interval: 'day',
    series: [{ kind: 'EventsNode', event, name: event, math: 'dau', properties }],
    breakdownFilter: { breakdowns: [{ property: 'platform', type: 'event' }] }, trendsFilter: { display: 'ActionsLineGraph' },
  } } };
}
export const dashboard = {
  name: 'Tagify Installer — Downloads & Reliability',
  description: `${tag}. Download counters cover Mac and Windows. In-app statistics cover consenting Mac installations only until Windows tracking ships. Installations are not people. First observed opens may be existing installations. Outcomes confirm installer checks, not use inside Spotify. No download-to-launch identity matching. Tables use the last 30 days unless their title says otherwise.`,
  tiles: [
    table('download-totals', 'Latest observed downloads — all releases', 'Cumulative GitHub asset downloads, not unique people. Includes repeat downloads and automated traffic. Removed assets retain their last observed total.',
      `SELECT platform, sum(downloads) AS downloads FROM (SELECT properties.asset_id AS asset, argMax(properties.platform, timestamp) AS platform, argMax(toInt(properties.download_count), timestamp) AS downloads FROM events WHERE event = 'installer_download_snapshot' GROUP BY asset) GROUP BY platform`),
    table('download-changes', 'Downloads between observations — last 30 days', 'First observation is a baseline. A gap spans the whole interval; it is not assigned to a single day. Counter decreases are shown as unknown. Files replaced on GitHub have new asset IDs.',
      `SELECT previous_date AS interval_start, sample_date AS interval_end, platform, if(countIf(cumulative_downloads < previous_count) > 0, NULL, sum(cumulative_downloads - previous_count)) AS new_downloads, countIf(cumulative_downloads < previous_count) AS counter_resets FROM (
        SELECT asset, platform, sample_date, cumulative_downloads,
        lagInFrame(sample_date) OVER (PARTITION BY asset ORDER BY sample_date ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS previous_date,
        lagInFrame(cumulative_downloads) OVER (PARTITION BY asset ORDER BY sample_date ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS previous_count
        FROM (SELECT properties.asset_id AS asset, properties.platform AS platform, toDate(timestamp) AS sample_date, max(toInt(properties.download_count)) AS cumulative_downloads FROM events WHERE event = 'installer_download_snapshot' GROUP BY asset, platform, sample_date)
      ) WHERE previous_date > toDate('1970-01-01') AND sample_date >= today() - INTERVAL 30 DAY GROUP BY interval_start, interval_end, platform ORDER BY interval_end DESC`),
    trend('first-seen', 'First observed manager opens', 'New analytics identities, not necessarily new installs. Analytics begins only after consent.', 'installer_opened', [{ key: 'first_observed_open', value: 'true', operator: 'exact', type: 'event' }]),
    trend('activation', 'Successful first-time setup installations', 'Distinct participating installations with a verified fresh-install success that day. Excludes updates and repairs.', 'installer_operation_finished', [
      { key: 'operation', value: 'install', operator: 'exact', type: 'event' }, { key: 'outcome', value: 'success', operator: 'exact', type: 'event' },
    ]),
    table('outcomes', 'Install, update and repair outcomes', 'Success rate divides matched successful operations by all observed starts. Missing finishes stay unknown; they are not assumed failures. Every retry is a new operation.',
      `SELECT operation, platform, countIf(started) AS starts, countIf(started AND succeeded) AS successes, countIf(started AND failed) AS failures, countIf(started AND cancelled) AS cancellations, countIf(started AND NOT succeeded AND NOT failed AND NOT cancelled) AS unknown, round(100.0 * countIf(started AND succeeded) / nullIf(countIf(started), 0), 1) AS success_percent FROM (${operationRows}) GROUP BY operation, platform ORDER BY starts DESC`),
    table('failures', 'Most common failure reasons', 'Standardized reasons only. No raw errors, logs, paths or account data.',
      `SELECT properties.operation AS operation, properties.failure_reason AS reason, properties.platform AS platform, uniqExact(properties.operation_id) AS attempts, uniqExact(distinct_id) AS installations FROM events WHERE ${events} AND event = 'installer_operation_finished' AND properties.outcome = 'failure' GROUP BY operation, reason, platform ORDER BY attempts DESC`),
    table('duration', 'Successful setup duration', 'Seconds; median and 95th percentile. Failed attempts are excluded.',
      `SELECT operation, platform, quantile(0.5)(duration) AS median_seconds, quantile(0.95)(duration) AS p95_seconds FROM (SELECT properties.operation_id AS operation_id, any(properties.operation) AS operation, any(properties.platform) AS platform, max(toFloat(properties.duration_seconds)) AS duration FROM events WHERE ${events} AND event = 'installer_operation_finished' AND properties.outcome = 'success' AND properties.operation_id IS NOT NULL GROUP BY operation_id) GROUP BY operation, platform`),
    trend('active', 'Daily active manager installations', 'Distinct participating installation IDs opening the manager. This does not measure Tagify or Spotify activity.', 'installer_opened'),
    table('returning', 'Active and returning manager installations — 7 / 30 days', 'Returning means opened on at least two distinct UTC days in the last 30 days. Clearing the local identity starts a new installation record.',
      `SELECT platform, count() AS active_30_days, countIf(last_open >= now() - INTERVAL 7 DAY) AS active_7_days, countIf(days >= 2) AS returning_30_days FROM (SELECT distinct_id, properties.platform AS platform, uniqExact(toDate(timestamp)) AS days, max(timestamp) AS last_open FROM events WHERE ${events} AND event = 'installer_opened' GROUP BY distinct_id, platform) GROUP BY platform`),
    table('repeat-repairs', 'Installations needing repeated repairs', 'Two or more repair attempts in 30 days; a maintenance signal, not engagement success.',
      `SELECT platform, count() AS repaired_installations, countIf(attempts >= 2) AS repeat_repairs FROM (SELECT platform, installation, countIf(started AND operation = 'repair') AS attempts FROM (${operationRows}) GROUP BY platform, installation HAVING attempts > 0) GROUP BY platform`),
    table('versions', 'Observed version combinations', 'Latest observed manager-open configuration per installation in 30 days; not the entire installed population.',
      `SELECT platform, manager, spotify, spicetify, source, count() AS installations FROM (SELECT distinct_id, argMax(properties.platform, timestamp) AS platform, argMax(properties.installer_version, timestamp) AS manager, argMax(properties.spotify_version, timestamp) AS spotify, argMax(properties.spicetify_version, timestamp) AS spicetify, argMax(properties.spicetify_source, timestamp) AS source FROM events WHERE ${events} AND event = 'installer_opened' GROUP BY distinct_id) GROUP BY platform, manager, spotify, spicetify, source ORDER BY installations DESC`),
    table('report-health', 'Download reporting freshness', 'A missing or old sample signals a reporting problem, not zero downloads.',
      `SELECT if(count() = 0, NULL, max(timestamp)) AS latest_sample, uniqExact(properties.asset_id) AS observed_assets FROM events WHERE event = 'installer_download_snapshot'`),
  ],
};

export async function provision({ host, project, key }, request = fetch) {
  if (!['https://us.posthog.com', 'https://eu.posthog.com'].includes(host) || !/^\d+$/.test(project) || !key) throw new Error('Set POSTHOG_APP_HOST, POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY.');
  const prefix = `${host}/api/projects/${project}/`;
  async function api(path, method = 'GET', data) {
    const url = new URL(path, prefix);
    if (!url.href.startsWith(prefix)) throw new Error('Refusing an unexpected API destination.');
    const response = await request(url, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}), redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`PostHog ${method} ${url.pathname} failed (${response.status}).`);
    return response.json();
  }
  async function list(path) {
    const rows = [];
    let next = path;
    for (let page = 0; next && page < 100; page++) {
      const result = await api(next); rows.push(...result.results); next = result.next;
    }
    if (next) throw new Error('PostHog pagination exceeded its safety limit.');
    return rows;
  }
  // Validate every query before creating or updating any dashboard.
  for (const tile of dashboard.tiles) await api('query/', 'POST', { query: tile.query.source });
  const matches = (await list('dashboards/?limit=100')).filter(d => !d.deleted && d.description?.startsWith(tag + '.'));
  if (matches.length > 1) throw new Error('Multiple managed dashboards found. Select the intended dashboard before continuing.');
  const existing = await list('insights/?limit=100&include_dashboards=true');
  for (const tile of dashboard.tiles) {
    if (existing.filter(i => !i.deleted && i.tags?.includes(`${tag}:${tile.id}`)).length > 1) throw new Error(`Multiple managed insights found for ${tile.id}.`);
  }
  const board = matches[0] ?? await api('dashboards/', 'POST', { name: dashboard.name, description: dashboard.description, pinned: true });
  for (const [order, tile] of dashboard.tiles.entries()) {
    const marker = `${tag}:${tile.id}`;
    const matches = existing.filter(i => !i.deleted && i.tags?.includes(marker));
    if (matches.length > 1) throw new Error(`Multiple managed insights found for ${tile.id}.`);
    const insight = matches[0];
    const data = { name: tile.name, description: tile.description, query: tile.query, tags: [...new Set([...(insight?.tags ?? []), tag, marker])], dashboards: [...new Set([...(insight?.dashboards ?? []), board.id])], order };
    await api(insight ? `insights/${insight.id}/` : 'insights/', insight ? 'PATCH' : 'POST', data);
  }
  return `${host}/project/${project}/dashboard/${board.id}`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv.includes('--apply')
    ? provision({ host: process.env.POSTHOG_APP_HOST, project: process.env.POSTHOG_PROJECT_ID, key: process.env.POSTHOG_PERSONAL_API_KEY }).then(console.log)
    : writeFile(process.argv[2] ?? '/tmp/tagify-installer-dashboard.json', JSON.stringify(dashboard, null, 2) + '\n').then(() => console.log('Dashboard definition exported; no account changes made. Use --apply to provision.'));
  run.catch(error => { console.error(error.message); process.exitCode = 1; });
}
