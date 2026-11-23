import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import type { RecordingIdentity, TrackData } from "@/types/tagData";
import { findAlbumNearRecordings } from "../automaticRecordingReuse";

// "Grand Theft Auto VI: The Album": every song was released first as a single titled
// "<title> (from GTAVI: The Album)", with its own ISRC and the game as an added artist.
const artist = "3Suzuki0Artist0Id00000", other = "4Other00Artist0Id00000", gta = "15o7qdDTBzs6xWRUYUtZc1";
const uri = (id: string) => `spotify:track:${id.padEnd(22, "0")}`;
const suzuki = { album: uri("SuzukiAlbum"), single: uri("SuzukiSingle") };
const night = { album: uri("NightAlbum"), single: uri("NightSingle") };
const intro = uri("IntroAlbum");
const identity = (isrc: string, name: string, artistIds: string[], durationMs = 187000): RecordingIdentity => ({ isrc, name, artistIds: [...artistIds].sort(), leadArtistId: artistIds[0], durationMs });
const identities: Record<string, RecordingIdentity> = {
  [suzuki.album]: identity("USAT22606650", "Suzuki", [artist]),
  [suzuki.single]: identity("USAT22607218", "Suzuki (from GTAVI: The Album)", [gta, artist]),
  [night.album]: identity("USAT22606651", "Night Drive", [other]),
  [night.single]: identity("USAT22607219", "Night Drive [From GTAVI: The Album]", [other, gta], 190700),
  [intro]: identity("USAT22606652", "Intro", [artist]),
};
const rock = Object.values(defaultTagData.taxonomy.tagsById).find(tag => tag.name === "Rock")!.id;
const tagged = (name: string, rating: number, dateModified: number): TrackData => ({ rating, energy: 0, bpm: null, tagIds: [rock], name, albumName: `${name} (Single)`, dateCreated: 1, dateModified });

beforeEach(async () => {
  delete window.__tagifyRecordingChecks;
  indexedDBStorage.resetConnection(); localStorage.clear(); localStorage.setItem("tagify:sync:account-id", "album-near-recordings");
  vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init();
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: {
    [suzuki.single]: tagged("Suzuki (from GTAVI: The Album)", 4, 30),
    [night.single]: tagged("Night Drive [From GTAVI: The Album]", 5, 40),
  } });
  // Each song's two releases report one play count, as Spotify does for one recording.
  vi.spyOn(spotifyService, "getTrackPlayCount").mockImplementation(id => Promise.resolve(id.includes("Suzuki") ? 2_000_000 : 1_500_000));
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const albumTracks = [
  { uri: intro, name: "Intro" },
  { uri: suzuki.album, name: "Suzuki" },
  { uri: night.album, name: "Night Drive" },
].map(track => ({ ...track, details: { albumName: "Grand Theft Auto VI: The Album" } }));

it("finds every album song with a saved single, looking up only those songs, and links them all", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(id => Promise.resolve(identities[id]));
  const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  const matches = await findAlbumNearRecordings(albumTracks, tracks);
  expect(matches.map(match => [match.track.uri, match.uri])).toEqual([[suzuki.album, suzuki.single], [night.album, night.single]]);
  // "Intro" has no saved song with its title, so it is never looked up.
  expect(lookup.mock.calls.map(([id]) => id).sort()).toEqual([night.album, night.single, suzuki.album, suzuki.single].sort());

  for (const match of matches) await indexedDBStorage.linkRecordings(match.proposals, match.uri, false, { confirmSimilar: true });
  const after = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(after[suzuki.album]).toMatchObject({ rating: 4, tagIds: [rock], albumName: "Grand Theft Auto VI: The Album", recordingGroupId: after[suzuki.single].recordingGroupId, recordingGroupConfirmed: true });
  expect(after[night.album]).toMatchObject({ rating: 5, recordingGroupId: after[night.single].recordingGroupId });
  expect([after[suzuki.single].dateModified, after[night.single].dateModified]).toEqual([30, 40]);
  expect(await findAlbumNearRecordings(albumTracks, after)).toEqual([]);
});

it("skips a song whose ratings differ and songs answered Not the same", async () => {
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(id => Promise.resolve(identities[id]));
  await indexedDBStorage.saveTrack(suzuki.album, { ...tagged("Suzuki", 2, 50), albumName: "Grand Theft Auto VI: The Album" });
  await indexedDBStorage.rememberNotSameRecording([night.album, night.single]);
  const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  const matches = await findAlbumNearRecordings(albumTracks, tracks);
  expect(matches).toEqual([]);
});

it("stops when the song card moves on", async () => {
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(id => Promise.resolve(identities[id]));
  const tracks = (await indexedDBStorage.loadAllStrict()).tracks;
  let current = true;
  const found = findAlbumNearRecordings(albumTracks, tracks, () => current);
  current = false;
  expect(await found).toEqual([]);
});
