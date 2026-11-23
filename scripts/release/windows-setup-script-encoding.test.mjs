import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Windows users update with `iwr -useb <raw URL> | iex` (the in-app update banner shows this command).
// Invoke-Expression in Windows PowerShell 5.1 keeps a UTF-8 byte order mark as a character, so the
// opening `<#` is no longer a comment and the help text is parsed as code ("The ampersand (&)
// character is not allowed"). Without a BOM, 5.1 reads a saved .ps1 as the ANSI code page, so any
// non-ASCII character would be garbled. Plain ASCII works for both.
const installDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'install');
const scripts = readdirSync(installDir).filter((name) => name.endsWith('.ps1'));

test('Windows setup scripts exist', () => {
  assert.ok(scripts.includes('Install-Tagify-Full.ps1'));
});

for (const name of scripts) {
  test(`${name} has no byte order mark and is plain ASCII`, () => {
    const bytes = readFileSync(join(installDir, name));
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'starts with a UTF-8 byte order mark');
    const lines = bytes.toString('latin1').split('\n');
    const offending = lines.flatMap((line, index) => (/[^\x00-\x7f]/.test(line) ? [`line ${index + 1}: ${line.trim()}`] : []));
    assert.deepEqual(offending, [], 'contains non-ASCII characters');
  });
}
