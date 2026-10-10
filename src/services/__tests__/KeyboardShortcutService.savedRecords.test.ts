import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { PlaylistData, TagDataStructure, TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { LIBRARY_UNAVAILABLE_MESSAGE } from "@/extensions/extensionEdits";
import { keyboardShortcutService } from "../KeyboardShortcutService";

// Community issue 262: tags added a few seconds earlier vanished when a
// keyboard shortcut saved a copy of the song read before they were added.

const songUri = `spotify:track:${"a".repeat(22)}`;
const newSongUri = `spotify:track:${"b".repeat(22)}`;
const playlistUri = `spotify:playlist:${"c".repeat(22)}`;
const song: TrackData = {
  name: "Slide", artists: "Low", rating: 2, energy: 0, bpm: null, camelotKey: null,
  tagIds: ["rock"], dateCreated: 1_000, dateModified: 1_000,
};
const playlist: PlaylistData = {
  name: "Evening", rating: 0, energy: 0, tagIds: ["rock"], dateCreated: 1_000, dateModified: 1_000,
} as PlaylistData;

const spicetify = (globalThis as unknown as { Spicetify: typeof Spicetify }).Spicetify;
const player = spicetify.Player as unknown as { data: unknown };

const saved = async () => indexedDBStorage.loadAllStrict();
/** Saves a change the way the Tagify page does, without telling the shortcut service. */
const pageSavesTrack = async (uri: string, change: Partial<TrackData>) => {
  const current = (await saved()).tracks[uri];
  expect(await indexedDBStorage.saveTracks(new Map([[uri, { ...current, ...change }]]), { [uri]: current })).toBe(true);
};
const press = (code: string, shiftKey = false) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { code, shiftKey, bubbles: true, cancelable: true }));
const nextTrackChange = () => new Promise<{ trackUri: string; trackData: TrackData | null }>((resolve) => {
  window.addEventListener("tagify:trackChanged", (event) => resolve((event as CustomEvent).detail), { once: true });
});
const play = (uri: string) => {
  player.data = { item: { uri, name: "Slide", artists: [{ name: "Low" }] } };
};

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  indexedDBStorage.resetConnection();
  localStorage.setItem("tagify:idb-migration-status", JSON.stringify({ status: "completed" }));
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll({
    ...JSON.parse(JSON.stringify(defaultTagData)),
    schemaVersion: TAG_DATA_SCHEMA_VERSION,
    tracks: { [songUri]: song },
    playlists: { [playlistUri]: playlist },
  } as TagDataStructure)).toBe(true);
  expect((await storageService.initialize()).status).toBe("ready");
  vi.mocked(spicetify.showNotification).mockClear();
  play(songUri);
  await keyboardShortcutService.initialize();
});

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  keyboardShortcutService.destroy();
  indexedDBStorage.resetConnection();
  player.data = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps tags the Tagify page saved after the shortcut service started", async () => {
  await pageSavesTrack(songUri, { tagIds: ["rock", "pop"] });

  const change = nextTrackChange();
  press("Digit8");
  const { trackUri, trackData } = await change;

  const result = (await saved()).tracks[songUri];
  expect(result).toMatchObject({ rating: 4, tagIds: ["rock", "pop"] });
  // The page is told about the saved record itself, not a guess.
  expect(trackUri).toBe(songUri);
  expect(trackData).toEqual(result);
});

it("never treats a library read that failed as an empty library", async () => {
  keyboardShortcutService.destroy();
  vi.spyOn(storageService, "loadAll").mockRejectedValueOnce(new Error("read failed"));
  await keyboardShortcutService.initialize();

  const change = nextTrackChange();
  press("Digit8");
  await change;

  expect((await saved()).tracks[songUri]).toMatchObject({ rating: 4, tagIds: ["rock"], name: "Slide" });
});

it("refuses the change and says so when the library can't be read", async () => {
  const trackChanged = vi.fn();
  window.addEventListener("tagify:trackChanged", trackChanged);
  indexedDBStorage.resetConnection();
  const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
    throw new Error("The library is busy");
  });

  press("Digit8");
  await vi.waitFor(
    () => expect(spicetify.showNotification).toHaveBeenCalledWith(LIBRARY_UNAVAILABLE_MESSAGE, true),
    { timeout: 10_000 },
  );

  open.mockRestore();
  window.removeEventListener("tagify:trackChanged", trackChanged);
  expect(trackChanged).not.toHaveBeenCalled();
  expect((await saved()).tracks[songUri]).toEqual(song);
});

it("clears a rating only when the saved song already has it", async () => {
  await pageSavesTrack(songUri, { rating: 4 });

  const change = nextTrackChange();
  press("Digit8");
  await change;

  expect((await saved()).tracks[songUri]).toMatchObject({ rating: 0, tagIds: ["rock"] });
});

it("removes a cleared song only when nothing else is saved for it", async () => {
  await pageSavesTrack(songUri, { tagIds: [] });
  keyboardShortcutService.destroy();
  await keyboardShortcutService.initialize();
  await pageSavesTrack(songUri, { tagIds: ["jazz"] });

  let change = nextTrackChange();
  press("Digit4"); // 2 stars again: clears the rating
  await change;
  expect((await saved()).tracks[songUri]).toMatchObject({ rating: 0, tagIds: ["jazz"] });

  await pageSavesTrack(songUri, { rating: 2, tagIds: [] });
  change = nextTrackChange();
  press("Digit4");
  expect(await change).toEqual(expect.objectContaining({ trackUri: songUri, trackData: null }));
  expect((await saved()).tracks[songUri]).toBeUndefined();
});

it("fills a new song's tempo and key without undoing changes saved during the lookup", async () => {
  let finishLookup!: () => void;
  const lookup = new Promise<void>((resolve) => { finishLookup = resolve; });
  vi.spyOn(audioFeaturesService, "getAudioFeaturesFromUri").mockImplementation(async () => {
    await lookup;
    return { bpm: 120, camelotKey: "8A" } as Awaited<ReturnType<typeof audioFeaturesService.getAudioFeaturesFromUri>>;
  });
  play(newSongUri);

  let change = nextTrackChange();
  press("Digit8");
  await change;
  expect((await saved()).tracks[newSongUri]).toMatchObject({ rating: 4, bpm: null, name: "Slide", artists: "Low" });

  // While the lookup runs, the song is tagged, rated, and given a tempo.
  await pageSavesTrack(newSongUri, { tagIds: ["rock"], rating: 5, bpm: 128, dateModified: 5_000 });
  change = nextTrackChange();
  finishLookup();
  const { trackData } = await change;

  const result = (await saved()).tracks[newSongUri];
  expect(result).toMatchObject({ tagIds: ["rock"], rating: 5, bpm: 128, camelotKey: "8A", dateModified: 5_000 });
  expect(trackData).toEqual(result);
});

it("keeps playlist tags saved after the shortcut service started", async () => {
  localStorage.setItem("tagify:appMounted", "true");
  localStorage.setItem("tagify:shortcutTarget", JSON.stringify({ view: "playlists", playlistUri }));
  const current = (await saved()).playlists[playlistUri];
  expect(await indexedDBStorage.savePlaylists(new Map([[playlistUri, { ...current, tagIds: ["rock", "pop"] }]]), { [playlistUri]: current })).toBe(true);

  const change = new Promise<{ playlistData: PlaylistData }>((resolve) => {
    window.addEventListener("tagify:playlistChanged", (event) => resolve((event as CustomEvent).detail), { once: true });
  });
  press("Digit6");
  const { playlistData } = await change;

  const result = (await saved()).playlists[playlistUri];
  expect(result).toMatchObject({ rating: 3, tagIds: ["rock", "pop"], name: "Evening" });
  expect(playlistData).toEqual(result);
});
