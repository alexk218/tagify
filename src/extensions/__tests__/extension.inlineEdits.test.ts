import { IDBDatabase as FakeIDBDatabase, IDBFactory, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { discussion39Releases, discussion39Artists } from "../../../scripts/tests/fixtures/discussion39";
import { storageService } from "@/services/storage/StorageService";
import { registerLocalPersistenceFlusher } from "@/services/sync/SyncLocalState";
import { LIBRARY_UNAVAILABLE_MESSAGE } from "../extensionEdits";

// Community issue 262: tags added a few seconds earlier vanished when the
// stars, energy, and tag controls in Spotify's own views saved a copy of the
// song that was read before those tags were saved.

vi.mock("@/services/sync/SyncRuntime", () => ({ syncRuntime: { start: vi.fn() } }));
vi.mock("@/services/sync/SyncInstallRecovery", () => ({ restoreDesktopSyncConfiguration: vi.fn(async () => undefined) }));
vi.mock("@/services/SmartPlaylistSyncService", () => ({
  smartPlaylistSyncService: { syncTrack: vi.fn(async () => undefined), startBackgroundReconciliation: vi.fn() },
}));
vi.mock("@/services/KeyboardShortcutService", () => ({ keyboardShortcutService: { initialize: vi.fn() } }));
vi.mock("@/extensions/WelcomeModal", () => ({ welcomeModal: { initialize: vi.fn() } }));
vi.mock("@/features/smart-playlists/utils/smartPlaylist.storage", () => ({ loadSmartPlaylistsFromStorage: vi.fn(async () => []) }));
// The test page must never ask the real Community site for tag names.
vi.mock("@/features/tag-data/utils/communityPopularTags", () => ({ preloadCommunityPopularTags: vi.fn(async () => undefined), getCommunityPopularTags: () => [] }));

const tagId = (name: string) =>
  Object.values(defaultTagData.taxonomy.tagsById).find((tag) => tag.name === name)!.id;
const [rock, pop, jazz] = [tagId("Rock"), tagId("Pop"), tagId("Jazz")];
const songUri = `spotify:track:${"e".repeat(22)}`;
const song: TrackData = {
  name: "Slide", artists: "Low", rating: 2, energy: 0, bpm: null, camelotKey: null,
  tagIds: [rock], dateCreated: 1_000, dateModified: 1_000,
};
const library = (): TagDataStructure => ({
  ...JSON.parse(JSON.stringify(defaultTagData)),
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  tracks: { [songUri]: song },
});

const spicetify = (globalThis as unknown as { Spicetify: typeof Spicetify }).Spicetify;
let extensionLoaded = false;
let testAccount = 0;

// Generous limits: the whole extension starts up inside the test page.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const eventually = (assertion: () => unknown) => vi.waitFor(assertion, { timeout: 10_000, interval: 20 });
const savedSong = async () => (await indexedDBStorage.loadAllStrict()).tracks[songUri];
const control = () => document.querySelector<HTMLElement>(".tagify-playbar-info .tagify-inline-editor");
const button = (label: string) => control()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;

/** The Tagify page saves this song at the moment the next change to songs is written. */
function pageSavesDuringNextWrite(change: (track: TrackData & { uri: string }) => TrackData & { uri: string }) {
  const transaction = FakeIDBDatabase.prototype.transaction;
  const spy = vi.spyOn(FakeIDBDatabase.prototype, "transaction").mockImplementation(function (
    this: IDBDatabase, stores: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions,
  ) {
    if (mode === "readwrite" && [stores].flat().includes("tracks")) {
      spy.mockRestore();
      const pageWrite = transaction.call(this, ["tracks"], "readwrite");
      const store = pageWrite.objectStore("tracks");
      const request = store.get(songUri);
      request.onsuccess = () => store.put(change(request.result));
    }
    return transaction.call(this, stores, mode, options);
  } as typeof transaction);
  return spy;
}

beforeEach(async () => {
  delete window.__tagifyRecordingChecks;
  // The extension stays mounted across tests; fresh databases need fresh accounts
  // so a previous test's visibility/signature cache cannot suppress a new check.
  localStorage.setItem("tagify:sync:account-id", `inline-edits-${++testAccount}`);
  vi.stubGlobal("indexedDB", new IDBFactory());
  indexedDBStorage.resetConnection();
  localStorage.setItem("tagify:idb-migration-status", JSON.stringify({ status: "completed" }));
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll(library())).toBe(true);
  expect((await storageService.initialize()).status).toBe("ready");
  vi.mocked(spicetify.showNotification).mockClear();

  if (!extensionLoaded) {
    localStorage.setItem("tagify:extensionSettings", JSON.stringify({ tracklistDisplayMode: "disabled", playbarDisplayMode: "combined" }));
    document.body.innerHTML = '<div data-testid="now-playing-widget"><div class="main-trackInfo-container">Slide</div></div>';
    (spicetify.Player as unknown as { data: unknown }).data = { item: { uri: songUri, name: "Slide" } };
    // @ts-expect-error -- the extension entry point is a plain script without type declarations
    await import("../extension.js");
    extensionLoaded = true;
  } else {
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
  }
  // The now-playing controls show the saved two-star rating.
  await eventually(() => expect(button("Clear 2 star rating")).not.toBeNull());
});

afterEach(() => {
  document.querySelector(".tagify-inline-menu")?.remove();
  indexedDBStorage.resetConnection();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // Stop the now-playing controls before the test page closes.
  window.dispatchEvent(new CustomEvent("tagify:settingsChanged", {
    detail: { tracklistDisplayMode: "disabled", playbarDisplayMode: "disabled" },
  }));
  document.body.replaceChildren();
  await new Promise((resolve) => setTimeout(resolve, 50));
});

it("keeps tags the Tagify page saves while a star rating is being saved", async () => {
  pageSavesDuringNextWrite((track) => ({ ...track, tagIds: [...track.tagIds, pop] }));

  button("Set rating to 4 stars")!.click();

  await eventually(async () => expect(await savedSong()).toMatchObject({ rating: 4 }));
  expect((await savedSong()).tagIds).toEqual([rock, pop]);
  await eventually(() => expect(button("Clear 4 star rating")).not.toBeNull());
});

it("keeps a tag the Tagify page was still saving when a quick tag is added", async () => {
  let pending = true;
  const unregister = registerLocalPersistenceFlusher(async () => {
    if (!pending) return;
    pending = false;
    const current = await savedSong();
    await indexedDBStorage.saveTracks(new Map([[songUri, { ...current, tagIds: [...current.tagIds, pop] }]]), { [songUri]: current });
  });

  try {
    control()!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    document.querySelector<HTMLButtonElement>(`.tagify-inline-menu button[data-tagify-tag-id="${jazz}"]`)!.click();

    await eventually(async () => expect((await savedSong()).tagIds).toContain(jazz));
    expect((await savedSong()).tagIds).toEqual([rock, pop, jazz]);
  } finally {
    unregister();
  }
});

it("keeps tags the Tagify page saves while a new tag is created and applied", async () => {
  control()!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  const input = document.querySelector<HTMLInputElement>(".tagify-inline-menu .tagify-quick-tag-search input")!;
  input.value = "Shoegaze";
  input.dispatchEvent(new Event("input"));
  pageSavesDuringNextWrite((track) => ({ ...track, tagIds: [...track.tagIds, pop] }));
  [...document.querySelectorAll<HTMLButtonElement>(".tagify-inline-menu button")]
    .find((element) => element.textContent?.startsWith("Create and apply"))!
    .click();

  await eventually(async () => expect((await savedSong()).tagIds).toHaveLength(3));
  const { taxonomy } = await indexedDBStorage.loadAllStrict();
  const shoegaze = Object.values(taxonomy.tagsById).find((tag) => tag.name === "Shoegaze")!;
  expect((await savedSong()).tagIds).toEqual([rock, pop, shoegaze.id]);
});

/** Counts whole-library reads (every saved song read at once). */
async function countLibraryReads() {
  await new Promise((resolve) => setTimeout(resolve, 400)); // let earlier reads finish
  const getAll = FakeIDBObjectStore.prototype.getAll;
  let reads = 0;
  const spy = vi.spyOn(FakeIDBObjectStore.prototype, "getAll").mockImplementation(function (
    this: IDBObjectStore, ...args: Parameters<IDBObjectStore["getAll"]>
  ) {
    if (this.name === "tracks") reads += 1;
    return getAll.apply(this, args);
  } as typeof getAll);
  return { reads: () => reads, restore: () => spy.mockRestore() };
}

it("shows its own saved edits without reading the whole library again", async () => {
  const library = await countLibraryReads();
  try {
    button("Set rating to 4 stars")!.click();
    await eventually(() => expect(button("Clear 4 star rating")).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(library.reads()).toBe(0);
  } finally {
    library.restore();
  }
  expect(await savedSong()).toMatchObject({ rating: 4, tagIds: [rock] });
});

it("reads the library once for a burst of changes saved elsewhere", async () => {
  const current = await savedSong();
  const library = await countLibraryReads();
  try {
    await indexedDBStorage.saveTracks(new Map([[songUri, { ...current, rating: 5 }]]), { [songUri]: current });
    for (let save = 0; save < 5; save += 1) {
      window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
    }
    await eventually(() => expect(button("Clear 5 star rating")).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(library.reads()).toBe(1);
  } finally {
    library.restore();
  }
});

it("applies an edit to the saved song, never an older copy, while the library view can't be read", async () => {
  // An old copy from before the library moved to its current storage.
  localStorage.setItem("tagify:tagData", JSON.stringify({
    ...library(), tracks: { [songUri]: { ...song, rating: 1, tagIds: [] } },
  }));
  const getAll = vi.spyOn(FakeIDBObjectStore.prototype, "getAll").mockImplementation(() => {
    throw new Error("The library is busy");
  });

  try {
    // Something else changed the library, and reading it again fails.
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
    await eventually(() => expect(getAll).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    button("Set rating to 4 stars")!.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    getAll.mockRestore();
  }
  // Only the rating changed on the saved song; nothing came from the older copy.
  await eventually(async () => expect(await savedSong()).toMatchObject({ name: "Slide", rating: 4, tagIds: [rock], dateCreated: 1_000 }));
  expect(spicetify.showNotification).not.toHaveBeenCalledWith(LIBRARY_UNAVAILABLE_MESSAGE, true);
});


it.each(["legacy", "modern"])("checks an exact duplicate in Spotify’s %s rows without playback or opening Tagify and updates immediately", async layout => {
  const [sourceUri, duplicateUri] = discussion39Releases.map(release => `spotify:track:${release.id}`);
  const name = discussion39Releases[0].name;
  const identity = { isrc: "GBAHS2600027", artistIds: discussion39Artists.map(artist => artist.id), durationMs: 192000, name };
  await indexedDBStorage.saveTrack(sourceUri, { ...song, name, recordingIdentity: identity });
  window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
  await new Promise(resolve => setTimeout(resolve, 400));
  let finish!: (value: typeof identity) => void;
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const main = document.createElement("main");
  main.innerHTML = `<div class="main-trackList-indexable" role="grid"><div role="row" class="main-trackList-trackListRow"><div role="gridcell" aria-colindex="1">1</div><div role="gridcell" aria-colindex="2"><div class="main-trackList-rowMainContentTitle">${name}</div></div><div role="gridcell" aria-colindex="3">3:12</div></div></div>`;
  const row = main.querySelector("[role=row]")!;
  if (layout === "modern") {
    row.querySelector(".main-trackList-rowMainContentTitle")!.outerHTML = `<a href="/track/${duplicateUri.split(":")[2]}">${name}</a>`;
  }
  (row as unknown as Record<string, unknown>).__reactFiber$test = { memoizedProps: { uri: duplicateUri } };
  document.body.appendChild(main);
  window.dispatchEvent(new CustomEvent("tagify:settingsChanged", { detail: { tracklistDisplayMode: "combined" } }));
  try {
    await eventually(() => expect(lookup).toHaveBeenCalledTimes(1));
    await eventually(() => expect(row.querySelector('[aria-label="Checking saved tags…"]')).not.toBeNull());
    finish({ ...identity, isrc: "GBAHS2600028" });
    await eventually(() => expect(row.querySelector('[aria-label="Edit applied tags: Rock"]')).not.toBeNull());
    await eventually(async () => expect(await indexedDBStorage.getTrack(duplicateUri)).toMatchObject({ tagIds: [rock], rating: 2 }));
    expect((await indexedDBStorage.getTrack(sourceUri))!.dateModified).toBe(song.dateModified);
    row.querySelector<HTMLButtonElement>('[aria-label="Set rating to 4 stars"]')!.click();
    await eventually(async () => expect(await indexedDBStorage.getTrack(sourceUri)).toMatchObject({ rating: 4, tagIds: [rock] }));
    await eventually(() => expect(row.querySelector('[aria-label="Clear 4 star rating"]')).not.toBeNull());
    expect(lookup).toHaveBeenCalledTimes(1);
  } finally {
    main.remove(); lookup.mockRestore();
    window.dispatchEvent(new CustomEvent("tagify:settingsChanged", { detail: { tracklistDisplayMode: "disabled" } }));
  }
});

it("checks an unopened matching release directly in the playbar without a track list", async () => {
  const [sourceUri, duplicateUri] = discussion39Releases.map(release => `spotify:track:${release.id}`);
  const name = discussion39Releases[0].name;
  const identity = { isrc: "GBAHS2600027", artistIds: discussion39Artists.map(artist => artist.id), durationMs: 192000, name };
  await indexedDBStorage.saveTrack(sourceUri, { ...song, name, recordingIdentity: identity });
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  const player = spicetify.Player as unknown as { data: unknown };
  const previous = player.data;
  try {
    player.data = { item: { uri: duplicateUri, name } };
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
    await eventually(() => expect(control()?.dataset.tagifyTrackUri).toBe(duplicateUri));
    await eventually(() => expect(button("Clear 2 star rating")).not.toBeNull());
    await eventually(async () => expect(await indexedDBStorage.getTrack(duplicateUri)).toMatchObject({ tagIds: [rock], rating: 2 }));
    expect((await indexedDBStorage.getTrack(sourceUri))!.dateModified).toBe(song.dateModified);
    expect(lookup).toHaveBeenCalledWith(duplicateUri, undefined, { priority: "foreground", feature: "recording-matching" });
  } finally {
    player.data = previous;
    lookup.mockRestore();
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
  }
});

it("matches an unopened song in a 30,000-song tagged library without rereading the whole library", async () => {
  const [sourceUri, duplicateUri] = discussion39Releases.map(release => `spotify:track:${release.id}`);
  const name = discussion39Releases[0].name;
  const identity = { isrc: "GBAHS2600027", artistIds: discussion39Artists.map(artist => artist.id), durationMs: 192000, name };
  const tracks: Record<string, TrackData> = Object.fromEntries(Array.from({ length: 30_000 }, (_, index) => [
    `spotify:track:${String(index).padStart(22, "0")}`, { ...song, name: `Tagged song ${index}`, dateModified: index + 1 },
  ]));
  tracks[sourceUri] = { ...song, name, recordingIdentity: identity };
  window.dispatchEvent(new CustomEvent("tagify:settingsChanged", { detail: { tracklistDisplayMode: "combined" } }));
  const initialLoad = vi.spyOn(indexedDBStorage, "loadAllStrict");
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  const player = spicetify.Player as unknown as { data: unknown };
  const previous = player.data;
  try {
    expect(await indexedDBStorage.saveAll({ ...library(), tracks })).toBe(true);
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
    await eventually(() => expect(initialLoad).toHaveBeenCalled());
    await initialLoad.mock.results.at(-1)!.value;
    // The IDB promise resolves before the extension finishes normalizing and
    // showing its new library. Starting playback earlier races that setup read.
    await eventually(() => expect((window as unknown as { tagifyDebug: { getData: () => Record<string, TrackData> } }).tagifyDebug.getData()[`spotify:track:${String(29_999).padStart(22, "0")}`]?.name).toBe("Tagged song 29999"));
    // A previous test's refresh can already be in flight when this fixture is
    // saved. Drain its queued 200ms refresh before measuring playback's reads.
    await eventually(async () => {
      const count = initialLoad.mock.calls.length;
      await Promise.all(initialLoad.mock.results.map(result => result.value));
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(initialLoad.mock.calls.length).toBe(count);
    });
    initialLoad.mockClear();
    player.data = { item: { uri: duplicateUri, name } };
    const songChange = (vi.mocked(spicetify.Player.addEventListener).mock.calls as unknown as [string, () => void][]).find(([event]) => event === "songchange")![1] as () => void;
    songChange();
    await eventually(() => expect(control()?.dataset.tagifyTrackUri).toBe(duplicateUri));
    await eventually(() => expect(button("Clear 2 star rating")).not.toBeNull());
    await eventually(async () => expect(await indexedDBStorage.getTrack(duplicateUri)).toMatchObject({ tagIds: [rock], rating: 2 }));
    expect((await indexedDBStorage.getTrack(sourceUri))!.dateModified).toBe(song.dateModified);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(initialLoad).not.toHaveBeenCalled();
  } finally {
    player.data = previous; lookup.mockRestore(); initialLoad.mockRestore();
    window.dispatchEvent(new CustomEvent("tagify:settingsChanged", { detail: { tracklistDisplayMode: "disabled" } }));
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
  }
}, 60_000);

it("finds a newly tagged source after warming its title index without reloading the library", async () => {
  const source = `spotify:track:${"s".repeat(22)}`, target = `spotify:track:${"t".repeat(22)}`;
  const name = "Newly tagged recording";
  const identity = { isrc: "USABC2400001", artistIds: ["c".repeat(22)], durationMs: 180000, name };
  const player = spicetify.Player as unknown as { data: unknown };
  const previous = player.data;
  const songChange = (vi.mocked(spicetify.Player.addEventListener).mock.calls as unknown as [string, () => void][]).find(([event]) => event === "songchange")![1];
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  const fullRead = vi.spyOn(indexedDBStorage, "loadAllStrict");
  try {
    player.data = { item: { uri: target, name } }; songChange();
    await eventually(() => expect(control()?.dataset.tagifyTrackUri).toBe(target));
    expect(lookup).not.toHaveBeenCalled();
    const saved = { ...song, name, recordingIdentity: identity };
    await indexedDBStorage.saveTrack(source, saved);
    fullRead.mockClear();
    window.dispatchEvent(new CustomEvent("tagify:trackChanged", { detail: { trackUri: source, trackData: saved, timestamp: Date.now() } }));
    songChange();
    await eventually(async () => expect(await indexedDBStorage.getTrack(target)).toMatchObject({ rating: 2, tagIds: [rock] }));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fullRead).not.toHaveBeenCalled();
  } finally {
    player.data = previous; lookup.mockRestore(); fullRead.mockRestore();
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
  }
});

it("updates all three simultaneous playlist columns when tags are added or removed from any release", async () => {
  const ids = ["0FM31M7JGTYVgwcXJRZyTi", "7vuklW2wWZysUHbQigchbX", "39vBNPpuGv5U6MlNMa346j"];
  const codes = ["US2641219402", "US2641005202", "US2641299902"];
  const uris = ids.map(id => `spotify:track:${id}`);
  const name = "Altering the Future";
  const identity = (i: number) => ({ isrc: codes[i], artistIds: ["4f5V3PQ66nIrBCqugJtaGn"], durationMs: 334440, name });
  await indexedDBStorage.saveTrack(uris[0], { ...song, name, recordingIdentity: identity(0) });
  window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
  await new Promise(resolve => setTimeout(resolve, 400));
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(async uri => identity(uris.indexOf(uri)));
  const main = document.createElement("main");
  main.innerHTML = `<div class="main-trackList-indexable" role="grid">${ids.map((id, index) => `<div role="row" class="main-trackList-trackListRow"><div role="gridcell" aria-colindex="1">${index + 1}</div><div role="gridcell" aria-colindex="2"><a href="/track/${id}">${name}</a></div><div role="gridcell" aria-colindex="3">5:34</div></div>`).join("")}</div>`;
  const rows = [...main.querySelectorAll<HTMLElement>("[role=row]")];
  rows.forEach((row, index) => Object.assign(row, { __reactFiber$test: { memoizedProps: { uri: uris[index] } } }));
  document.body.append(main);
  window.dispatchEvent(new CustomEvent("tagify:settingsChanged", { detail: { tracklistDisplayMode: "combined" } }));
  const checkTags = async (tags: string[]) => {
    await eventually(async () => {
      for (const uri of uris) expect((await indexedDBStorage.getTrack(uri))?.tagIds.slice().sort()).toEqual([...tags].sort());
      for (const row of rows) {
        const label = row.querySelector('[aria-label^="Edit applied tags"]')?.getAttribute("aria-label") || "";
        expect(label.includes("Rock")).toBe(tags.includes(rock));
        expect(label.includes("Jazz")).toBe(tags.includes(jazz));
      }
    });
  };
  const toggleTag = async (row: HTMLElement, tag: string) => {
    row.querySelector<HTMLElement>(".tagify-inline-editor")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    await eventually(() => expect(document.querySelector(`.tagify-inline-menu button[data-tagify-tag-id="${tag}"]`)).not.toBeNull());
    document.querySelector<HTMLButtonElement>(`.tagify-inline-menu button[data-tagify-tag-id="${tag}"]`)!.click();
    document.querySelector(".tagify-inline-menu")?.remove();
  };
  try {
    await checkTags([rock]);
    await toggleTag(rows[1], jazz); await checkTags([rock, jazz]);
    await toggleTag(rows[2], rock); await checkTags([jazz]);
    rows[1].querySelector<HTMLButtonElement>('[aria-label="Clear 2 star rating"]')!.click();
    await eventually(async () => {
      for (const uri of uris) expect((await indexedDBStorage.getTrack(uri))?.rating).toBe(0);
    });
    await toggleTag(rows[0], jazz); await checkTags([]);
    // The Tagify page writes shared storage and broadcasts this save event.
    await indexedDBStorage.saveTrack(uris[0], { ...(await indexedDBStorage.getTrack(uris[0]))!, tagIds: [rock], rating: 4, energy: 8 });
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
    await checkTags([rock]);
    await eventually(() => {
      for (const row of rows) {
        expect(row.querySelector('[aria-label="Clear 4 star rating"]')).not.toBeNull();
        expect(row.querySelector('[aria-label="Edit energy 8"]')).not.toBeNull();
      }
    });
    expect(lookup).toHaveBeenCalledTimes(2);
  } finally {
    main.remove(); lookup.mockRestore();
    window.dispatchEvent(new CustomEvent("tagify:settingsChanged", { detail: { tracklistDisplayMode: "disabled" } }));
  }
});

it("repairs a nameless five-star single from its visible row and updates the album column", async () => {
  const single = "spotify:track:4PkAV9y5D0Cp7XAWBmh55t", album = "spotify:track:4JJODZSD4UqV4lQfM7gnD3";
  const legacy = { rating: 5, energy: 0, bpm: 112, camelotKey: "11A", tagIds: [], dateModified: 42 };
  await indexedDBStorage.saveTrack(single, legacy);
  window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
  await new Promise(resolve => setTimeout(resolve, 400));
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue({ isrc: "QMDA62673614", artistIds: ["3SEr9Sytj074YnBHmoI4Bd"], durationMs: 370025, name: "Seventh Ciel" });
  const main = document.createElement("main");
  main.innerHTML = `<div class="main-trackList-indexable" role="grid">${[album, single].map((_, index) => `<div role="row" class="main-trackList-trackListRow"><div role="gridcell" aria-colindex="1">${index + 1}</div><div role="gridcell" aria-colindex="2"><div class="main-trackList-rowMainContentTitle"><mark>Seven</mark><span>th Ciel</span></div><div class="main-trackList-rowMainContentSubTitle">SimbaSōl</div></div><div role="gridcell" aria-colindex="3">6:10</div></div>`).join("")}</div>`;
  const rows = [...main.querySelectorAll<HTMLElement>("[role=row]")];
  rows.forEach((row, index) => Object.assign(row, { __reactFiber$test: { memoizedProps: { uri: [album, single][index] } } }));
  document.body.append(main);
  window.dispatchEvent(new CustomEvent("tagify:settingsChanged", { detail: { tracklistDisplayMode: "combined" } }));
  try {
    await eventually(async () => {
      expect(await indexedDBStorage.getTrack(single)).toMatchObject({ name: "Seventh Ciel", artists: "SimbaSōl", rating: 5, dateModified: 42 });
      expect(await indexedDBStorage.getTrack(album)).toMatchObject({ rating: 5 });
      rows.forEach(row => expect(row.querySelector('[aria-label="Clear 5 star rating"]')).not.toBeNull());
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    rows[0].querySelector<HTMLButtonElement>('[aria-label="Set rating to 4 stars"]')!.click();
    await eventually(async () => {
      expect((await indexedDBStorage.getTrack(single))?.rating).toBe(4);
      rows.forEach(row => expect(row.querySelector('[aria-label="Clear 4 star rating"]')).not.toBeNull());
    });
    expect(lookup).toHaveBeenCalledTimes(2);
  } finally {
    main.remove(); lookup.mockRestore();
    window.dispatchEvent(new CustomEvent("tagify:settingsChanged", { detail: { tracklistDisplayMode: "disabled" } }));
  }
});

it("retains the available title when rating a previously unsaved song from the playbar", async () => {
  const uri = "spotify:track:4PkAV9y5D0Cp7XAWBmh55t";
  const player = spicetify.Player as unknown as { data: unknown };
  const previous = player.data;
  const songChange = (vi.mocked(spicetify.Player.addEventListener).mock.calls as unknown as [string, () => void][]).find(([event]) => event === "songchange")![1];
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity");
  player.data = { item: { uri, name: "Seventh Ciel", metadata: { artist_name: "SimbaSōl" } } };
  songChange();
  try {
    await eventually(() => expect(control()?.dataset.tagifyTrackUri).toBe(uri));
    button("Set rating to 5 stars")!.click();
    await eventually(async () => expect(await indexedDBStorage.getTrack(uri)).toMatchObject({ rating: 5, name: "Seventh Ciel", artists: "SimbaSōl" }));
    expect(lookup).not.toHaveBeenCalled();
  } finally { lookup.mockRestore(); player.data = previous; songChange(); }
});
