import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRymReader } from './reader.mjs';

const origin = 'https://rateyourmusic.com';
function setup(response) {
  const values = new Map();
  const calls = [];
  let time = 1800000000000;
  const environment = { origin, now: () => time,
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    parseDocument: (html) => new JSDOM(html).window.document,
    pause: async (ms) => { time += ms; },
    fetchPage: async (...args) => { calls.push({ args, time }); return response; },
  };
  return { environment, calls, values, advance: (ms) => { time += ms; } };
}
const response = (status, html = '<title>RYM</title>', retry = null) => ({
  status, ok: status === 200, text: async () => html, headers: { get: () => retry },
});

test('spaces requests and uses only same-origin credentials without redirects', async () => {
  const context = setup(response(200));
  const read = createRymReader(context.environment);
  await read(`${origin}/~test`);
  await read(`${origin}/collection/test/`);
  assert.equal(context.calls[1].time - context.calls[0].time, 1500);
  assert.equal(context.calls[0].args[1].credentials, 'same-origin');
  assert.equal(context.calls[0].args[1].redirect, 'error');
  await assert.rejects(read('https://example.com/'), /Unexpected/);
  assert.equal(context.calls.length, 2);
});

for (const retry of ['60', new Date(1800000060000).toUTCString(), null]) {
  test(`429 persists its pause across reopening (${retry ?? 'no header'})`, async () => {
    const context = setup(response(429, '', retry));
    const read = createRymReader(context.environment);
    await assert.rejects(read(`${origin}/~test`), /pause/);
    await assert.rejects(read(`${origin}/~test`), /pause/);
    await assert.rejects(createRymReader(context.environment)(`${origin}/~test`), /pause/);
    assert.equal(context.calls.length, 1);
    context.advance(retry === null ? 900001 : 60001);
    context.environment.fetchPage = async () => response(200);
    assert.equal(await createRymReader(context.environment)(`${origin}/~test`), '<title>RYM</title>');
  });
}

for (const value of [response(401), response(403), response(200, '<title>Just a moment</title>'), response(200, '<form action="/login"></form>')]) {
  test(`authentication/challenge stops this reader (${value.status})`, async () => {
    const context = setup(value);
    const read = createRymReader(context.environment);
    await assert.rejects(read(`${origin}/~test`), /check/);
    await assert.rejects(read(`${origin}/~test`), /check/);
    assert.equal(context.calls.length, 1);
  });
}

test('cancellation and unreadable pause storage stop before dispatch', async () => {
  const context = setup(response(200));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createRymReader(context.environment)(`${origin}/~test`, controller.signal), /Cancelled/);
  context.environment.storage.getItem = () => { throw new Error('blocked'); };
  await assert.rejects(createRymReader(context.environment)(`${origin}/~test`), /site storage/);
  assert.equal(context.calls.length, 0);
});
