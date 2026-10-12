import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { graphqlRateLimiter } from '@/utils/RateLimiter';
import { spotifyApiService } from '../SpotifyApiService';
import { PlaylistMembershipStore } from '@/features/track-insights/services/playlistMembership';
beforeEach(() => { vi.useFakeTimers(); (Spicetify.Platform.PlaylistAPI as any).getContents = vi.fn().mockResolvedValue({ items: [] }); });
afterEach(() => { graphqlRateLimiter.reset(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('finishes a synthetic 50k-song operation in bounded batches under the default limits', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const add = vi.spyOn(api, 'add').mockResolvedValue(undefined);
  const uris = Array.from({ length: 50000 }, (_, i) => `spotify:track:large-${i}`);
  const task = spotifyApiService.updatePlaylistTracks('large', uris, []);
  await vi.advanceTimersByTimeAsync(120000);
  expect(await task).toEqual({ success: true, added: uris, removed: [] });
  expect(api.getContents).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledTimes(500);
  expect(add.mock.calls.every(call => (call[1] as string[]).length === 100)).toBe(true);
});
it('collects every occurrence page before removals and batches duplicate cleanup', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const items = Array.from({ length: 501 }, (_, i) => ({ uri: 'spotify:track:repeat', uid: String(i) }));
  api.getContents.mockImplementation(async (_uri: string, options?: { offset: number }) => ({ totalLength: items.length, offset: options?.offset ?? 0, items: items.slice(options?.offset ?? 0, (options?.offset ?? 0) + 100) }));
  const remove = vi.spyOn(api, 'remove').mockImplementation(async () => { expect(api.getContents).toHaveBeenCalledTimes(6); });
  const task = spotifyApiService.removeDuplicatePlaylistOccurrences('paged');
  await vi.advanceTimersByTimeAsync(1000);
  expect(await task).toBe(500);
  expect(remove.mock.calls.map(call => (call[1] as unknown[]).length)).toEqual([100, 100, 100, 100, 100]);
  expect(remove.mock.calls.flatMap(call => call[1] as Array<{uid:string}>).map(item => item.uid)).toEqual(items.slice(1).map(item => item.uid));
});
it('removes songs beyond the first desktop page and stops on repeated pages', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  api.getContents.mockResolvedValueOnce({ totalLength: 2, items: [{ uri: 'spotify:track:keep', uid: 'keep' }] }).mockResolvedValueOnce({ totalLength: 2, items: [{ uri: 'spotify:track:remove', uid: 'remove' }] });
  const remove = vi.spyOn(api, 'remove').mockResolvedValue(undefined);
  expect(await spotifyApiService.updatePlaylistTracks('later-page', [], ['spotify:track:remove'], [])).toEqual({ success: true, added: [], removed: ['spotify:track:remove'] });
  api.getContents.mockResolvedValue({ totalLength: 2, items: [{ uri: 'spotify:track:repeat', uid: 'same' }] });
  remove.mockClear();
  expect((await spotifyApiService.updatePlaylistTracks('repeated-page', [], ['spotify:track:repeat'], [])).success).toBe(false);
  expect(remove).not.toHaveBeenCalled();
});
it('manual refresh and revision changes bypass both membership caches', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  api.getContents.mockResolvedValueOnce({ items: [{ uri: 'spotify:track:old' }] }).mockResolvedValue({ items: [{ uri: 'spotify:track:new' }] });
  const store = new PlaylistMembershipStore(), uri = 'spotify:playlist:refresh';
  await store.request(uri); await vi.advanceTimersByTimeAsync(10000); await store.request(uri, '', true);
  expect(api.getContents).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot()[uri].uris).toEqual(['spotify:track:new']);
  await store.request(uri, 'changed'); expect(api.getContents).toHaveBeenCalledTimes(3);
});
it('removes a single song using only the required occurrence pages', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  api.getContents.mockResolvedValueOnce({ totalLength: 2, items: [{ uri: 'spotify:track:keep', uid: 'keep' }] }).mockResolvedValueOnce({ totalLength: 2, items: [{ uri: 'spotify:track:remove', uid: 'remove' }] });
  const remove = vi.spyOn(api, 'remove').mockResolvedValue(undefined);
  expect(await spotifyApiService.removeTrackFromPlaylist('spotify:track:remove', 'single')).toBe(true);
  expect(api.getContents).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledWith('spotify:playlist:single', [{ uri: 'spotify:track:remove', uid: 'remove' }]);
});
it('does not republish a pre-write read into the membership cache', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any; let finish!: (value: unknown) => void;
  api.getContents.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ items: [{ uri: 'spotify:track:new' }] });
  vi.spyOn(api, 'add').mockResolvedValue(undefined);
  const before = spotifyApiService.getAllTrackUrisInPlaylistStrict('race', 30000);
  await spotifyApiService.updatePlaylistTracks('race', ['spotify:track:new'], [], []);
  finish({ items: [] }); await before;
  expect(await spotifyApiService.getAllTrackUrisInPlaylistStrict('race', 30000)).toEqual(['spotify:track:new']);
});
it('never resubmits an uncertain write and rechecks membership after its eventual completion', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any; let finish!: () => void;
  const add = vi.spyOn(api, 'add').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const first = spotifyApiService.updatePlaylistTracks('uncertain', ['spotify:track:one'], [], []);
  await vi.advanceTimersByTimeAsync(10000); expect((await first).success).toBe(false);
  expect((await spotifyApiService.updatePlaylistTracks('uncertain', ['spotify:track:one'], [], [])).success).toBe(false);
  expect(add).toHaveBeenCalledTimes(1);
  api.getContents.mockResolvedValue({ items: [{ uri: 'spotify:track:one' }] });
  finish(); await vi.advanceTimersByTimeAsync(0);
  expect((await spotifyApiService.updatePlaylistTracks('uncertain', ['spotify:track:one'], [])).success).toBe(true);
  expect(add).toHaveBeenCalledTimes(1);
  expect(Spicetify.showNotification).toHaveBeenCalledWith(expect.stringContaining('restart Spotify'), true, 10000);
});

it('stops subsequent batches if the account changes while a write is running', async () => {
  const previous = Spicetify.Platform.username;
  Spicetify.Platform.username = 'batch-a';
  const api = Spicetify.Platform.PlaylistAPI as any;
  const add = vi.spyOn(api, 'add').mockImplementation(async () => { Spicetify.Platform.username = 'batch-b'; });
  try {
    const uris = Array.from({ length: 201 }, (_, i) => `spotify:track:switch-${i}`);
    const result = await spotifyApiService.updatePlaylistTracks('switched-batches', uris, [], []);
    expect(result.success).toBe(false);
    expect(add).toHaveBeenCalledTimes(1);
    expect(result.added).toEqual([]);
  } finally { Spicetify.Platform.username = previous; }
});

it('does not dispatch a write after its local validation times out', async () => {
  const api = Spicetify.Platform.PlaylistAPI as any;
  const add = vi.spyOn(api, 'add').mockResolvedValue(undefined);
  let finish!: () => void;
  const validation = new Promise<void>(resolve => { finish = resolve; });
  const task = spotifyApiService.updatePlaylistTracks('validation-timeout', ['spotify:track:one'], [], [], {beforeWrite: () => validation});
  await vi.advanceTimersByTimeAsync(10000);
  expect((await task).success).toBe(false);
  finish(); await vi.advanceTimersByTimeAsync(0);
  expect(add).not.toHaveBeenCalled();
});
