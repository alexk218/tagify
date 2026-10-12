import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { dashboard } from './dashboard.mjs';

// Read-only query fixtures: execute these SQL queries, never capture them as events.
const columns = ['event', 'distinct_id', 'timestamp', 'platform', 'asset_id', 'download_count', 'operation_id', 'operation', 'outcome', 'duration_seconds', 'failure_reason', 'installer_version', 'spotify_version', 'spicetify_version', 'spicetify_source'];
const row = (event, values = {}) => ({ event, distinct_id: 'installation-a', timestamp: 0, platform: 'macos', ...values });
const literal = value => typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
function fixture(id, rows, expected) {
  const source = rows.map(r => 'SELECT ' + columns.map(k => {
    const value = k === 'timestamp' ? `now() - INTERVAL ${r[k]} DAY` : literal(r[k] ?? (['duration_seconds', 'download_count'].includes(k) ? 0 : ''));
    return `${value} AS ${['event', 'distinct_id', 'timestamp'].includes(k) ? k : `fixture_${k}`}`;
  }).join(', ')).join(' UNION ALL ');
  const query = dashboard.tiles.find(t => t.id === id).query.source.query
    .replaceAll('FROM events', `FROM (${source})`)
    .replace(/properties\.([a-z_]+)/g, 'fixture_$1');
  return { id, query, expected };
}
const operation = (id, result, values = {}) => [
  row('installer_operation_started', { operation_id: id, operation: 'repair', ...values }),
  ...(result ? [row('installer_operation_finished', { operation_id: id, operation: 'repair', outcome: result, duration_seconds: 10, ...values })] : []),
];
const attempts = [
  ...operation('success', 'success'), ...operation('failure', 'failure', { failure_reason: 'network' }),
  ...operation('cancelled', 'cancelled'), ...operation('unknown', null),
  // Duplicate delivery is not another attempt. An orphan finish is not a matched success.
  ...operation('success', 'success'),
  row('installer_operation_finished', { operation_id: 'orphan', operation: 'repair', outcome: 'success', duration_seconds: 20 }),
];
export const fixtures = [
  fixture('outcomes', attempts, [['repair', 'macos', 4, 1, 1, 1, 1, 25]]),
  fixture('failures', attempts, [['repair', 'network', 'macos', 1, 1]]),
  fixture('repeat-repairs', attempts, [['macos', 1, 1]]),
  fixture('duration', [...operation('short', 'success'), ...operation('long', 'success', { duration_seconds: 30 }), ...operation('short', 'success')], [['repair', 'macos', 20, 29]]),
  fixture('returning', [row('installer_opened'), row('installer_opened', { timestamp: 2 }), row('installer_opened', { timestamp: 2 }), row('installer_opened', { timestamp: 10, distinct_id: 'installation-b' })], [['macos', 2, 1, 1]]),
  fixture('versions', [row('installer_opened', { timestamp: 2, installer_version: 'old' }), row('installer_opened', { installer_version: 'new' }), row('installer_opened', { installer_version: 'new' })], [['macos', 'new', '', '', '', 1]]),
  fixture('download-totals', [row('installer_download_snapshot', { asset_id: 'a', download_count: 10, timestamp: 2 }), row('installer_download_snapshot', { asset_id: 'a', download_count: 14 }), row('installer_download_snapshot', { asset_id: 'a', download_count: 14 }), row('installer_download_snapshot', { asset_id: 'deleted', download_count: 3, timestamp: 2 })], [['macos', 17]]),
  fixture('download-changes', [row('installer_download_snapshot', { asset_id: 'a', download_count: 10, timestamp: 4 }), row('installer_download_snapshot', { asset_id: 'a', download_count: 14, timestamp: 3 }), row('installer_download_snapshot', { asset_id: 'a', download_count: 20, timestamp: 1 }), row('installer_download_snapshot', { asset_id: 'a', download_count: 3 }), row('installer_download_snapshot', { asset_id: 'new', download_count: 100 })], 'Three intervals: yesterday→today NULL/reset 1; three days ago→yesterday 6/reset 0; four→three days ago 4/reset 0. New asset excluded.'),
];
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(process.argv[2] ?? '/tmp/tagify-dashboard-query-fixtures.json', JSON.stringify(fixtures, null, 2) + '\n');
  console.log('Read-only SQL fixtures exported; no events sent.');
}
