import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import type { TrackData } from "@/types/tagData";
import { checkAutomaticRecordingReuse, findNearRecording, nearRecordingCandidates } from "../automaticRecordingReuse";

const singleUri = "spotify:track:4HCOHRCSQelz2GPX8iTamO", albumUri = "spotify:track:1bRWSJwUGWCsOih08iFFTV";
const justice = "1gR0gsQYfi6joyO1dlp76N", tame = "5INjqkS1o8h1imAzPqGZBb", sza = "7tYKF4w9nC0nq9CsPZTHyP", gta = "15o7qdDTBzs6xWRUYUtZc1", king = "6XYvaoDGE0VmRt83Jss9Sn";
const singleName = "Flower In A Hurricane (feat. Tame Impala, SZA, King Gizzard & the Lizard Wizard) [From GTAVI: Original Score]";
const albumName = "Flower In A Hurricane (feat. Tame Impala, SZA, King Gizzard & The Lizard Wizard)";
const single = { isrc: "FR6P12602660", artistIds: [justice, tame, sza, gta, king].sort(), leadArtistId: justice, durationMs: 224877, name: singleName };
const album = { isrc: "USAT22606646", artistIds: [justice, tame, sza, king].sort(), leadArtistId: justice, durationMs: 221189, name: albumName };
const rock = Object.values(defaultTagData.taxonomy.tagsById).find(tag => tag.name === "Rock")!.id;
const saved: TrackData = { rating: 4, energy: 7, bpm: null, tagIds: [rock], name: albumName, albumName: "Hyperdrama", dateCreated: 5, dateModified: 20 };

beforeEach(async () => {
  delete window.__tagifyRecordingChecks;
  indexedDBStorage.resetConnection(); localStorage.clear(); localStorage.setItem("tagify:sync:account-id", "near-recordings");
  vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init();
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { [albumUri]: saved } });
  // Both releases report the same play count, as Spotify does for one recording.
  vi.spyOn(spotifyService, "getTrackPlayCount").mockResolvedValue(56_340_007);
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const identities = (uri: string) => Promise.resolve(uri === singleUri ? single : uri === albumUri ? album : undefined);

it("leaves the single and album cut unlinked automatically, then finds the album cut as the same song from the single", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(identities);
  const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  await checkAutomaticRecordingReuse({ uri: singleUri, name: singleName }, tracks, vi.fn(async () => undefined));
  // The credits-free titles match, so both are checked; their ISRCs differ, so they stay apart.
  expect(lookup).toHaveBeenCalledTimes(2);
  expect((await indexedDBStorage.getTrack(albumUri))!.recordingGroupId).toBeUndefined();

  const match = (await findNearRecording({ uri: singleUri, name: singleName, details: { albumName: "Flower In A Hurricane" } }, tracks))!;
  expect(match).toMatchObject({ uri: albumUri, data: { albumName: "Hyperdrama" } });
  expect(Object.keys(match.proposals).sort()).toEqual([albumUri, singleUri].sort());
  expect(lookup).toHaveBeenCalledTimes(2);

  await indexedDBStorage.linkRecordings(match.proposals, match.uri, false, { confirmSimilar: true });
  const after = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(after[singleUri]).toMatchObject({ rating: 4, energy: 7, tagIds: [rock], recordingGroupId: after[albumUri].recordingGroupId, recordingGroupConfirmed: true });
  expect(after[albumUri].dateModified).toBe(20);
  expect(nearRecordingCandidates({ uri: singleUri, name: singleName }, after)).toEqual([]);
  // Cached identities: asking again makes no new request.
  await findNearRecording({ uri: singleUri, name: singleName }, after);
  expect(lookup).toHaveBeenCalledTimes(2);
});

it("refreshes an older saved identity that has no lead artist once", async () => {
  const { leadArtistId: _, ...older } = album;
  await indexedDBStorage.saveTrack(albumUri, { ...saved, recordingIdentity: older });
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(identities);
  const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  expect((await findNearRecording({ uri: singleUri, name: singleName }, tracks))?.uri).toBe(albumUri);
  expect(lookup.mock.calls.map(([uri]) => uri).sort()).toEqual([albumUri, singleUri].sort());
});

it("doesn't match after Not the same, for a different lead artist, or for a remix", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(identities);
  await indexedDBStorage.rememberNotSameRecording([singleUri, albumUri]);
  let tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(await findNearRecording({ uri: singleUri, name: singleName }, tracks)).toBeUndefined();
  expect(lookup).not.toHaveBeenCalled();

  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { [albumUri]: saved } });
  tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  lookup.mockImplementation(uri => Promise.resolve(uri === singleUri ? single : { ...album, leadArtistId: tame }));
  expect(await findNearRecording({ uri: singleUri, name: singleName }, tracks)).toBeUndefined();
  lookup.mockImplementation(uri => Promise.resolve(uri === singleUri ? single : album));
  expect(nearRecordingCandidates({ uri: singleUri, name: "Flower In A Hurricane (Remix)" }, tracks)).toEqual([]);
});

it("leaves versions whose ratings differ apart without reading play counts", async () => {
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(identities);
  await indexedDBStorage.saveTrack(singleUri, { rating: 2, energy: 0, bpm: null, tagIds: [], name: singleName, dateModified: 40 });
  const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(await findNearRecording({ uri: singleUri, name: singleName }, tracks)).toBeUndefined();
  expect(spotifyService.getTrackPlayCount).not.toHaveBeenCalled();
});

it("leaves versions apart when their play counts differ", async () => {
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(identities);
  vi.mocked(spotifyService.getTrackPlayCount).mockImplementation(uri => Promise.resolve(uri === singleUri ? 56_340_007 : 56_340_006));
  const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(await findNearRecording({ uri: singleUri, name: singleName }, tracks)).toBeUndefined();
});
