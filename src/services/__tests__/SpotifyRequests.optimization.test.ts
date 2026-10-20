// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { spotifyRead, spotifyWrite } from '../SpotifyRequests';
import { spotifyApiService } from '../SpotifyApiService';
import { SpotifyBackgroundPolicy } from '../SpotifyBackgroundPolicy';
import { SpotifyRequestAccounting, spotifyRequestAccounting } from '@/utils/spotifyRequestAccounting';
import { graphqlRateLimiter } from '@/utils/RateLimiter';

beforeEach(() => { vi.useFakeTimers(); (Spicetify.Platform.PlaylistAPI as any).getContents = vi.fn().mockResolvedValue({ items: [] }); });
afterEach(() => { graphqlRateLimiter.reset(); vi.restoreAllMocks(); vi.useRealTimers(); });
const resetPolicyMemory = () => (globalThis as any).__tagifyBackgroundPolicyV1.clear();
it('counts actual dispatches, shared reads and repeat reads without storing request identities', async () => {
  let finish!: () => void;
  const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = spotifyRead('secret-song-url', run, { feature: 'track-details' });
  const second = spotifyRead('secret-song-url', run, { feature: 'track-details' });
  finish(); await Promise.all([first, second]);
  await spotifyRead('secret-song-url', async () => undefined, { feature: 'track-details' });
  expect(spotifyRequestAccounting.snapshot().byFeature['track-details:desktop']).toMatchObject({ requested: 3, dispatched: 2, shared: 1, repeated: 1 });
  expect(JSON.stringify(spotifyRequestAccounting.snapshot())).not.toContain('secret-song');
  const bounded = new SpotifyRequestAccounting();
  for (let i = 0; i < 50000; i++) bounded.record('track-details', 'dispatched', 'graphql', String(i));
  expect(bounded.snapshot().recentKeys).toBe(256);
});
it('keeps unrelated playlist caches and pending track reads across playlist writes', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  api.getContents.mockResolvedValue({ items: [{ uri: 'spotify:track:keep' }] });
  await spotifyApiService.getAllTrackUrisInPlaylistStrict('other', 30000);
  let finish!: (value: string) => void;
  const lookup = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const first = spotifyRead('graphql:track:same', lookup);
  await spotifyWrite(async () => {}, { resource: 'spotify:playlist:changed' });
  const second = spotifyRead('graphql:track:same', lookup);
  expect(lookup).toHaveBeenCalledTimes(1); finish('same'); await Promise.all([first, second]);
  await spotifyApiService.getAllTrackUrisInPlaylistStrict('other', 30000);
  expect(api.getContents).toHaveBeenCalledTimes(1);
});
it('normalizes Web API playlist writes to the same desktop resource', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  api.getContents.mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [{ uri: 'spotify:track:new' }] });
  await spotifyApiService.getAllTrackUrisInPlaylistStrict('same', 30000);
  await spotifyWrite(async () => {}, { resource: 'https://api.spotify.com/v1/playlists/same/items' });
  expect(await spotifyApiService.getAllTrackUrisInPlaylistStrict('same', 30000)).toEqual(['spotify:track:new']);
  expect(api.getContents).toHaveBeenCalledTimes(2);
});
it('reuses confirmed large playlist versions but refreshes changes, writes, manual requests and old snapshots', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const contents = Array.from({ length: 200 }, (_, i) => ({ uri: `spotify:track:${i}` }));
  api.getContents.mockResolvedValue({ items: contents });
  const metadata = vi.spyOn(api, 'getMetadata').mockResolvedValue({ snapshotId: 'v1' });
  const options = { priority: 'background' as const, feature: 'smart-playlists' as const };
  const read = async () => { await vi.advanceTimersByTimeAsync(1000); return spotifyApiService.getTrackUrisForBackgroundSync('versioned', options, 200); };
  await read(); await read();
  expect(api.getContents).toHaveBeenCalledTimes(1); expect(metadata).toHaveBeenCalledTimes(3);
  await spotifyApiService.getAllTrackUrisInPlaylistStrict('versioned');
  expect(api.getContents).toHaveBeenCalledTimes(2);
  metadata.mockResolvedValue({ snapshotId: 'v2' }); await read();
  expect(api.getContents).toHaveBeenCalledTimes(3);
  await spotifyWrite(async () => {}, { resource: 'spotify:playlist:versioned' }); await read();
  expect(api.getContents).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(3600000); await read();
  expect(api.getContents).toHaveBeenCalledTimes(5);
});
it('never caches a changing or missing version, and avoids probes for small playlists', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const metadata = vi.spyOn(api, 'getMetadata').mockResolvedValueOnce({ snapshotId: 'before' }).mockResolvedValueOnce({ snapshotId: 'after' }).mockResolvedValue({});
  const read = () => spotifyApiService.getTrackUrisForBackgroundSync('racing', {}, 200);
  await expect(read()).rejects.toMatchObject({ spotifyRequestStopped: true });
  await read(); await read();
  expect(api.getContents).toHaveBeenCalledTimes(3);
  metadata.mockClear();
  await spotifyApiService.getTrackUrisForBackgroundSync('small', {}, 2);
  expect(metadata).not.toHaveBeenCalled();
});
it('stops on a throttled version check without downloading the playlist', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  vi.spyOn(api, 'getMetadata').mockRejectedValue({ status: 429, retryAfterSeconds: 60 });
  await expect(spotifyApiService.getTrackUrisForBackgroundSync('paused', {}, 200)).rejects.toMatchObject({ status: 429 });
  expect(api.getContents).not.toHaveBeenCalled();
});
it('persists optional budgets and attempted songs across reloads, expires them, and separates accounts', () => {
  let account = 'first';
  const make = () => new SpotifyBackgroundPolicy(() => localStorage, () => account);
  let policy = make();
  expect(policy.reserve('albums', 'one', 2)).toBe(true);
  resetPolicyMemory(); policy = make();
  expect(policy.reserve('albums', 'one', 2)).toBe(false);
  expect(policy.reserve('albums', 'two', 2)).toBe(true);
  expect(policy.reserve('albums', 'three', 2)).toBe(false);
  account = 'second'; expect(policy.reserve('albums', 'one', 2)).toBe(true);
  account = 'first'; vi.setSystemTime(Date.now() + 3600000);
  expect(policy.reserve('albums', 'one', 2)).toBe(true);
});
it('retains reservations if persistent storage rejects writes', () => {
  const policy = new SpotifyBackgroundPolicy(() => ({ getItem: () => '{}', setItem: () => { throw new Error('full'); } }), () => 'full');
  expect(policy.reserve('albums', 'one', 1)).toBe(true);
  expect(policy.reserve('albums', 'two', 1)).toBe(false);
});
it('backs off optional reads longer after real 429s but foreground resumes after Retry-After', async () => {
  const failure = vi.fn().mockRejectedValue({ status: 429, retryAfterSeconds: 1 });
  await expect(spotifyRead('throttled', failure)).rejects.toMatchObject({ status: 429 });
  await vi.advanceTimersByTimeAsync(1001);
  resetPolicyMemory();
  const run = vi.fn().mockResolvedValue(true);
  await expect(spotifyRead('optional', run, { priority: 'background' })).rejects.toMatchObject({ spotifyRequestStopped: true });
  await expect(spotifyRead('user', run)).resolves.toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120000);
  await expect(spotifyRead('optional', run, { priority: 'background' })).resolves.toBe(true);
  await expect(spotifyRead('throttled-again', failure)).rejects.toMatchObject({ status: 429 });
  await vi.advanceTimersByTimeAsync(120000);
  await expect(spotifyRead('optional', run, { priority: 'background' })).rejects.toMatchObject({ spotifyRequestStopped: true });
  expect(run).toHaveBeenCalledTimes(2);
});

it('does not reuse membership when a write starts during its version check', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const metadata = vi.spyOn(api, 'getMetadata').mockResolvedValue({ snapshotId: 'stable' });
  await spotifyApiService.getTrackUrisForBackgroundSync('write-race', {}, 200);
  let finishVersion!: (value: unknown) => void;
  metadata.mockImplementationOnce(() => new Promise(resolve => { finishVersion = resolve; }));
  const read = spotifyApiService.getTrackUrisForBackgroundSync('write-race', {}, 200);
  const stopped = expect(read).rejects.toMatchObject({ spotifyRequestStopped: true });
  let finishWrite!: () => void;
  const write = spotifyWrite(() => new Promise<void>(resolve => { finishWrite = resolve; }), { resource: 'spotify:playlist:write-race' });
  finishVersion({ snapshotId: 'stable' }); await stopped;
  expect(api.getContents).toHaveBeenCalledTimes(1);
  finishWrite(); await write;
});
it('rejects a version result after switching Spotify accounts', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const previous = Spicetify.Platform.username;
  let finish!: (value: unknown) => void;
  vi.spyOn(api, 'getMetadata').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const read = spotifyApiService.getTrackUrisForBackgroundSync('account-race', {}, 200);
  const stopped = expect(read).rejects.toMatchObject({ name: 'AbortError' });
  try {
    Spicetify.Platform.username = 'different-account';
    finish({ snapshotId: 'stable' }); await stopped;
    expect(api.getContents).not.toHaveBeenCalled();
  } finally { Spicetify.Platform.username = previous; }
});
it('bounds confirmed membership at 50,000 songs and returns independent arrays', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  vi.spyOn(api, 'getMetadata').mockResolvedValue({ snapshotId: 'stable' });
  const contents = Array.from({ length: 50000 }, (_, i) => `spotify:track:${i}`);
  const download = vi.spyOn(spotifyApiService, 'getAllTrackUrisInPlaylistStrict').mockResolvedValue(contents);
  const first = await spotifyApiService.getTrackUrisForBackgroundSync('large', {}, 50000);
  first.pop();
  expect(await spotifyApiService.getTrackUrisForBackgroundSync('large', {}, 50000)).toHaveLength(50000);
  expect(download).toHaveBeenCalledTimes(1);
  download.mockResolvedValue(contents.slice(0, 200));
  await spotifyApiService.getTrackUrisForBackgroundSync('another', {}, 200);
  const cache = (globalThis as any).__tagifyPlaylistVersionsV1 as Map<string, { uris: string[] }>;
  expect([...cache.values()].reduce((sum, entry) => sum + entry.uris.length, 0)).toBe(200);
  await spotifyApiService.getTrackUrisForBackgroundSync('large', {}, 50000);
  expect(download).toHaveBeenCalledTimes(3);
  download.mockResolvedValue([...contents, 'spotify:track:extra']);
  await spotifyApiService.getTrackUrisForBackgroundSync('too-large', {}, 50001);
  expect([...cache.keys()].some(key => key.endsWith(':too-large'))).toBe(false);
});
it('stops if a write finishes during the final version confirmation', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  let finish!: (value: unknown) => void;
  const metadata = vi.spyOn(api, 'getMetadata').mockResolvedValueOnce({ snapshotId: 'stable' })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const read = spotifyApiService.getTrackUrisForBackgroundSync('final-probe-race', {}, 200);
  const outcome = read.then(() => 'resolved', error => error.spotifyRequestStopped ? 'stopped' : 'other');
  for (let i = 0; i < 20 && metadata.mock.calls.length < 2; i++) await Promise.resolve();
  expect(metadata).toHaveBeenCalledTimes(2);
  await spotifyWrite(async () => {}, { resource: 'spotify:playlist:final-probe-race' });
  finish({ snapshotId: 'stable' });
  expect(await outcome).toBe('stopped');
});

it('completes 50,000 additions under the shared limits with exactly 500 writes', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const add = vi.spyOn(api, 'add').mockResolvedValue(undefined);
  const uris = Array.from({ length: 50000 }, (_, i) => `spotify:track:${String(i).padStart(22, '0')}`);
  const start = Date.now(); let finishedAt = 0;
  const operation = spotifyApiService.updatePlaylistTracks('healthy-large', uris, []).then(value => { finishedAt = Date.now(); return value; });
  await vi.advanceTimersByTimeAsync(120000);
  expect(await operation).toEqual({ success: true, added: uris, removed: [] });
  expect(finishedAt - start).toBeGreaterThan(60000);
  expect(add).toHaveBeenCalledTimes(500);
  expect(add.mock.calls.every(call => (call[1] as string[]).length === 100)).toBe(true);
  expect(api.getContents).toHaveBeenCalledOnce();
});
