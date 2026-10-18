import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { checkAutomaticRecordingReuse, getRecordingReuseStatus, recordingIdentityFor, RecordingLookupDeferred } from "../automaticRecordingReuse";

const uri = (index: number) => `spotify:track:${String(index).padStart(22, "0")}`;
const identity = { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 180000, name: "Same song" };
const tag = Object.values(defaultTagData.taxonomy.tagsById).find(value => value.name === "Rock")!.id;
const song: TrackData = { name: identity.name, rating: 3, energy: 4, bpm: 120, tagIds: [tag], dateModified: 20 };
let now = Date.now();
beforeEach(async () => {
  delete window.__tagifyRecordingChecks;
  trackEditHistory.clear(); indexedDBStorage.resetConnection(); localStorage.clear();
  localStorage.setItem("tagify:sync:account-id", "recording-scale");
  vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init();
  now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
});
// These tests write tens of thousands of songs to the fake database. Alone they take seconds, but the
// full suite on a busy Mac has pushed one past a minute, so leave generous room.
const LARGE_LIBRARY_TIMEOUT_MS = 180_000;
afterEach(() => { trackEditHistory.clear(); indexedDBStorage.resetConnection(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses two lookups and candidate-only reads for overlapping and repeated checks in a 50,000-song tagged library", async () => {
  const tracks: Record<string, TrackData> = Object.fromEntries(Array.from({ length: 50_000 }, (_, index) => [
    uri(index), { ...song, name: `Tagged song ${index}`, dateModified: index + 1 },
  ]));
  tracks[uri(1)] = song;
  expect(await indexedDBStorage.saveAll({ ...defaultTagData, tracks })).toBe(true);
  const fullRead = vi.spyOn(indexedDBStorage, "loadAllStrict");
  const reads = vi.spyOn(indexedDBStorage, "getRecordingTracks");
  const links = vi.spyOn(indexedDBStorage, "linkRecordings");
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  const target = { uri: uri(60_000), name: identity.name };
  const start = performance.now();
  await Promise.all(Array.from({ length: 10 }, () => checkAutomaticRecordingReuse(target, tracks, async () => undefined)));
  await checkAutomaticRecordingReuse(target, tracks, async () => undefined);
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(links).toHaveBeenCalledTimes(1);
  expect(fullRead).not.toHaveBeenCalled();
  expect(reads.mock.calls.every(([uris]) => uris.length === 2)).toBe(true);
  expect(await indexedDBStorage.getTrack(target.uri)).toMatchObject({ rating: 3, energy: 4, tagIds: [tag] });
  expect(await indexedDBStorage.getTrack(uri(1))).toMatchObject({ dateModified: 20, recordingIdentity: identity });
  console.log(`50,000 tagged songs: ${lookup.mock.calls.length} Spotify lookups, ${reads.mock.calls.length} reads of two tracks, ${links.mock.calls.length} link write, ${(performance.now() - start).toFixed(0)}ms matching`);
}, LARGE_LIBRARY_TIMEOUT_MS);

it("keeps successful lookups through cache eviction, expiry and reopening even when no recording was linked", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  for (let index = 0; index < 510; index++) {
    if (index % 30 === 0) now += 60_001;
    await recordingIdentityFor(uri(index));
  }
  expect(lookup).toHaveBeenCalledTimes(510);
  expect(window.__tagifyRecordingChecks!.identities.size).toBeLessThanOrEqual(500);
  expect(window.__tagifyRecordingChecks!.identities.has(`tagify-db-recording-scale:${uri(0)}`)).toBe(false);
  delete window.__tagifyRecordingChecks; indexedDBStorage.resetConnection(); now += 24 * 60 * 60_000;
  await recordingIdentityFor(uri(0));
  await recordingIdentityFor(uri(509));
  expect(lookup).toHaveBeenCalledTimes(510);
  expect(await indexedDBStorage.getTrack(uri(0))).toBeNull();
});

it("caps background work at twelve lookups per minute while the current song can still be checked", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  for (let index = 0; index < 12; index++) await recordingIdentityFor(uri(index), undefined, { priority: "background" });
  await expect(recordingIdentityFor(uri(12), undefined, { priority: "background" })).rejects.toBeInstanceOf(RecordingLookupDeferred);
  expect(lookup).toHaveBeenCalledTimes(12);
  await recordingIdentityFor(uri(12));
  expect(lookup).toHaveBeenCalledTimes(13);
  now += 60_001;
  await recordingIdentityFor(uri(13), undefined, { priority: "background" });
  expect(lookup).toHaveBeenCalledTimes(14);
});

it("caps all matching lookups at sixty per minute across simultaneous callers", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  const outcomes = await Promise.allSettled(Array.from({ length: 90 }, (_, index) => recordingIdentityFor(uri(index))));
  expect(lookup).toHaveBeenCalledTimes(60);
  expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(30);
  now += 60_001;
  await recordingIdentityFor(uri(89)); expect(lookup).toHaveBeenCalledTimes(61);
});

it("prioritizes foreground work, deduplicates a promoted background request and cancels stale queued songs", async () => {
  const finishes: Array<(value: typeof identity) => void> = [];
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
  const first = [0, 1, 2].map(index => recordingIdentityFor(uri(index)));
  await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(3));
  let visible = true;
  const stale = recordingIdentityFor(uri(3), undefined, { priority: "background", isCurrent: () => visible });
  const background = recordingIdentityFor(uri(4), undefined, { priority: "background" });
  const foreground = recordingIdentityFor(uri(4)); expect(foreground).toBe(background);
  visible = false;
  finishes.splice(0).forEach(finish => finish(identity));
  await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(4));
  expect(lookup.mock.calls.at(-1)![0]).toBe(uri(4));
  finishes.splice(0).forEach(finish => finish(identity));
  await Promise.all([...first, stale, foreground]);
  expect(await indexedDBStorage.getRecordingLookup(uri(3))).toBeUndefined();
});

it("backs off an outage across songs and reloads instead of retrying every visible row", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockRejectedValue(new Error("Spotify unavailable"));
  await expect(recordingIdentityFor(uri(1))).rejects.toThrow("Spotify unavailable");
  await Promise.allSettled(Array.from({ length: 100 }, (_, index) => recordingIdentityFor(uri(index + 2))));
  expect(lookup).toHaveBeenCalledTimes(1);
  delete window.__tagifyRecordingChecks; indexedDBStorage.resetConnection(); now += 60_000;
  await expect(recordingIdentityFor(uri(200))).rejects.toBeInstanceOf(RecordingLookupDeferred);
  expect(lookup).toHaveBeenCalledTimes(1);
  now += 4 * 60_000 + 1;
  await expect(recordingIdentityFor(uri(1))).rejects.toThrow("Spotify unavailable");
  expect(lookup).toHaveBeenCalledTimes(2);
  expect((await indexedDBStorage.getRecordingLookup(uri(1)))!.retryAt).toBe(now + 10 * 60_000);
});

it("links a confirmed pair when an unrelated same-title song is unavailable, without changing existing timestamps", async () => {
  const tracks = { [uri(3)]: { ...song, tagIds: [], rating: 0 }, [uri(1)]: { ...song, recordingIdentity: identity } };
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks });
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(async id => {
    if (id === uri(3)) throw new Error("Unavailable old release");
    return identity;
  });
  await checkAutomaticRecordingReuse({ uri: uri(2), name: identity.name }, tracks, async () => undefined);
  expect(await indexedDBStorage.getTrack(uri(2))).toMatchObject({ rating: 3, energy: 4, tagIds: [tag] });
  expect(await indexedDBStorage.getTrack(uri(1))).toMatchObject({ dateModified: 20 });
  expect((await indexedDBStorage.getTrack(uri(3)))!.recordingGroupId).toBeUndefined();
  expect(getRecordingReuseStatus(uri(2))).toBe("unavailable");
  expect(lookup).toHaveBeenCalledTimes(2);
});

it("keeps the background request window after reopening instead of spending the allowance again", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  for (let index = 0; index < 12; index++) await recordingIdentityFor(uri(index), undefined, { priority: "background" });
  delete window.__tagifyRecordingChecks; indexedDBStorage.resetConnection();
  await expect(recordingIdentityFor(uri(13), undefined, { priority: "background" })).rejects.toBeInstanceOf(RecordingLookupDeferred);
  expect(lookup).toHaveBeenCalledTimes(12);
  now += 60_001;
  await recordingIdentityFor(uri(13), undefined, { priority: "background" });
  expect(lookup).toHaveBeenCalledTimes(13);
});

it("saves successful identities without reconciling playlists when titles belong to different recordings", async () => {
  const tracks = { [uri(1)]: song };
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks });
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(async id => ({ ...identity, isrc: id === uri(1) ? identity.isrc : "USABC2400002", durationMs: id === uri(1) ? identity.durationMs : identity.durationMs + 1 }));
  const changed = vi.fn(async (_changes: Record<string, TrackData>, _syncChanges?: Record<string, TrackData>) => undefined);
  await checkAutomaticRecordingReuse({ uri: uri(2), name: identity.name }, tracks, changed);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0][1]).toEqual({});
  expect(await indexedDBStorage.getTrack(uri(1))).toMatchObject({ dateModified: 20, recordingIdentity: identity });
  expect(await indexedDBStorage.getTrack(uri(2))).toBeNull();
});

it("bounds lookup work for 10,000 same-title candidates and does not rewrite a group already confirmed", async () => {
  const tracks: Record<string, TrackData> = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [uri(index), { ...song, dateModified: index + 1 }]));
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks });
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  const cacheReads = vi.spyOn(indexedDBStorage, "getRecordingLookup");
  const links = vi.spyOn(indexedDBStorage, "linkRecordings");
  const target = { uri: uri(60_000), name: identity.name };
  await checkAutomaticRecordingReuse(target, tracks, async () => undefined);
  expect(lookup).toHaveBeenCalledTimes(60);
  expect(cacheReads.mock.calls.length).toBeLessThan(130);
  expect(links).toHaveBeenCalledTimes(1);
  const saved = await indexedDBStorage.getRecordingTracks([target.uri, ...Object.keys(tracks)]);
  const group = saved[target.uri].recordingGroupId;
  await checkAutomaticRecordingReuse(target, saved, async () => undefined);
  expect(lookup).toHaveBeenCalledTimes(60);
  expect(links).toHaveBeenCalledTimes(1);
  expect((await indexedDBStorage.getTrack(target.uri))!.recordingGroupId).toBe(group);
}, LARGE_LIBRARY_TIMEOUT_MS);

it("automatically shares a different-code copy in a 50,000-song library with no extra requests after reopening or restart", async () => {
  const tracks: Record<string, TrackData> = Object.fromEntries(Array.from({ length: 50_000 }, (_, index) => [uri(index), { ...song, name: `Song ${index}` }]));
  tracks[uri(1)] = song;
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks });
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(async id => ({ ...identity, isrc: id === uri(1) ? "US2641219402" : "US2641005202" }));
  const target = { uri: uri(60_000), name: identity.name };
  const fullRead = vi.spyOn(indexedDBStorage, "loadAllStrict");
  const reads = vi.spyOn(indexedDBStorage, "getRecordingTracks");
  await checkAutomaticRecordingReuse(target, tracks, async () => undefined);
  expect(await indexedDBStorage.getTrack(target.uri)).toMatchObject({ rating: 3, energy: 4, tagIds: [tag] });
  expect(lookup).toHaveBeenCalledTimes(2);
  delete window.__tagifyRecordingChecks; indexedDBStorage.resetConnection();
  for (let i = 0; i < 3; i++) {
    await checkAutomaticRecordingReuse(target, tracks, async () => undefined);
  }
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(fullRead).not.toHaveBeenCalled();
  expect(reads.mock.calls.every(([uris]) => uris.length === 2)).toBe(true);
  console.log("50,000 tagged songs: automatic sharing + repeated opening + restart = 2 total Spotify requests; reads limited to 2 candidates");
}, LARGE_LIBRARY_TIMEOUT_MS);
