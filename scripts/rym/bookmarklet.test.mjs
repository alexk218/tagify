import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { openExporter } from './bookmarklet.mjs';
import { bookmarkletModule, bookmarkletModuleUrl } from './build-bookmarklet.mjs';
import { parseRymExport } from '../../src/shared/rym/rymExport.mjs';

function setup(exporter) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://rateyourmusic.com/~test' });
  const saved = new Map();
  for (const key of ['document', 'location', 'DOMParser', 'localStorage']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  openExporter(() => exporter, () => async () => '', parseRymExport);
  return {
    doc: dom.window.document,
    button: (label) => [...dom.window.document.querySelectorAll('button')].find((item) => item.textContent === label),
    dispose() {
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}
const tags = [{ name: '<b>literal / tag</b>', expected: 101 }];

test('literal names, accessible labels, empty state and Escape dismissal', () => {
  const ui = setup({ index: () => tags });
  try {
    assert.equal(ui.doc.querySelectorAll('b').length, 0);
    assert.equal(ui.doc.querySelector('input[type=checkbox]').value, tags[0].name);
    assert.equal(ui.doc.querySelector('dialog').getAttribute('aria-labelledby'), ui.doc.querySelector('h2').id);
    assert.equal(ui.doc.querySelector('legend').textContent, 'Tags to export');
    assert.equal(ui.button('Start fresh').hidden, true);
    ui.doc.querySelector('dialog').dispatchEvent(new ui.doc.defaultView.Event('cancel'));
    assert.equal(ui.doc.querySelector('dialog'), null);
  } finally { ui.dispose(); }
  const empty = setup({ index: () => [] });
  try {
    assert.equal(empty.button('Start export').disabled, true);
    assert.match(empty.doc.querySelector('[role=status]').textContent, /No personal tags/);
  } finally { empty.dispose(); }
});

test('count-change recovery clears loaded progress without deleting downloaded files', async () => {
  const calls = [];
  const ui = setup({ index: () => tags, run: async (_account, _names, options) => {
    calls.push(options.checkpoint);
    const result = { status: options.checkpoint ? 'incomplete' : 'complete', releases: [], selectedTags: [],
      error: options.checkpoint ? 'The collection or selected tags changed. Start a new export.' : null };
    options.onProgress(result);
    return result;
  } });
  try {
    const input = ui.doc.querySelector('input[type=file]');
    const checkpoint = { format: 'tagify-rym-personal-tags', version: 1, account: 'test', status: 'incomplete', error: 'Cancelled.', releases: [], selectedTags: [{ name: tags[0].name, url: 'https://rateyourmusic.com/collection/test/stag/test/', expected: 7, collected: 0 }], pages: [] };
    Object.defineProperty(input, 'files', { value: [{ size: 100, text: async () => JSON.stringify(checkpoint) }] });
    await input.onchange();
    assert.equal(ui.button('Start fresh').hidden, false);
    await ui.button('Start export').onclick();
    assert.equal(ui.button('Download export').disabled, true);
    assert.match(ui.doc.querySelector('[role=status]').textContent, /changed/);
    ui.button('Start fresh').click();
    assert.match(ui.doc.querySelector('[role=status]').textContent, /downloaded progress files are kept/);
    await ui.button('Start export').onclick();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], checkpoint);
    assert.equal(calls[1], null);
    assert.equal(ui.button('Download export').disabled, false);
  } finally { ui.dispose(); }
});

test('the shared bookmarklet module matches the current exporter', async () => {
  assert.equal(await readFile(bookmarkletModuleUrl, 'utf8'), bookmarkletModule(),
    'Run node scripts/rym/build-bookmarklet.mjs and commit src/shared/rym/bookmarklet.generated.ts.');
});
