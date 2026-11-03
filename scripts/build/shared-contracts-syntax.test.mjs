import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tagify bundles the shared contract packages with spicetify-creator's own esbuild (0.14), which
// predates newer TypeScript syntax such as `satisfies`. Community builds the same files with
// Next.js and accepts that syntax, so a contract change can pass every test and still stop the
// Tagify build. Parse each shipped contract file with the esbuild the build uses.
const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const requireFromApp = createRequire(join(packageRoot, 'package.json'));
const esbuild = createRequire(requireFromApp.resolve('spicetify-creator/package.json'))('esbuild');
// The monorepo keeps the contracts beside the app; the public repository ships them in vendor/.
const contractSources = ['tagify-sync-contracts', 'tagify-community-contracts'].map((name) => {
  const sibling = join(packageRoot, '..', name, 'src');
  return existsSync(sibling) ? sibling : join(packageRoot, 'vendor', name, 'src');
});

function shippedFiles(directory) {
  return readdirSync(directory, { recursive: true })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => join(directory, file));
}

test('the shared contracts parse with the esbuild that builds Tagify', () => {
  const files = contractSources.flatMap(shippedFiles);
  assert.ok(files.length > 10, `expected the contract sources, found ${files.length} files`);
  const failures = [];
  for (const file of files) {
    try {
      esbuild.transformSync(readFileSync(file, 'utf8'), { loader: file.endsWith('x') ? 'tsx' : 'ts', sourcefile: file, logLevel: 'silent' });
    } catch (error) {
      failures.push(`${file}: ${error.errors?.map((entry) => `${entry.location?.line}:${entry.location?.column} ${entry.text}`).join('; ') ?? error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});
