import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseRymExport } from '../../src/shared/rym/rymExport.mjs';
const fixture = JSON.parse(await readFile(new URL('./fixtures/live-large-export.json', import.meta.url), 'utf8'));

test('shared validation accepts the normalized 128-release live export and all assignments', () => {
  const result = parseRymExport(fixture);
  assert.equal(result.releases.length, 128);
  assert.equal(result.releases.reduce((n, r) => n + r.tags.length, 0), 131);
  assert.equal(result.pages.length, 10);
});
for (const [name, change] of [
  ['unsupported version', v => { v.version = 99; }],
  ['unfinished export', v => { v.status = 'incomplete'; }],
  ['missing release', v => { v.releases.pop(); }],
  ['missing page', v => { v.pages.pop(); }],
  ['repeated page', v => { v.pages.push(v.pages[0]); }],
  ['wrong source count', v => { v.selectedTags[1].expected++; }],
  ['unselected assignment', v => { v.releases[0].tags.push('secret'); }],
  ['hostile release link', v => { v.releases[0].url = 'javascript:alert(1)'; }],
  ['embedded credentials', v => { v.selectedTags[0].url = v.selectedTags[0].url.replace('https://', 'https://user:password@'); }],
  ['changed identity', v => { v.releases[0].title = 'another album'; }],
  ['forged page', v => { v.pages[0].signature = '{}'; }],
]) test(`rejects ${name}`, () => {
  const value = structuredClone(fixture); change(value);
  assert.throws(() => parseRymExport(value));
});

test('incomplete progress is accepted only for resume and checked for internal consistency', () => {
  const value = structuredClone(fixture);
  value.status = 'incomplete'; value.error = 'Cancelled.';
  assert.equal(parseRymExport(value, { requireComplete: false }).status, 'incomplete');
  value.pages.pop();
  assert.throws(() => parseRymExport(value, { requireComplete: false }));
});

test('compact releases without pages are accepted only when complete and consistent', () => {
  const compact = { ...parseRymExport(fixture), pages: [] };
  const result = parseRymExport(structuredClone(compact), { compact: true });
  assert.equal(result.releases.length, 128);
  assert.deepEqual(result.pages, []);
  assert.throws(() => parseRymExport(structuredClone(compact)));
  assert.throws(() => parseRymExport(structuredClone(fixture), { compact: true }));
  for (const change of [
    v => { v.status = 'incomplete'; },
    v => { v.releases.pop(); },
    v => { v.selectedTags[1].expected++; },
    v => { v.releases[0].tags.push('secret'); },
    v => { v.releases[0].url = 'javascript:alert(1)'; },
  ]) {
    const value = structuredClone(compact); change(value);
    assert.throws(() => parseRymExport(value, { compact: true, requireComplete: false }));
  }
});
