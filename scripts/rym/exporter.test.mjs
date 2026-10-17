import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createRymExporter } from './exporter.mjs';

const origin = 'https://rateyourmusic.com';
const tag = 'é / literal';
const base = `${origin}/collection/test/stag/literal/`;
const profile = (count, second = false) => `<div id="musictag"><a href="${base}">${tag}</a><span class="tagcount">(${count})</span>${second ? '<a href="/collection/test/stag/overlap/">overlap</a><span class="tagcount">(1)</span>' : ''}</div>`;
const row = (id, second = false) => `<tr><td class="or_q_albumartist"><a class="artist">Queensrÿche</a><a class="artist">Voivod</a><a class="album" href="/release/ep/test/release-${id}/">Release ${id}</a><span class="smallgray">(1988)</span></td><td><div id="tagl${id}"><a href="${base}">${tag}</a>${second ? '<a href="/collection/test/stag/overlap/">overlap</a>' : ''}</div></td></tr>`;
const page = (ids, next = '', second = false) => `<table>${ids.map((id) => row(id, second)).join('')}</table>${next ? `<a href="${next}">&gt;&gt;</a>` : ''}`;
const make = (read) => createRymExporter({ origin, parseDocument: (html) => new JSDOM(html).window.document, read });
const ids25 = Array.from({ length: 25 }, (_, i) => i + 1);

test('reads 25+1, multiple artists, Unicode, type and literal tag names', async () => {
  const calls = [];
  const exporter = make(async (url) => {
    calls.push(url);
    return url.endsWith('/~test') ? profile(26) : url.endsWith('/2') ? page([26], `${base}1`) : page(ids25, `${base}2`);
  });
  const result = await exporter.run('test', [tag]);
  assert.equal(result.status, 'complete');
  assert.equal(result.releases.length, 26);
  assert.deepEqual(result.releases[0].artists, ['Queensrÿche', 'Voivod']);
  assert.equal(result.releases[0].year, 1988);
  assert.equal(result.releases[0].releaseType, 'ep');
  assert.deepEqual(result.releases[0].tags, [tag]);
  assert.equal(calls.length, 4);
});

test('merges overlapping releases by RYM ID without losing selected assignments', async () => {
  const exporter = make(async (url) => url.endsWith('/~test') ? profile(1, true) : page([1], '', true));
  const result = await exporter.run('test', [tag, 'overlap']);
  assert.equal(result.status, 'complete');
  assert.equal(result.releases.length, 1);
  assert.deepEqual(result.releases[0].tags, [tag, 'overlap']);
});

for (const [name, reader] of [
  ['missing page', (url) => url.endsWith('/~test') ? profile(26) : page(ids25)],
  ['repeated page contents', (url) => url.endsWith('/~test') ? profile(26) : page(ids25, `${base}2`)],
  ['authentication challenge', (url) => url.endsWith('/~test') ? profile(26) : '<title>Sign in</title>'],
  ['changed counts', (url, calls) => url.endsWith('/~test') ? profile(calls > 2 ? 2 : 1) : page([1])],
]) test(`never calls ${name} complete`, async () => {
  let calls = 0;
  const exporter = make(async (url) => reader(url, ++calls));
  const result = await exporter.run('test', [tag]);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.error);
});

test('interruption preserves progress; resume verifies earlier pages and finishes', async () => {
  const controller = new AbortController();
  const reader = async (url) => url.endsWith('/~test') ? profile(26) : url.endsWith('/2') ? page([26]) : page(ids25, `${base}2`);
  const exporter = make(reader);
  const checkpoint = await exporter.run('test', [tag], { signal: controller.signal, onProgress: () => controller.abort() });
  assert.equal(checkpoint.status, 'incomplete');
  assert.equal(checkpoint.releases.length, 25);
  const resumed = await exporter.run('test', [tag], { checkpoint });
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.releases.length, 26);
  const changed = make(async (url) => (await reader(url)).replace('Release 1<', 'Changed title<'));
  assert.equal((await changed.run('test', [tag], { checkpoint })).status, 'incomplete');
});

test('stops on a transport failure without fetching subsequent pages', async () => {
  const calls = [];
  const exporter = make(async (url) => {
    calls.push(url);
    if (url.endsWith('/~test')) return profile(26);
    if (url.endsWith('/2')) throw new Error('RYM asked you to pause.');
    return page(ids25, `${base}2`);
  });
  const result = await exporter.run('test', [tag]);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.releases.length, 25);
  assert.equal(calls.length, 3);
});

test('rejects hostile source links without making requests to another origin', () => {
  const exporter = make(() => { throw new Error('must not fetch'); });
  assert.throws(() => exporter.index(profile(1).replace(base, 'https://example.com/steal'), 'test'));
});

test('real RYM collection pages preserve all 26 releases and the overlapping tag', async () => {
  const name = 'tagify-pagination-test-20261013';
  const first = await readFile(new URL('./fixtures/page1.html', import.meta.url), 'utf8');
  const second = await readFile(new URL('./fixtures/page2.html', import.meta.url), 'utf8');
  const tagUrl = `${origin}/collection/test/stag/tagify%2dpagination%2dtest%2d20261013/`;
  const exporter = make(async (url) => url.endsWith('/~test') ? `<div id="musictag"><a href="${tagUrl}">${name}</a><span>(26)</span></div>` : url.endsWith('/2') ? second : first);
  const result = await exporter.run('test', [name]);
  assert.equal(result.status, 'complete');
  assert.equal(result.releases.length, 26);
  assert.equal(result.pages.length, 2);
  assert.equal(result.releases.at(-1).id, '17027426');
  assert.ok(result.releases.every((release) => release.tags.includes(name)));
});

test('exports 1,001 synthetic releases sequentially across 41 pages', async () => {
  let active = 0;
  let maximum = 0;
  const exporter = make(async (url) => {
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    if (url.endsWith('/~test')) return profile(1001);
    const number = Number(url.match(/\/(\d+)$/)?.[1] || 1);
    const ids = Array.from({ length: Math.min(25, 1001 - (number - 1) * 25) }, (_, i) => (number - 1) * 25 + i + 1);
    return page(ids, number < 41 ? `${base}${number + 1}` : `${base}1`);
  });
  const result = await exporter.run('test', [tag]);
  assert.equal(result.status, 'complete');
  assert.equal(result.releases.length, 1001);
  assert.equal(result.pages.length, 41);
  assert.equal(maximum, 1);
});

test('unselected personal tags are absent from both records and checkpoints', async () => {
  const exporter = make(async (url) => url.endsWith('/~test') ? profile(1, true) : page([1], '', true));
  const result = await exporter.run('test', [tag]);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.releases[0].tags, [tag]);
  assert.deepEqual(JSON.parse(result.pages[0].signature)[0].tags, [tag]);
});
