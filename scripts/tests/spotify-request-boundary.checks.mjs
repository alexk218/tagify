import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findViolations } from './spotify-request-boundary.mjs';
test('rejects direct and aliased Spotify dispatch and new raw fetches', () => {
  for (const source of [
    'Spicetify.CosmosAsync.get(url)',
    'Spicetify.GraphQL.Request(definition, variables)',
    'const api = Spicetify.Platform.PlaylistAPI as any; api.getContents(uri)',
    'const api = Spicetify.Platform.PlaylistAPI; const add = api.add; add(uri)',
    'const { getContents: read } = Spicetify.Platform.PlaylistAPI; read(uri)',
    'fetch(url)', 'window.fetch("https://api.spotify.com/v1/me")',
  ]) assert.ok(findViolations(source, 'src/newFeature.ts').length, source);
});
test('permits guarded desktop dispatch but cannot hide a fetch in an existing non-Spotify transport', () => {
  assert.deepEqual(findViolations('const api = Spicetify.Platform.PlaylistAPI; spotifyRead(key, () => api.getContents(uri))', 'src/example.ts'), []);
  assert.ok(findViolations('fetch("https://api.spotify.com/v1/me")', 'src/services/VersionCheckerService.ts').length);
});

test('permits literal regex validation of sanitized SDK operation names', () => {
  assert.deepEqual(findViolations('/^Desktop (PlaylistAPI|GraphQL)/.test(value)', 'src/utils/diagnostics.ts'), []);
});
