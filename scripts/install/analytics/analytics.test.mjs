import test from 'node:test';
import assert from 'node:assert/strict';
import { releases, snapshot, validateSnapshot } from './download-report.mjs';
import { configuration, capture, eventUUID } from './posthog.mjs';
import { dashboard, provision } from './dashboard.mjs';

const config = { token: 'phc_test', host: 'https://us.i.posthog.com' };
const release = (id = 1, count = 10, name = 'TagifyInstaller-mac.dmg') => ({ tag_name: 'v1.0.0', draft: false, prerelease: false, assets: [{ id, name, download_count: count }] });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('release counters distinguish platforms and formats, exclude drafts and checksum files', () => {
  const report = snapshot([release(), release(2, 20, 'TagifyInstaller.exe'), release(3, 3, 'Tagify.pkg'), release(4, 999, 'SHA256SUMS'), { ...release(5), draft: true }, { ...release(6), prerelease: true }, release()], new Date('2026-10-11T13:23:00Z'));
  assert.equal(report.events.length, 4);
  assert.deepEqual(report.events.map(e => e.properties.platform), ['macos', 'windows', 'macos', 'macos']);
  assert.equal(report.events[3].properties.release_channel, 'prerelease');
  assert.equal(report.events[0].properties.download_count, 10);
  assert.equal(report.events[0].timestamp, '2026-10-11T00:00:00Z');
  assert.equal(report.events[0].properties.$process_person_profile, false);
  assert.equal(report.events[0].properties.$ip, null);
});
test('same-day retries preserve event identity; the next day and replaced assets are distinct', () => {
  const a = snapshot([release()], new Date('2026-10-11T01:00Z')).events[0];
  assert.equal(a.uuid, snapshot([release()], new Date('2026-10-11T23:59Z')).events[0].uuid);
  assert.notEqual(a.uuid, snapshot([release()], new Date('2026-10-12T01:00Z')).events[0].uuid);
  assert.notEqual(a.uuid, snapshot([release(2)], new Date('2026-10-11T01:00Z')).events[0].uuid);
  assert.match(eventUUID('test'), /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
});
test('replay accepts exact snapshots and rejects altered, duplicate or private data', () => {
  const report = snapshot([release()]);
  assert.equal(validateSnapshot(report), report);
  const mutations = [
    r => { r.events[0].properties.private_log = 'secret'; },
    r => { r.events[0].distinct_id = 'personal-identity'; },
    r => { r.events[0].properties.download_count = -1; },
    r => { r.events[0].uuid = eventUUID('different'); },
    r => { r.events[0].properties.sample_date = '2020-01-01'; },
    r => { r.events[0].properties.$ip = '1.2.3.4'; },
    r => { r.events.push(r.events[0]); },
    r => { r.events = []; },
  ];
  for (const mutate of mutations) { const altered = structuredClone(report); mutate(altered); assert.throws(() => validateSnapshot(altered)); }
  assert.throws(() => snapshot([release(1, 1, '__proto__')]), /No supported/);
});
test('missing and invalid counters fail instead of producing a false zero', () => {
  for (const count of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    const row = release(); row.assets[0].download_count = count;
    assert.throws(() => snapshot([row]));
  }
  assert.throws(() => snapshot([]), /No supported/);
});
test('release pagination fetches every page and does not swallow partial failures', async () => {
  const calls = [];
  const rows = await releases(async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error');
    return response(calls.length === 1 ? Array.from({ length: 100 }, (_, i) => release(i + 1)) : [release(101)]);
  });
  assert.equal(rows.length, 101); assert.match(calls[1], /page=2$/);
  let page = 0;
  await assert.rejects(releases(async () => ++page === 1 ? response(Array(100).fill(release())) : response({}, 403)), /No partial snapshot/);
  await assert.rejects(releases(async () => response({ message: 'bad' })), /invalid release/);
});
test('configuration rejects privileged keys and untrusted origins', () => {
  assert.deepEqual(configuration({ TAGIFY_POSTHOG_TOKEN: config.token, TAGIFY_POSTHOG_HOST: config.host }), config);
  for (const token of ['', 'phx_secret', 'phc_test\n', 'phc_test/path']) assert.throws(() => configuration({ TAGIFY_POSTHOG_TOKEN: token, TAGIFY_POSTHOG_HOST: config.host }));
  for (const host of ['http://us.i.posthog.com', 'https://evil.test', 'https://us.i.posthog.com/path']) assert.throws(() => configuration({ TAGIFY_POSTHOG_TOKEN: config.token, TAGIFY_POSTHOG_HOST: host }));
});
test('capture retries the identical payload after quota, network and rate-limit failures', async () => {
  const bodies = [], waits = [];
  await capture(snapshot([release()]).events, config, async (_url, options) => {
    bodies.push(options.body); assert.equal(options.redirect, 'error');
    if (bodies.length === 1) throw new Error('offline');
    if (bodies.length === 2) return response({ status: 1, quota_limited: ['events'] });
    return response({ status: 1 });
  }, async ms => waits.push(ms));
  assert.equal(new Set(bodies).size, 1); assert.deepEqual(waits, [1000, 2000]);
  let attempts = 0;
  await capture([], config, async () => { throw new Error('empty batch must not send'); });
  await assert.rejects(capture([{}], config, async () => { attempts++; return response({}, 400); }, async () => {}), /did not acknowledge/);
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(capture([{}], config, async () => { attempts++; return response({}, 429); }, async () => {}));
  assert.equal(attempts, 3);
});
test('capture limits each batch and refuses a malformed success response', async () => {
  const sizes = [];
  await capture(Array(101).fill({}), config, async (_url, options) => { sizes.push(JSON.parse(options.body).batch.length); return response({ status: 1 }); });
  assert.deepEqual(sizes, [50, 50, 1]);
  await assert.rejects(capture([{}], config, async () => response({}), async () => {}));
});

test('capture accepts both provider acknowledgements and retains rejected events', async () => {
  for (const status of [1, 'Ok']) await capture([{}], config, async () => response({ status }), async () => {});
  for (const body of [null, {}, { status: 'Error' }, { status: 'Ok', quota_limited: ['events'] }]) {
    await assert.rejects(capture([{}], config, async () => response(body), async () => {}), /did not acknowledge/);
  }
  await assert.rejects(capture([{}], config, async () => response({ status: 'Ok' }, 429), async () => {}));
});

const account = { host: 'https://us.posthog.com', project: '123', key: 'test-personal-key' };
test('dashboard validates queries before creating anything', async () => {
  const calls = [];
  await assert.rejects(provision(account, async (url, options) => { calls.push(String(url)); assert.equal(options.redirect, 'error'); return response({}, 400); }), /failed/);
  assert.equal(calls.length, 1); assert.match(calls[0], /query\/$/);
});
test('dashboard creation and rerun update the same managed insights', async () => {
  let board = null; const insights = []; const verbs = [];
  const request = async (url, options) => {
    const path = new URL(url).pathname; verbs.push([options.method, path]);
    if (path.endsWith('/query/')) return response({ results: [] });
    const data = options.body && JSON.parse(options.body);
    if (path.endsWith('/dashboards/')) {
      if (options.method === 'GET') return response({ results: board ? [board] : [], next: null });
      board = { id: 77, ...data }; return response(board);
    }
    if (path.endsWith('/insights/')) {
      if (options.method === 'GET') {
        assert.equal(new URL(url).searchParams.get('include_dashboards'), 'true');
        return response({ results: insights, next: null });
      }
      const insight = { id: insights.length + 1, ...data }; insights.push(insight); return response(insight);
    }
    assert.equal(options.method, 'PATCH');
    const insight = insights.find(i => path.endsWith(`/insights/${i.id}/`));
    Object.assign(insight, data); return response(insight);
  };
  assert.equal(await provision(account, request), 'https://us.posthog.com/project/123/dashboard/77');
  assert.equal(insights.length, dashboard.tiles.length);
  insights[0].dashboards.push(99);
  verbs.length = 0;
  await provision(account, request);
  assert.equal(insights.length, dashboard.tiles.length);
  assert.ok(!verbs.some(([method, path]) => method === 'POST' && !path.endsWith('/query/')));
  assert.deepEqual(insights[0].dashboards, [77, 99]);
});
test('dashboard refuses pagination outside the authorized project', async () => {
  let escaped = false;
  await assert.rejects(provision(account, async url => {
    if (!String(url).startsWith('https://us.posthog.com/api/projects/123/')) escaped = true;
    return response(String(url).includes('/query/') ? {} : { results: [], next: 'https://evil.test/steal-key' });
  }), /unexpected API destination/);
  assert.equal(escaped, false);
});
