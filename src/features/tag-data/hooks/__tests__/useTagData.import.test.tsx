import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { SmartPlaylistCriteria } from "../useTagData";
import type { TagDataStructure } from "@/types/tagData";
import { useTagData } from "../useTagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { hasConfirmedMembershipBaseline } from "@/features/smart-playlists";
import { RECOVERY_UNAVAILABLE_SKIP_MS, RECOVERY_UNAVAILABLE_UNTIL_KEY } from "@/services/sync/SyncInstallRecovery";

const smartPlaylist: SmartPlaylistCriteria = {
  id: "five-stars", playlistId: "2rHTLOgs7Ygr6rp76Hw5n9", playlistName: "5★",
  criteria: {
    includeTagClauses: [], clauseConnectors: [], ratingFilters: [5],
    energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null,
  },
  isActive: true, createdAt: 1, lastSyncAt: 0, smartPlaylistTrackUris: [],
};

const currentLibrary: TagDataStructure = {
  ...JSON.parse(JSON.stringify(defaultTagData)),
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  tracks: { "spotify:track:4uLU6hMCjMI75M1A2tKUQC": { rating: 5, energy: 0, bpm: null, tagIds: [], dateModified: 1_000 } },
  smartPlaylists: [smartPlaylist],
};

describe("importing a Tagify backup file", () => {
  let downloads: string[];

  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.clear();
    // Community already found nothing to reconnect on this computer, so opening the library
    // doesn't wait 3 s for a Spotify sign-in this test page never provides.
    localStorage.setItem(RECOVERY_UNAVAILABLE_UNTIL_KEY, String(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS));
    localStorage.setItem("tagify:filterState:tracks", JSON.stringify({ current: true }));
    expect(await indexedDBStorage.init()).toBe(true);
    expect(await indexedDBStorage.saveAll(currentLibrary)).toBe(true);
    localStorage.setItem("tagify:migrationCompleted", "true");
    downloads = [];
    vi.spyOn(spotifyApiService, "getAllUserPlaylistReferencesStrict").mockResolvedValue([
      { playlistId: smartPlaylist.playlistId, playlistName: smartPlaylist.playlistName },
    ]);
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockResolvedValue(["spotify:track:4uLU6hMCjMI75M1A2tKUQC"]);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });

  afterEach(() => {
    cleanup();
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps current Smart Playlists and saves a copy first when the file predates them", { timeout: 20_000 }, async () => {
    const { result } = renderHook(() => useTagData());
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });

    const olderBackup = {
      ...JSON.parse(JSON.stringify(defaultTagData)),
      tracks: { "spotify:track:0VjIjW4GlUZAMYd2vXMi3b": { rating: 3, energy: 0, bpm: null, tagIds: [], dateModified: 500 } },
    };
    delete olderBackup.smartPlaylists;

    await act(async () => { await result.current.importTagData(olderBackup); });

    expect(downloads.some((name) => name.startsWith("tagify-before-import-"))).toBe(true);
    expect(await indexedDBStorage.getAllSmartPlaylists()).toEqual([expect.objectContaining({ id: "five-stars" })]);
    expect((await indexedDBStorage.loadAllStrict()).tracks).toEqual({
      "spotify:track:0VjIjW4GlUZAMYd2vXMi3b": expect.objectContaining({ rating: 3, dateModified: 500 }),
    });
  });

  it("restores saved settings carried by a backup file", { timeout: 20_000 }, async () => {
    const { result } = renderHook(() => useTagData());
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });

    await act(async () => {
      await result.current.importTagData({
        format: "tagify-backup", envelopeVersion: 2, exportedAt: "2026-10-05T00:00:00.000Z", tagifyVersion: "3.0.0",
        tagData: currentLibrary,
        community: { publicationPolicy: null, ownerIdentityMapping: null, installations: [] },
        appState: { "filter-formulas": { tracks: { restored: true } } },
      });
    });

    expect(JSON.parse(localStorage.getItem("tagify:filterState:tracks") || "null")).toEqual({ restored: true });
  });

  it("automatically confirms active and inactive playlists without changing songs or their annotations", { timeout: 20_000 }, async () => {
    const add = vi.spyOn(spotifyApiService, "addTrackToSpotifyPlaylist");
    const remove = vi.spyOn(spotifyApiService, "removeTrackFromPlaylist");
    const { result } = renderHook(() => useTagData());
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });
    const inactive = { ...smartPlaylist, id: "off", playlistId: "other", playlistName: "Off", isActive: false };
    vi.mocked(spotifyApiService.getAllUserPlaylistReferencesStrict).mockResolvedValue([
      { playlistId: smartPlaylist.playlistId, playlistName: smartPlaylist.playlistName },
      { playlistId: "other", playlistName: "Off" },
    ]);
    await act(async () => { await result.current.importTagData({ ...currentLibrary, smartPlaylists: [smartPlaylist, inactive] }); });
    const saved = await indexedDBStorage.loadAllStrict();
    expect(saved.smartPlaylists).toHaveLength(2);
    expect(saved.smartPlaylists?.[0]).toMatchObject({ playlistId: smartPlaylist.playlistId, isActive: true, smartPlaylistTrackUris: ["spotify:track:4uLU6hMCjMI75M1A2tKUQC"] });
    expect(saved.smartPlaylists?.[1]).toMatchObject({ playlistId: "other", isActive: false });
    for (const playlist of saved.smartPlaylists ?? []) {
      expect(playlist.lastSyncAt).toBeGreaterThan(0);
      expect(hasConfirmedMembershipBaseline(playlist)).toBe(true);
    }
    expect(saved.tracks).toEqual(currentLibrary.tracks);
    expect(result.current.tagData.smartPlaylists).toEqual(saved.smartPlaylists);
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(["playlist list", "playlist contents"])("keeps connections, sync settings and saved membership when Spotify cannot read the %s", { timeout: 20_000 }, async (failedRead) => {
    if (failedRead === "playlist list") {
      vi.mocked(spotifyApiService.getAllUserPlaylistReferencesStrict).mockRejectedValue(new Error("Offline"));
    }
    vi.mocked(spotifyApiService.getAllTrackUrisInPlaylistStrict).mockRejectedValue(new Error("Offline"));
    const { result } = renderHook(() => useTagData());
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });
    const savedPlaylist = { ...smartPlaylist, lastSyncAt: 123, smartPlaylistTrackUris: ["spotify:track:saved"] };
    await act(async () => { await result.current.importTagData({ ...currentLibrary, smartPlaylists: [savedPlaylist] }); });
    expect(await indexedDBStorage.getAllSmartPlaylists()).toMatchObject([savedPlaylist]);
    expect(hasConfirmedMembershipBaseline(savedPlaylist)).toBe(false);
    expect(Spicetify.showNotification).toHaveBeenCalledWith(expect.stringContaining("checked again automatically"), true);
  });
});
