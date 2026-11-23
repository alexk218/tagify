import { IDBFactory } from "fake-indexeddb";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNearRecording } from "../useNearRecording";
import { useAlbumNearRecordings } from "../useAlbumNearRecordings";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import { defaultTagData } from "@/constants/defaultTagData";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { RecordingIdentity, TrackData } from "@/types/tagData";

// Flower In A Hurricane: the GTA VI score single and the Hyperdrama album cut.
const singleUri = "spotify:track:4HCOHRCSQelz2GPX8iTamO", albumUri = "spotify:track:1bRWSJwUGWCsOih08iFFTV";
const justice = "1gR0gsQYfi6joyO1dlp76N", tame = "5INjqkS1o8h1imAzPqGZBb", sza = "7tYKF4w9nC0nq9CsPZTHyP", gta = "15o7qdDTBzs6xWRUYUtZc1", king = "6XYvaoDGE0VmRt83Jss9Sn";
const singleName = "Flower In A Hurricane (feat. Tame Impala, SZA, King Gizzard & the Lizard Wizard) [From GTAVI: Original Score]";
const albumName = "Flower In A Hurricane (feat. Tame Impala, SZA, King Gizzard & The Lizard Wizard)";
const identities: Record<string, RecordingIdentity> = {
  [singleUri]: { isrc: "FR6P12602660", artistIds: [justice, tame, sza, gta, king].sort(), leadArtistId: justice, durationMs: 224877, name: singleName },
  [albumUri]: { isrc: "USAT22606646", artistIds: [justice, tame, sza, king].sort(), leadArtistId: justice, durationMs: 221189, name: albumName },
};
const rock = Object.values(defaultTagData.taxonomy.tagsById).find(tag => tag.name === "Rock")!.id;
const saved: TrackData = { rating: 4, energy: 7, bpm: null, tagIds: [rock], name: albumName, albumName: "Hyperdrama", dateCreated: 5, dateModified: 20 };
const viewed = { uri: singleUri, name: singleName, duration_ms: 224877, artists: [{ name: "Justice" }], album: { name: "GTAVI: Original Score", uri: "spotify:album:GrandTheftAutoVIScore000", images: [] } } as unknown as SpotifyTrack;

let counts: Record<string, number | undefined>;
beforeEach(async () => {
  delete window.__tagifyRecordingChecks;
  indexedDBStorage.resetConnection(); localStorage.clear(); localStorage.setItem("tagify:sync:account-id", "same-play-count");
  vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init();
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { [albumUri]: saved } });
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(id => Promise.resolve(identities[id]));
  vi.spyOn(spotifyApiService, "getAlbumTracks").mockResolvedValue([]);
  vi.spyOn(spotifyService, "getTrackPlayCount").mockImplementation(id => Promise.resolve(counts[id]));
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const open = async () => {
  const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  const changed = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useNearRecording(viewed, tracks, "idle", changed));
  return { ...hook, changed };
};

it("links the two versions on its own when both have the same play count above 10,000", async () => {
  counts = { [singleUri]: 48_213_907, [albumUri]: 48_213_907 };
  const { result, changed } = await open();
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(result.current.linked?.uri).toBe(albumUri);
  const after = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(after[singleUri]).toMatchObject({ rating: 4, energy: 7, tagIds: [rock], recordingGroupId: after[albumUri].recordingGroupId, recordingGroupConfirmed: true });
  expect(after[albumUri]).toMatchObject({ recordingGroupConfirmed: true, dateModified: 20 });
  expect(spotifyService.getTrackPlayCount).toHaveBeenCalledTimes(2);
});

const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const unlinked = async (result: { current: ReturnType<typeof useNearRecording> }, changed: ReturnType<typeof vi.fn>) => {
  await settle();
  expect(result.current.linked).toBeUndefined();
  expect(changed).not.toHaveBeenCalled();
  const after = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(after[albumUri].recordingGroupId).toBeUndefined();
  expect(after[singleUri]?.recordingGroupId).toBeUndefined();
};

it.each([
  ["equal but below 10,000", { [singleUri]: 9_999, [albumUri]: 9_999 }],
  ["different", { [singleUri]: 48_213_907, [albumUri]: 48_213_906 }],
  ["missing for one song", { [singleUri]: 48_213_907, [albumUri]: undefined }],
])("leaves the versions unlinked, without asking, when the play counts are %s", async (_, value) => {
  counts = value;
  const { result, changed } = await open();
  await waitFor(() => expect(spotifyService.getTrackPlayCount).toHaveBeenCalled());
  await unlinked(result, changed);
});

it("leaves the versions unlinked when their ratings differ, even with the same play count", async () => {
  counts = { [singleUri]: 48_213_907, [albumUri]: 48_213_907 };
  await indexedDBStorage.saveTrack(singleUri, { rating: 2, energy: 0, bpm: null, tagIds: [], name: singleName, dateModified: 40 });
  const { result, changed } = await open();
  await waitFor(() => expect(spotifyApiService.getRecordingIdentity).toHaveBeenCalledTimes(2));
  await unlinked(result, changed);
  expect(spotifyService.getTrackPlayCount).not.toHaveBeenCalled();
  expect((await indexedDBStorage.getTrack(singleUri))).toMatchObject({ rating: 2, dateModified: 40 });
});

it("never links songs the person called Not the same, or a link they removed", async () => {
  counts = { [singleUri]: 48_213_907, [albumUri]: 48_213_907 };
  await indexedDBStorage.rememberNotSameRecording([singleUri, albumUri]);
  let { result, changed } = await open();
  await unlinked(result, changed);

  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { [albumUri]: saved } });
  await indexedDBStorage.unlinkRecording(albumUri);
  ({ result, changed } = await open());
  await unlinked(result, changed);
  expect(spotifyService.getTrackPlayCount).not.toHaveBeenCalled();
});

describe("the rest of the album", () => {
  const artist = "3Suzuki0Artist0Id00000";
  const id = (value: string) => `spotify:track:${value.padEnd(22, "0")}`;
  const songs = ["Suzuki", "Night Drive", "Low Sun", "Sundown"].map(name => ({ name, album: id(`${name.replace(" ", "")}A`), single: id(`${name.replace(" ", "")}S`) }));
  const album = "spotify:album:GrandTheftAutoVITheAlbm";
  const card = { uri: songs[0].album, name: "Suzuki", duration_ms: 187000, artists: [{ name: "Artist" }], album: { name: "Grand Theft Auto VI: The Album", uri: album, images: [] } } as unknown as SpotifyTrack;
  const single = (name: string, rating: number): TrackData => ({ rating, energy: 0, bpm: null, tagIds: [rock], name: `${name} (from GTAVI: The Album)`, dateCreated: 1, dateModified: 10 });
  beforeEach(async () => {
    songs.forEach((song, index) => {
      identities[song.album] = { isrc: `USAT2260665${index}`, name: song.name, artistIds: [artist], leadArtistId: artist, durationMs: 187000 };
      identities[song.single] = { isrc: `USAT2260721${index}`, name: `${song.name} (from GTAVI: The Album)`, artistIds: [artist, gta].sort(), leadArtistId: gta, durationMs: 187000 };
    });
    // Night Drive's versions share a count; Low Sun's differ; Sundown's album cut has another rating.
    counts = Object.fromEntries(songs.flatMap((song, index) => [[song.album, 2_000_000 + index * 10], [song.single, 2_000_000 + index * 10 + (song.name === "Low Sun" ? 1 : 0)]]));
    await indexedDBStorage.saveAll({ ...defaultTagData, tracks: {
      ...Object.fromEntries(songs.map((song, index) => [song.single, single(song.name, index + 2)])),
      [songs[3].album]: { rating: 1, energy: 0, bpm: null, tagIds: [], name: "Sundown", dateCreated: 1, dateModified: 20 },
    } });
    vi.mocked(spotifyApiService.getAlbumTracks).mockResolvedValue(songs.map((song, index) => ({ uri: song.album, name: song.name, artists: "Artist", discNumber: 1, trackNumber: index + 1 })));
  });

  it("links only the album songs whose versions share a play count, and leaves the song on the card to its own check", async () => {
    const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
    const changed = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAlbumNearRecordings(card, tracks, true, changed));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const after = (await indexedDBStorage.loadAllStrict()).tracks;
    expect(after[songs[1].album]).toMatchObject({ rating: 3, recordingGroupConfirmed: true, recordingGroupId: after[songs[1].single].recordingGroupId });
    expect(after[songs[1].single].dateModified).toBe(10);
    expect(after[songs[0].album]).toBeUndefined();
    expect(after[songs[2].album]).toBeUndefined();
    expect(after[songs[3].album]).toMatchObject({ rating: 1, dateModified: 20 });
    expect(after[songs[3].album].recordingGroupId).toBeUndefined();
    expect(vi.mocked(spotifyService.getTrackPlayCount).mock.calls.map(([uri]) => uri)).not.toContain(songs[0].album);
  });

  it("does nothing until the song on the card has another version", async () => {
    const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
    renderHook(() => useAlbumNearRecordings(card, tracks, false, vi.fn()));
    await settle();
    expect(spotifyApiService.getAlbumTracks).not.toHaveBeenCalled();
  });
});
