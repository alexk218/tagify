import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { communitySongReleaseSources } from "@/services/sync/CommunitySongReleaseSources";
import { TAG_DATA_UPDATED_EVENT } from "@/features/tag-data/utils/tagData.events";
import { confirmedRecordingSets, recordingCandidates } from "../../utils/recordingLibrary";
import { checkAutomaticRecordingReuse } from "../automaticRecordingReuse";

// A Discord member's song: one recording (ISRC JPE561200583) on Spotify under a Japanese
// title and a romanized title. No title rule can pair them; only the ISRC does.
const japanese = "spotify:track:0FM31M7JGTYVgwcXJRZyTi";
const romanized = "spotify:track:7vuklW2wWZysUHbQigchbX";
const artist = "4f5V3PQ66nIrBCqugJtaGn";
const identity = (name: string) => ({ isrc: "JPE561200583", artistIds: [artist], leadArtistId: artist, durationMs: 254_000, name });
const tags = Object.keys(defaultTagData.taxonomy.tagsById).slice(0, 1);

beforeEach(async () => {
  delete window.__tagifyRecordingChecks;
  indexedDBStorage.resetConnection(); localStorage.clear();
  localStorage.setItem("tagify:sync:account-id", "isrc-only-test");
  vi.stubGlobal("indexedDB", new IDBFactory());
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: {
    [japanese]: { rating: 4, energy: 6, bpm: null, tagIds: tags, name: "夜に駆ける", recordingIdentity: identity("夜に駆ける"), dateModified: 20 },
  } });
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("links a viewed song whose title matches nothing to the saved song with its ISRC, with one background lookup", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity("Yoru ni Kakeru"));
  await checkAutomaticRecordingReuse({ uri: romanized, name: "Yoru ni Kakeru" }, (await indexedDBStorage.loadAllStrict()).tracks, async () => undefined);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledWith(romanized, undefined, expect.objectContaining({ priority: "background" }));
  const linked = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(linked[romanized]).toMatchObject({ rating: 4, energy: 6, tagIds: tags });
  expect(linked[romanized].recordingGroupId).toBeDefined();
  expect(linked[romanized].recordingGroupId).toBe(linked[japanese].recordingGroupId);
  expect(linked[japanese].dateModified).toBe(20);
});

it("saves the looked-up identity on a saved song, so the library check pairs it by ISRC", async () => {
  await indexedDBStorage.saveTrack(romanized, { rating: 0, energy: 0, bpm: null, tagIds: [], name: "Yoru ni Kakeru", dateModified: 30 });
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity("Yoru ni Kakeru"));
  const onChanged = vi.fn(async () => undefined);
  await checkAutomaticRecordingReuse({ uri: romanized, name: "Yoru ni Kakeru" }, (await indexedDBStorage.loadAllStrict()).tracks, onChanged);
  const saved = (await indexedDBStorage.loadAllStrict()).tracks;
  expect(saved[romanized].recordingIdentity).toMatchObject({ isrc: "JPE561200583" });
  expect(saved[romanized].dateModified).toBe(30);
  expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ [romanized]: expect.anything() }), {});
  expect(recordingCandidates(saved)).toEqual([[japanese, romanized].sort()]);
  expect(confirmedRecordingSets(saved)).toHaveLength(1);
});

it("saves identities from Community's song release reads on saved songs only, without changing dateModified", async () => {
  await indexedDBStorage.saveTrack(romanized, { rating: 0, energy: 0, bpm: null, tagIds: [], name: "Yoru ni Kakeru", dateModified: 30 });
  const updated = vi.fn();
  window.addEventListener(TAG_DATA_UPDATED_EVENT, updated);
  try {
    const unsaved = "spotify:track:39vBNPpuGv5U6MlNMa346j";
    await communitySongReleaseSources().rememberIdentities!({ [romanized]: identity("Yoru ni Kakeru"), [unsaved]: identity("Other") });
    const saved = (await indexedDBStorage.loadAllStrict()).tracks;
    expect(saved[romanized]).toMatchObject({ dateModified: 30, rating: 0, tagIds: [], recordingIdentity: identity("Yoru ni Kakeru") });
    expect(saved[unsaved]).toBeUndefined();
    expect(updated).toHaveBeenCalledTimes(1);
    // The library check now finds the pair by ISRC and can link it without any request.
    expect(confirmedRecordingSets(saved).map(set => set.entries.map(([uri]) => uri).sort())).toEqual([[japanese, romanized].sort()]);

    // A song that already has an identity keeps it, and nothing new means no reload.
    await communitySongReleaseSources().rememberIdentities!({ [japanese]: identity("Changed") });
    expect((await indexedDBStorage.getTrack(japanese))!.recordingIdentity!.name).toBe("夜に駆ける");
    expect(updated).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener(TAG_DATA_UPDATED_EVENT, updated); }
});

it("doesn't save identities into an account that was switched away from", async () => {
  await indexedDBStorage.saveTrack(romanized, { rating: 0, energy: 0, bpm: null, tagIds: [], name: "Yoru ni Kakeru", dateModified: 30 });
  await communitySongReleaseSources("another-account").rememberIdentities!({ [romanized]: identity("Yoru ni Kakeru") });
  expect((await indexedDBStorage.getTrack(romanized))!.recordingIdentity).toBeUndefined();
});
