import { beforeEach, describe, expect, it, vi } from "vitest";
const storageMocks = vi.hoisted(() => ({
  getAllSmartPlaylists: vi.fn(),
  saveSmartPlaylists: vi.fn(),
}));
vi.mock("@/services/storage/IndexedDBStorageService", () => ({
  indexedDBStorage: storageMocks,
}));
import {
  clearExplicitSmartPlaylistClear,
  loadSmartPlaylistsFromStorage,
  markSmartPlaylistsExplicitlyCleared,
  saveSmartPlaylistsToStorage,
  updateSmartPlaylistsInStorage,
  wereSmartPlaylistsExplicitlyCleared,
  SMART_PLAYLIST_STORAGE_KEY,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";

function createPlaylist(overrides: Partial<SmartPlaylistCriteria> = {}): SmartPlaylistCriteria {
  return {
    playlistId: "playlist-1",
    playlistName: "Playlist One",
    isActive: true,
    createdAt: 1,
    lastSyncAt: 1,
    smartPlaylistTrackUris: [],
    criteria: {
      includeTagClauses: [],
      clauseConnectors: [],
      ratingFilters: [],
      energyMinFilter: null,
      energyMaxFilter: null,
      bpmMinFilter: null,
      bpmMaxFilter: null,
    },
    ...overrides,
  };
}

describe("smartPlaylist.storage", () => {
  it("does not migrate old rules after an account changes during the read", async () => {
    localStorage.setItem(SMART_PLAYLIST_STORAGE_KEY, JSON.stringify([createPlaylist()]));
    let current = true;
    storageMocks.getAllSmartPlaylists.mockImplementationOnce(async () => { current = false; return []; });
    const check = () => { if (!current) throw new Error("account changed"); };
    await expect(loadSmartPlaylistsFromStorage(check)).rejects.toThrow("account changed");
    expect(storageMocks.saveSmartPlaylists).not.toHaveBeenCalled();
    expect(localStorage.getItem(SMART_PLAYLIST_STORAGE_KEY)).not.toBeNull();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    storageMocks.getAllSmartPlaylists.mockResolvedValue([]);
    storageMocks.saveSmartPlaylists.mockImplementation(async (next) => {
      if (typeof next === "function") next(await storageMocks.getAllSmartPlaylists());
      return true;
    });
  });

  it("remembers an intentional last-rule removal for the connected account", async () => {
    localStorage.setItem("tagify:sync:account-id", "account-a");
    markSmartPlaylistsExplicitlyCleared();
    expect(wereSmartPlaylistsExplicitlyCleared()).toBe(true);

    await saveSmartPlaylistsToStorage([]);
    expect(wereSmartPlaylistsExplicitlyCleared()).toBe(true);
    clearExplicitSmartPlaylistClear();
    expect(wereSmartPlaylistsExplicitlyCleared()).toBe(false);
  });

  it("carries an intentional removal through same-account reconnection", () => {
    localStorage.setItem("tagify:sync:disconnected-provenance", JSON.stringify({ accountId: "account-a" }));
    markSmartPlaylistsExplicitlyCleared();
    localStorage.setItem("tagify:sync:account-id", "account-a");
    expect(wereSmartPlaylistsExplicitlyCleared()).toBe(true);
  });

  it("saves playlists to unified IndexedDB storage", async () => {
    const data = [createPlaylist()];

    await saveSmartPlaylistsToStorage(data);

    expect(storageMocks.saveSmartPlaylists).toHaveBeenCalledWith(data, undefined, false);
    expect(localStorage.removeItem).toHaveBeenCalledWith(SMART_PLAYLIST_STORAGE_KEY);
  });

  it("migrates only valid legacy playlist entries", async () => {
    const valid = createPlaylist({ playlistId: "valid-1" });
    const invalid = { foo: "bar" };

    vi.mocked(localStorage.getItem).mockReturnValueOnce(
      JSON.stringify([valid, invalid]),
    );

    const loaded = await loadSmartPlaylistsFromStorage();

    expect(loaded).toEqual([
      {
        ...valid,
        id: "smart-playlist:valid-1:1",
        updatedAt: 1,
        criteria: {
          ...valid.criteria,
          camelotKeyFilters: [],
          camelotMinFilter: null,
          camelotMaxFilter: null,
        },
      },
    ]);
    expect(storageMocks.saveSmartPlaylists).toHaveBeenCalledWith(loaded, undefined);
    expect(localStorage.removeItem).toHaveBeenCalledWith(SMART_PLAYLIST_STORAGE_KEY);
  });

  it("returns empty array for malformed legacy JSON", async () => {
    vi.mocked(localStorage.getItem).mockReturnValueOnce("{not-json");

    const loaded = await loadSmartPlaylistsFromStorage();

    expect(loaded).toEqual([]);
  });

  it("uses IndexedDB without consulting the legacy key", async () => {
    const stored = [createPlaylist({ id: "stored" })];
    storageMocks.getAllSmartPlaylists.mockResolvedValue(stored);

    await expect(loadSmartPlaylistsFromStorage()).resolves.toEqual(stored);
    expect(localStorage.getItem).not.toHaveBeenCalled();
  });

  it("applies background membership updates after a pending rule save without losing that rule", async () => {
    const created = createPlaylist({ playlistId: "created" });
    const imported = createPlaylist({ playlistId: "imported" });
    let stored: SmartPlaylistCriteria[] = [];
    let finishFirstSave!: () => void;
    const firstSave = new Promise<void>((resolve) => { finishFirstSave = resolve; });
    storageMocks.getAllSmartPlaylists.mockImplementation(async () => stored);
    storageMocks.saveSmartPlaylists.mockImplementation(async (playlists) => {
      if (storageMocks.saveSmartPlaylists.mock.calls.length === 1) {
        await firstSave;
      }
      stored = typeof playlists === "function" ? playlists(stored) : playlists;
      return true;
    });

    const saving = saveSmartPlaylistsToStorage([created]);
    const updating = updateSmartPlaylistsInStorage((current) => [...current, imported]);
    await vi.waitFor(() => expect(storageMocks.saveSmartPlaylists).toHaveBeenCalledTimes(1));
    expect(storageMocks.getAllSmartPlaylists).not.toHaveBeenCalled();
    finishFirstSave();
    await Promise.all([saving, updating]);
    expect(stored.map((playlist) => playlist.playlistId)).toEqual(["created", "imported"]);
  });

  it("passes the updater into the transaction so unchanged playlists remain unchanged", async () => {
    const stored = [createPlaylist()];
    storageMocks.getAllSmartPlaylists.mockResolvedValue(stored);
    await expect(updateSmartPlaylistsInStorage((current) => current)).resolves.toBe(stored);
    expect(storageMocks.saveSmartPlaylists).toHaveBeenCalledWith(expect.any(Function), undefined);
  });
});
