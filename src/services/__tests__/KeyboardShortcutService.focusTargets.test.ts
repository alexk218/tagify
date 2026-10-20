import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { keyboardShortcutService } from "../KeyboardShortcutService";

// Pressing a digit while the Invite a friend panel had focus (its Copy link button or the
// read-only link box) silently rated the playing song.

const songUri = `spotify:track:${"a".repeat(22)}`;
const song: TrackData = {
  name: "Slide", artists: "Low", rating: 2, energy: 3, bpm: null, camelotKey: null,
  tagIds: ["rock"], dateCreated: 1_000, dateModified: 1_000,
};

const spicetify = (globalThis as unknown as { Spicetify: typeof Spicetify }).Spicetify;
const player = spicetify.Player as unknown as { data: unknown };

const saved = async () => (await indexedDBStorage.loadAllStrict()).tracks[songUri];
const press = (target: EventTarget, code: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { code, shiftKey, bubbles: true, cancelable: true }));

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  indexedDBStorage.resetConnection();
  localStorage.setItem("tagify:idb-migration-status", JSON.stringify({ status: "completed" }));
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll({
    ...JSON.parse(JSON.stringify(defaultTagData)),
    schemaVersion: TAG_DATA_SCHEMA_VERSION,
    tracks: { [songUri]: song },
  } as TagDataStructure)).toBe(true);
  expect((await storageService.initialize()).status).toBe("ready");
  player.data = { item: { uri: songUri, name: "Slide", artists: [{ name: "Low" }] } };
  await keyboardShortcutService.initialize();
});

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  keyboardShortcutService.destroy();
  indexedDBStorage.resetConnection();
  player.data = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("leaves digits pressed in the Invite a friend panel to the panel", async () => {
  document.body.innerHTML = `
    <div role="dialog" aria-labelledby="tagify-invite-title">
      <div id="link" role="textbox" aria-readonly="true" tabindex="0">https://community.tagify.fm/join/alex</div>
      <button id="copy">Copy link</button>
    </div>
    <button id="invite">Invite a friend to Tagify</button>`;
  const trackChanged = vi.fn();
  window.addEventListener("tagify:trackChanged", trackChanged);

  const copy = document.getElementById("copy")!;
  // Not cancelled: the key reaches the focused control as usual.
  expect(press(copy, "Digit6")).toBe(true);
  expect(press(copy, "Digit2", true)).toBe(true);
  expect(press(document.getElementById("link")!, "Digit8")).toBe(true);

  // Shortcuts still work once focus is back on the page.
  const change = new Promise((resolve) => window.addEventListener("tagify:trackChanged", resolve, { once: true }));
  expect(press(document.getElementById("invite")!, "Digit0")).toBe(false);
  await change;

  window.removeEventListener("tagify:trackChanged", trackChanged);
  expect(trackChanged).toHaveBeenCalledTimes(1);
  expect(await saved()).toMatchObject({ rating: 5, energy: 3 });
});
