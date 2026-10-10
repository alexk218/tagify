import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY } from "../tagData.backup";
import { startTrailingFileBackups } from "../tagData.backupContents";
import { dispatchTagDataUpdatedEvent } from "../tagData.events";

const uri = `spotify:track:${"t".repeat(22)}`;
let files: string[] = [];
let stop: (() => void) | null = null;

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  files = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { files.push(this.download); });
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll({
    ...defaultTagData, tracks: { [uri]: { rating: 5, energy: 0, bpm: null, tagIds: [], dateModified: 1 } }, smartPlaylists: [],
  })).toBe(true);
});

afterEach(() => {
  stop?.();
  stop = null;
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.restoreAllMocks();
  indexedDBStorage.resetConnection();
  vi.unstubAllGlobals();
});

describe("saving the newest changes to a backup file", () => {
  it("saves a file once the library stops changing", async () => {
    stop = startTrailingFileBackups({ idleMs: 20 });

    dispatchTagDataUpdatedEvent("save");

    await waitFor(() => files.length === 1);
    expect(files[0]).toMatch(/^tagify-auto-backup-/);
  });

  it("saves right away when Spotify hides the page", async () => {
    stop = startTrailingFileBackups({ idleMs: 60_000 });
    dispatchTagDataUpdatedEvent("save");

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => files.length === 1);
  });

  it("saves a pending change when the page closes", async () => {
    stop = startTrailingFileBackups({ idleMs: 60_000 });
    dispatchTagDataUpdatedEvent("save");

    stop();
    stop = null;

    await waitFor(() => files.length === 1);
  });

  it("does not read the library while a file isn't allowed yet", async () => {
    localStorage.setItem(TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY, JSON.stringify({
      lastBackedUpAt: Date.now(), checksum: "earlier", filename: "tagify-auto-backup-earlier.json",
    }));
    const read = vi.spyOn(indexedDBStorage, "loadAllStrict");
    stop = startTrailingFileBackups({ idleMs: 20 });

    dispatchTagDataUpdatedEvent("save");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(read).not.toHaveBeenCalled();
    expect(files).toEqual([]);
  });
});
