import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnvironment } from './spicetify-creator.cjs';

const script = fileURLToPath(new URL('./spicetify-creator.cjs', import.meta.url));
const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

function writeApp(root, marker) {
  const src = join(root, 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'settings.json'), JSON.stringify({ displayName: marker, nameId: 'tagify', icon: 'icon.svg', activeIcon: 'icon.svg' }));
  writeFileSync(join(src, 'icon.svg'), '<svg/>');
  writeFileSync(join(src, 'app.tsx'), `import React from "react";\nexport default function App() { return <div>${marker}</div>; }\n`);
  return src;
}

async function waitFor(check, timeout = 30_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('points every temporary-directory variable at the run’s own folder', () => {
  const env = isolatedEnvironment('/tmp/tagify-build-x', { PATH: '/bin', TMPDIR: '/shared' });
  assert.deepEqual(env, { PATH: '/bin', TMPDIR: '/tmp/tagify-build-x', TMP: '/tmp/tagify-build-x', TEMP: '/tmp/tagify-build-x' });
});

test('a build in one checkout does not rebuild another checkout’s watch', { skip: process.platform === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'tagify-isolated-build-'));
  const shared = join(root, 'shared-tmp');
  mkdirSync(shared);
  const env = { ...process.env, TMPDIR: shared };
  const watchOut = join(root, 'watch-out');
  const watcher = spawn(process.execPath, [script, '--watch', '--in', writeApp(join(root, 'watched'), 'WATCHED_APP'), '--out', watchOut], { cwd: packageRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  watcher.stdout.on('data', (chunk) => { log += chunk; });
  try {
    await waitFor(() => log.includes('Build succeeded'));
    execFileSync(process.execPath, [script, '--in', writeApp(join(root, 'other'), 'OTHER_APP'), '--out', join(root, 'other-out')], { cwd: packageRoot, env, stdio: 'ignore' });
    assert.match(readFileSync(join(root, 'other-out', 'index.js'), 'utf8'), /OTHER_APP/);
    // Give the watcher time to notice a changed entry file, as it would without isolation.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const watched = readFileSync(join(watchOut, 'index.js'), 'utf8');
    assert.match(watched, /WATCHED_APP/);
    assert.doesNotMatch(watched, /OTHER_APP/);
  } finally {
    watcher.kill('SIGTERM');
    await new Promise((resolve) => watcher.once('exit', resolve));
    assert.deepEqual(readdirSync(shared), [], 'each run removes its temporary folder');
    rmSync(root, { recursive: true, force: true });
  }
});

test('passes the build’s exit status through', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'tagify-isolated-build-'));
  try {
    assert.throws(() => execFileSync(process.execPath, [script, '--in', join(root, 'missing'), '--out', join(root, 'out')], { cwd: packageRoot, stdio: 'ignore' }), (error) => error.status !== 0);
    assert.equal(existsSync(join(root, 'out', 'index.js')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
