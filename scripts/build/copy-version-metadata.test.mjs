import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCustomAppDirectory } from './copy-version-metadata.cjs';

const script = fileURLToPath(new URL('./copy-version-metadata.cjs', import.meta.url));
const missingSpicetify = () => { throw Object.assign(new Error('spawn spicetify ENOENT'), { code: 'ENOENT' }); };

test('installs beside the config that `spicetify -c` reports', () => {
  const resolved = resolveCustomAppDirectory({ nameId: 'tagify', readConfigPath: () => '/repro/spicetify/config-xpui.ini\n' });
  assert.deepEqual(resolved, { directory: join('/repro/spicetify', 'CustomApps', 'tagify'), usedFallback: false });
});

test('falls back to the default Spicetify folder only when spicetify is missing', () => {
  assert.deepEqual(resolveCustomAppDirectory({ nameId: 'tagify', readConfigPath: missingSpicetify, os: 'darwin', home: '/Users/me' }), { directory: join('/Users/me', '.config', 'spicetify', 'CustomApps', 'tagify'), usedFallback: true });
  assert.deepEqual(resolveCustomAppDirectory({ nameId: 'tagify', readConfigPath: missingSpicetify, os: 'win32', home: 'C:/Users/me' }), { directory: join('C:/Users/me', 'AppData', 'Roaming', 'spicetify', 'CustomApps', 'tagify'), usedFallback: true });
});

test('stops instead of guessing when spicetify fails or prints nothing', () => {
  const failing = () => { throw Object.assign(new Error('Command failed: spicetify -c'), { status: 1 }); };
  assert.throws(() => resolveCustomAppDirectory({ nameId: 'tagify', readConfigPath: failing }), /Command failed/);
  assert.throws(() => resolveCustomAppDirectory({ nameId: 'tagify', readConfigPath: () => '  \n' }), /did not print a config path/);
});

test('copies package.json into the SPICETIFY_CONFIG install, not the default one', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'tagify-version-metadata-'));
  try {
    const bin = join(root, 'bin');
    const home = join(root, 'home');
    const config = join(root, 'repro-config');
    const defaultApp = join(home, '.config', 'spicetify', 'CustomApps', 'tagify');
    const reproApp = join(config, 'CustomApps', 'tagify');
    for (const directory of [bin, defaultApp, reproApp]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(bin, 'spicetify'), '#!/bin/sh\necho "$SPICETIFY_CONFIG/config-xpui.ini"\n');
    chmodSync(join(bin, 'spicetify'), 0o755);

    execFileSync(process.execPath, [script], { env: { PATH: bin, HOME: home, SPICETIFY_CONFIG: config }, stdio: 'pipe' });

    assert.ok(existsSync(join(reproApp, 'package.json')));
    assert.ok(!existsSync(join(defaultApp, 'package.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
