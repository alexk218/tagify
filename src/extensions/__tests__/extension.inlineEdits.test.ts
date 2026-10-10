import { IDBDatabase as FakeIDBDatabase, IDBFactory, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
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
