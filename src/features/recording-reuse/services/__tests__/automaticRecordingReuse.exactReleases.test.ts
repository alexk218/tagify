import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { normalizeTagDataStructure } from "@/features/tag-data/utils/tagData.schema";
import { collapseRecordingEntries, recordingDisplayKeys } from "../../utils/recordingLibrary";
import { checkAutomaticRecordingReuse } from "../automaticRecordingReuse";

const uris = ["0FM31M7JGTYVgwcXJRZyTi", "7vuklW2wWZysUHbQigchbX", "39vBNPpuGv5U6MlNMa346j"].map(id => `spotify:track:${id}`);
const codes = ["US2641219402", "US2641005202", "US2641299902"];
const identities = uris.map((_, i) => ({ isrc: codes[i], artistIds: ["4f5V3PQ66nIrBCqugJtaGn"], durationMs: 334440, name: i === 1 ? "Altering The Future" : "Altering the Future" }));
const tags = Object.keys(defaultTagData.taxonomy.tagsById).slice(0, 2);

beforeEach(async () => {
  delete window.__tagifyRecordingChecks;
  indexedDBStorage.resetConnection(); localStorage.clear();
  localStorage.setItem("tagify:sync:account-id", "exact-release-test");
  vi.stubGlobal("indexedDB", new IDBFactory());
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: {
    [uris[0]]: { rating: 3, energy: 4, bpm: null, tagIds: [tags[0]], name: identities[0].name, recordingIdentity: identities[0], dateModified: 20, albumName: "Original" },
  } });
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("shares tags both ways across Heavynissen's exact three releases automatically, restores safely and shows one row", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(async uri => identities[uris.indexOf(uri)]);
  for (const uri of uris.slice(1)) {
    await checkAutomaticRecordingReuse({ uri, name: "Altering the Future" }, (await indexedDBStorage.loadAllStrict()).tracks, async () => undefined);
    expect(await indexedDBStorage.getTrack(uri)).toMatchObject({ rating: 3, energy: 4, tagIds: [tags[0]] });
  }
  const linked = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(new Set(uris.map(uri => linked[uri].recordingGroupId)).size).toBe(1);
  expect(linked[uris[0]].dateModified).toBe(20);
  expect(collapseRecordingEntries(Object.entries(linked), recordingDisplayKeys(linked))).toHaveLength(1);
  await indexedDBStorage.saveTrack(uris[1], { ...linked[uris[1]], rating: 5, energy: 8, tagIds: tags });
  const backup = normalizeTagDataStructure(JSON.parse(JSON.stringify(await indexedDBStorage.loadAllStrict())));
  await indexedDBStorage.saveAll(backup);
  delete window.__tagifyRecordingChecks; indexedDBStorage.resetConnection();
  for (const uri of uris) {
    await checkAutomaticRecordingReuse({ uri, name: "Altering the Future" }, backup.tracks, async () => undefined);
    expect(await indexedDBStorage.getTrack(uri)).toMatchObject({ rating: 5, energy: 8, tagIds: tags });
  }
  expect(lookup).toHaveBeenCalledTimes(2);
  await indexedDBStorage.saveTrack(uris[0], { ...backup.tracks[uris[0]], rating: 2, tagIds: [] });
  for (const uri of uris) expect(await indexedDBStorage.getTrack(uri)).toMatchObject({ rating: 2, energy: 8, tagIds: [] });
});

it("makes no Spotify requests and no records when a song has no saved candidates", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity");
  await checkAutomaticRecordingReuse({ uri: uris[1], name: "Unrelated song" }, (await indexedDBStorage.loadAllStrict()).tracks, async () => undefined);
  expect(lookup).not.toHaveBeenCalled();
  expect(await indexedDBStorage.getTrack(uris[1])).toBeNull();
});

it("combines different saved tags without a prompt, but preserves incompatible ratings", async () => {
  const source = (await indexedDBStorage.getTrack(uris[0]))!;
  await indexedDBStorage.saveTrack(uris[1], { ...source, tagIds: [tags[1]], recordingIdentity: identities[1], dateModified: 30 });
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity");
  await checkAutomaticRecordingReuse({ uri: uris[1], name: identities[1].name }, (await indexedDBStorage.loadAllStrict()).tracks, async () => undefined);
  for (const uri of uris.slice(0, 2)) expect((await indexedDBStorage.getTrack(uri))!.tagIds.sort()).toEqual([...tags].sort());
  expect((await indexedDBStorage.getTrack(uris[0]))!.dateModified).toBe(20);
  expect((await indexedDBStorage.getTrack(uris[1]))!.dateModified).toBe(30);
  await indexedDBStorage.saveTrack(uris[2], { ...source, rating: 1, recordingIdentity: identities[2], dateModified: 40 });
  await checkAutomaticRecordingReuse({ uri: uris[2], name: identities[2].name }, (await indexedDBStorage.loadAllStrict()).tracks, async () => undefined);
  expect(await indexedDBStorage.getTrack(uris[2])).toMatchObject({ rating: 1, dateModified: 40 });
  expect((await indexedDBStorage.getTrack(uris[2]))!.recordingGroupId).toBeUndefined();
  expect((await indexedDBStorage.getTrack(uris[0]))!.rating).toBe(3);
  expect(lookup).not.toHaveBeenCalled();
});
