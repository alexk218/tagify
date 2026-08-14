import { describe, expect, it, vi } from "vitest";
import {
  loadSmartPlaylistsFromStorage,
  saveSmartPlaylistsToStorage,
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
  it("saves playlists to localStorage", () => {
    const data = [createPlaylist()];

    saveSmartPlaylistsToStorage(data);

    expect(localStorage.setItem).toHaveBeenCalledWith(
      SMART_PLAYLIST_STORAGE_KEY,
      JSON.stringify(data),
    );
  });

  it("loads only valid playlist entries", () => {
    const valid = createPlaylist({ playlistId: "valid-1" });
    const invalid = { foo: "bar" };

    vi.mocked(localStorage.getItem).mockReturnValueOnce(
      JSON.stringify([valid, invalid]),
    );

    const loaded = loadSmartPlaylistsFromStorage();

    expect(loaded).toEqual([
      {
        ...valid,
        criteria: {
          ...valid.criteria,
          camelotKeyFilters: [],
          camelotMinFilter: null,
          camelotMaxFilter: null,
        },
      },
    ]);
  });

  it("returns empty array for malformed JSON", () => {
    vi.mocked(localStorage.getItem).mockReturnValueOnce("{not-json");

    const loaded = loadSmartPlaylistsFromStorage();

    expect(loaded).toEqual([]);
  });
});
