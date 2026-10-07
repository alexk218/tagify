import React from "react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { SmartPlaylistSyncService } from "@/services/SmartPlaylistSyncService";
import SmartPlaylistTagChoices from "@/features/smart-playlists/components/SmartPlaylistTagChoices";
import { spotifyService } from "@/services/SpotifyService";
import { findDisplayTagName } from "@/utils/tagTaxonomy";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { buildLocalSnapshot, syncRuntime } from "@/services/sync/SyncRuntime";
import { applyDurableAppStateDocuments, sanitizeSmartPlaylists } from "@/services/sync/DurableAppState";
import { setLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { defaultTagData } from "@/constants/defaultTagData";
import { markConfirmedMembershipBaselines, hasConfirmedMembershipBaseline } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { applySmartPlaylistCriteriaToTrack } from "@/features/smart-playlists/utils/smartPlaylist.syncUtils";
import { evaluateTrackMatchesCriteria } from "@/features/smart-playlists/utils/smartPlaylist.criteria";
import { createSmartPlaylistRecipeBundle } from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import { prepareSmartPlaylistImport } from "@/features/smart-playlists/utils/smartPlaylist.import";
import SmartPlaylistModal, { SMART_PLAYLIST_MOBILE_TAGGING_INTRO_KEY } from "@/features/smart-playlists/components/SmartPlaylistModal";
import type { TrackData } from "@/types/tagData";
import { SYNC_STORES, getTagifyDatabaseName, TAGIFY_DATABASE_VERSION } from "@/services/sync/SyncLocalState";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";

const localUri = "spotify:local:Artist:Album:Track:180";
const spotifyUri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const configuration = {
  accountId: "123e4567-e89b-42d3-a456-426614174001", libraryId: "123e4567-e89b-42d3-a456-426614174002",
  deviceId: "123e4567-e89b-42d3-a456-426614174003", apiBaseUrl: "https://example.invalid",
};
const criteria = { includeTagClauses: [], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null };
const rated = { rating: 5, energy: 0, bpm: null, tagIds: [], dateModified: 10 };
function playlist(overrides: Partial<SmartPlaylistCriteria> = {}): SmartPlaylistCriteria {
  return { id: "five", playlistId: "spotify-playlist", playlistName: "Five stars", criteria, isActive: true, createdAt: 1, lastSyncAt: 1, smartPlaylistTrackUris: [], ...overrides };
}
const runtime = syncRuntime as any;

describe("smart playlist safety across storage, Community and Spotify", () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(spotifyService, "getTrack").mockResolvedValue({ name: "Night Drive", artists: "Test artist" } as never);
    vi.spyOn(spotifyApiService, "fetchAudioFeatures").mockResolvedValue({ bpm: null, camelotKey: null });
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await indexedDBStorage.init()).toBe(true);
    setLocalPersistencePaused(false);
    vi.spyOn(storageService, "isReady").mockReturnValue(true);
    vi.spyOn(storageService, "loadAll").mockImplementation(async () => (await indexedDBStorage.loadAll())!);
    vi.spyOn(storageService, "getTracks").mockImplementation((uris) => indexedDBStorage.getTracks(uris));
    vi.spyOn(storageService, "saveTracks").mockImplementation((tracks) => indexedDBStorage.saveTracks(tracks));
    localStorage.setItem(SMART_PLAYLIST_MOBILE_TAGGING_INTRO_KEY, "seen");
  });
  afterEach(() => {
    indexedDBStorage.resetConnection();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  async function seed(p: SmartPlaylistCriteria, tracks: Record<string, TrackData> = { [spotifyUri]: rated }) {
    expect(await indexedDBStorage.saveAll({ ...defaultTagData, tracks, smartPlaylists: [p] })).toBe(true);
    markConfirmedMembershipBaselines([p], new Set([p.playlistId]));
  }
  function spotifyMembership(initial: string[]) {
    let members = [...initial];
    vi.spyOn(spotifyApiService, "getAllTrackUrisInPlaylistStrict").mockImplementation(async () => [...members]);
    vi.spyOn(spotifyApiService, "removeTrackFromPlaylist").mockImplementation(async (uri) => {
      members = members.filter((member) => member !== uri);
      return true;
    });
    return () => members;
  }

  it("Community snapshot replacement preserves local file ratings, timestamps and membership", async () => {
    const p = playlist({ smartPlaylistTrackUris: [localUri, spotifyUri] });
    const source = { ...defaultTagData, tracks: { [localUri]: rated, [spotifyUri]: rated }, smartPlaylists: [p] };
    await seed(p, source.tracks);
    const core = await buildLocalSnapshot(configuration.libraryId, source);
    expect(core.annotations).toHaveLength(1);
    const snapshot = { ...core, protocolVersion: 2, headCursor: 1, appState: [{ domain: "smart-playlists", value: sanitizeSmartPlaylists([p]), revision: 1, updatedAt: new Date().toISOString() }] };
    vi.spyOn(runtime, "request").mockImplementation(async (_config, path) => String(path).includes("/pull?") ? { snapshotRequired: true } : {});
    vi.spyOn(runtime, "downloadSnapshot").mockResolvedValue(snapshot);
    await runtime.pull(configuration);
    expect((await indexedDBStorage.loadAll())!.tracks[localUri]).toEqual(rated);
    const members = spotifyMembership([localUri, spotifyUri]);
    const service = new SmartPlaylistSyncService();
    await service.reconcileAll();
    await service.reconcileAll();
    expect(members()).toEqual([localUri, spotifyUri]);
  });

  it("a Community rule update preserves an unsent local filter edit", async () => {
    const p = playlist({ criteria: { ...criteria, ratingFilters: [4] } });
    await seed(p);
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open(getTagifyDatabaseName(), TAGIFY_DATABASE_VERSION); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve) => { const tx = db.transaction(SYNC_STORES.APP_STATE, "readwrite"); tx.objectStore(SYNC_STORES.APP_STATE).put({ domain: "smart-playlists", value: sanitizeSmartPlaylists([playlist()]), revision: 1, updatedAt: new Date().toISOString() }); tx.oncomplete = () => resolve(); });
    db.close();
    const remote = { ...p, criteria: { ...criteria, ratingFilters: [5] } };
    vi.spyOn(runtime, "request").mockImplementation(async (_config, path) => String(path).includes("/pull?") ? {
      headCursor: 1, conflicts: [], batches: [{ cursor: 1, batchId: "remote", operations: [{ type: "app-state.replace", domain: "smart-playlists", value: sanitizeSmartPlaylists([remote]) }] }],
    } : {});
    await runtime.pull(configuration);
    expect((await indexedDBStorage.getAllSmartPlaylists())[0].criteria.ratingFilters).toEqual([4]);
  });

  it("a Community rename preserves the baseline and rates a pending mobile addition", async () => {
    const p = playlist({ smartPlaylistTrackUris: [spotifyUri] });
    await seed(p);
    const newUri = "spotify:track:0000000000000000000001";
    const members = spotifyMembership([spotifyUri, newUri]);
    await applyDurableAppStateDocuments([{ domain: "smart-playlists", value: sanitizeSmartPlaylists([{ ...p, playlistName: "Renamed" }]), revision: 2, updatedAt: new Date().toISOString() }]);
    expect(hasConfirmedMembershipBaseline(p)).toBe(true);
    const service = new SmartPlaylistSyncService();
    await service.reconcileAll();
    await service.reconcileAll();
    expect((await indexedDBStorage.loadAll())!.tracks[newUri].rating).toBe(5);
    expect(members()).toEqual([spotifyUri, newUri]);
  });

  it("deduplication removes only extra occurrences of a local file", async () => {
    const p = playlist({ smartPlaylistTrackUris: [localUri] });
    await seed(p, { [localUri]: rated });
    spotifyMembership([localUri, localUri]);
    const api = Spicetify.Platform.PlaylistAPI as any;
    api.getContents = vi.fn().mockResolvedValue({ items: [{ uri: localUri, uid: "first" }, { uri: localUri, uid: "duplicate" }] });
    api.remove = vi.fn().mockResolvedValue(undefined);
    vi.mocked(spotifyApiService.getAllTrackUrisInPlaylistStrict).mockResolvedValueOnce([localUri, localUri]).mockResolvedValue([localUri]);
    const summary = await new SmartPlaylistSyncService().reconcileAll();
    expect(api.remove).toHaveBeenCalledWith("spotify:playlist:spotify-playlist", [{ uri: localUri, uid: "duplicate" }]);
    expect(summary.duplicatesRemovedCount).toBe(1);
    expect(summary.failedPlaylistNames).toEqual([]);
  });

  it("applying OR criteria preserves the tags of an already matching track", () => {
    const formula = { ...criteria, includeTagClauses: [
      { tagIds: ["house", "techno"], excludedTagIds: [], operator: "OR" as const },
    ], clauseConnectors: [] };
    const original = { ...rated, tagIds: ["house"] };
    expect(evaluateTrackMatchesCriteria(original, formula)).toBe(true);
    const updated = applySmartPlaylistCriteriaToTrack(original, formula, 100);
    expect(updated.tagIds).toEqual(["house"]);
    expect(evaluateTrackMatchesCriteria(updated, formula)).toBe(true);
  });

  it("a transient local read failure stops sync before changing Spotify", async () => {
    const p = playlist({ smartPlaylistTrackUris: [spotifyUri] });
    await seed(p);
    vi.mocked(storageService.loadAll).mockRestore();
    vi.spyOn(indexedDBStorage, "loadAllStrict").mockRejectedValueOnce(new Error("Read failed"));
    const members = spotifyMembership([spotifyUri]);
    await expect(new SmartPlaylistSyncService().reconcileAll()).rejects.toThrow("Read failed");
    expect(members()).toEqual([spotifyUri]);
    expect(spotifyApiService.removeTrackFromPlaylist).not.toHaveBeenCalled();
    expect((await indexedDBStorage.loadAll())!.tracks[spotifyUri].rating).toBe(5);
  });

  function renderModal(p: SmartPlaylistCriteria) {
    vi.spyOn(spotifyApiService, "getPlaylistTrackCounts").mockResolvedValue({ [p.playlistId]: p.smartPlaylistTrackUris.length });
    vi.spyOn(spotifyApiService, "getAllUserPlaylistReferencesStrict").mockResolvedValue([]);
    return render(<SmartPlaylistModal smartPlaylists={[p]} taxonomy={defaultTagData.taxonomy}
      onEditPlaylist={vi.fn()} onUpdateSmartPlaylists={vi.fn()} onSyncPlaylist={vi.fn()}
      onExportSmartPlaylists={vi.fn()} onImportSmartPlaylists={vi.fn()} onBindRecipe={vi.fn()} onClose={vi.fn()} />);
  }
  it("an unresolved backup import offers a connection control", async () => {
    const result = prepareSmartPlaylistImport([playlist()], []);
    expect(result.unresolvedCount).toBe(1);
    renderModal(result.playlists[0]);
    expect(screen.queryByRole("button", { name: "Enable Sync" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create Spotify Playlist" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Existing" })).toBeNull();
  });
  it("an imported unconnected setup can be removed", async () => {
    renderModal(playlist({ playlistId: "", isActive: false }));
    expect(screen.getByRole("button", { name: "Create Spotify Playlist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Setup" })).toBeInTheDocument();
  });
  it("a never-synced playlist is not reported as In Sync", async () => {
    renderModal(playlist({ lastSyncAt: 0, smartPlaylistTrackUris: [spotifyUri] }));
    await waitFor(() => expect(screen.queryByText("In Sync")).toBeNull());
  });
  it("sharing a generated playlist ID strips its Spotify binding", async () => {
    const p = playlist({ id: undefined, playlistId: "2rHTLOgs7Ygr6rp76HW5n9" });
    expect(await indexedDBStorage.saveSmartPlaylists([p])).toBe(true);
    const saved = await indexedDBStorage.getAllSmartPlaylists();
    const bundle = await createSmartPlaylistRecipeBundle(saved, defaultTagData.taxonomy);
    expect(JSON.stringify(bundle)).not.toContain("2rHTLOgs7Ygr6rp76HW5n9");
  });
  it("keeps an ambiguous addition through restart and saves only the user's chosen tags", async () => {
    const tagIds = Object.keys(defaultTagData.taxonomy.tagsById).slice(0, 2);
    const p = playlist({ criteria: { ...criteria, includeTagClauses: [{ tagIds, excludedTagIds: [], operator: "OR" }] } });
    await seed(p, { [spotifyUri]: { ...rated, name: "Night Drive" } });
    const members = spotifyMembership([spotifyUri]);
    await new SmartPlaylistSyncService().reconcileAll();
    expect((await indexedDBStorage.getAllSmartPlaylists())[0].pendingTagChoices).toEqual([spotifyUri]);
    expect((await indexedDBStorage.loadAllStrict()).tracks[spotifyUri].tagIds).toEqual([]);
    await new SmartPlaylistSyncService().reconcileAll();
    expect(members()).toEqual([spotifyUri]);
    const first = render(<SmartPlaylistTagChoices enabled />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    render(<SmartPlaylistTagChoices enabled />);
    const label = `Add ${findDisplayTagName(defaultTagData.taxonomy, tagIds[1], { disambiguate: true })}`;
    fireEvent.click(await screen.findByRole("radio", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await indexedDBStorage.loadAllStrict()).tracks[spotifyUri].tagIds).toEqual([tagIds[1]]);
    expect((await indexedDBStorage.getAllSmartPlaylists())[0].pendingTagChoices).toEqual([]);
    expect(members()).toEqual([spotifyUri]);
  });

  it("keeps the pending choice after a failed save and permits retry", async () => {
    const tagIds = Object.keys(defaultTagData.taxonomy.tagsById).slice(0, 2);
    const p = playlist({ pendingTagChoices: [spotifyUri], smartPlaylistTrackUris: [spotifyUri], criteria: { ...criteria, includeTagClauses: [{ tagIds, excludedTagIds: [], operator: "OR" }] } });
    await seed(p);
    const members = spotifyMembership([spotifyUri]);
    vi.mocked(storageService.saveTracks).mockResolvedValueOnce(false);
    const service = new SmartPlaylistSyncService();
    await expect(service.resolveTagChoice(p.playlistId, spotifyUri, { add: [tagIds[0]], remove: [] })).rejects.toThrow("could not be saved");
    expect((await indexedDBStorage.getAllSmartPlaylists())[0].pendingTagChoices).toEqual([spotifyUri]);
    await service.resolveTagChoice(p.playlistId, spotifyUri, { add: [tagIds[0]], remove: [] });
    expect((await indexedDBStorage.loadAllStrict()).tracks[spotifyUri].tagIds).toEqual([tagIds[0]]);
    expect(members()).toEqual([spotifyUri]);
  });

  it("honors a manual rating override while a tag choice is pending", async () => {
    const p = playlist({ pendingTagChoices: [spotifyUri], smartPlaylistTrackUris: [spotifyUri] });
    await seed(p);
    const members = spotifyMembership([spotifyUri]);
    await new SmartPlaylistSyncService().syncTrack(spotifyUri, { ...rated, rating: 4 });
    expect(members()).toEqual([]);
    expect((await indexedDBStorage.getAllSmartPlaylists())[0].pendingTagChoices).toEqual([]);
  });

});
