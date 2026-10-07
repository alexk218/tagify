import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "../IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { CREATE_SHARED_TAG, createSmartPlaylistRecipeBundle, getRecipeSelections } from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import { markConfirmedMembershipBaselines, hasConfirmedMembershipBaseline } from "@/features/smart-playlists/utils/smartPlaylist.storage";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";

const tagId = Object.keys(defaultTagData.taxonomy.tagsById)[0];
const track = { rating: 5, energy: 2, bpm: 120, tagIds: [tagId], dateModified: 123, dateCreated: 12 };
const saved: SmartPlaylistCriteria = { id: "saved", playlistId: "spotify-existing", playlistName: "My favourites", isActive: true, createdAt: 1, lastSyncAt: 2, smartPlaylistTrackUris: ["spotify:track:saved"], pendingTagChoices: ["spotify:track:pending"],
  criteria: { includeTagClauses: [{ tagIds: [tagId], excludedTagIds: [], operator: "AND" }], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null },
};

describe("atomic sharing imports", () => {
  beforeEach(async () => { vi.stubGlobal("indexedDB", new IDBFactory()); indexedDBStorage.resetConnection(); await indexedDBStorage.init(); await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { "spotify:track:saved": track, "spotify:local:Artist:Album:Song:100": track }, smartPlaylists: [saved] }); markConfirmedMembershipBaselines([saved], new Set([saved.playlistId])); });
  afterEach(() => { indexedDBStorage.resetConnection(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function shared() {
    const bundle = await createSmartPlaylistRecipeBundle([{ ...saved, id: "someone-elses", playlistName: "Shared mix" }], defaultTagData.taxonomy);
    bundle.recipes[0].tagReferences[0].categoryName = "Shared genres";
    const choices = getRecipeSelections(bundle, defaultTagData.taxonomy, [saved]);
    choices[0].tagMappings[bundle.recipes[0].tagReferences[0].key] = CREATE_SHARED_TAG;
    return { bundle, choices };
  }
  it("appends a disabled setup and its tags without touching existing Spotify state or song dates", async () => {
    const before = await indexedDBStorage.loadAllStrict(); const { bundle, choices } = await shared();
    const imported = await indexedDBStorage.installSharedSmartPlaylistSetups(bundle, choices);
    const after = await indexedDBStorage.loadAllStrict();
    expect(imported.importedCount).toBe(1); expect(imported.createdTagCount).toBe(1);
    expect(after.tracks).toEqual(before.tracks);
    expect(after.playlists).toEqual(before.playlists); expect(after.artists).toEqual(before.artists);
    expect(after.smartPlaylists?.find((p) => p.id === saved.id)).toEqual(before.smartPlaylists![0]);
    expect(hasConfirmedMembershipBaseline(saved)).toBe(true);
    expect(after.smartPlaylists?.find((p) => p.id !== saved.id)).toMatchObject({ playlistId: "", isActive: false });
  });
  it("rolls back tags and the new setup together when writing fails", async () => {
    const before = await indexedDBStorage.loadAllStrict(); const { bundle, choices } = await shared();
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => { throw new Error("disk full"); });
    await expect(indexedDBStorage.installSharedSmartPlaylistSetups(bundle, choices)).rejects.toThrow("disk full");
    expect(await indexedDBStorage.loadAllStrict()).toEqual(before);
  });
  it("rejects a tag deleted since preview without committing any changes", async () => {
    const { bundle, choices } = await shared(); choices[0].tagMappings[bundle.recipes[0].tagReferences[0].key] = "removed-tag";
    const before = await indexedDBStorage.loadAllStrict();
    await expect(indexedDBStorage.installSharedSmartPlaylistSetups(bundle, choices)).rejects.toThrow("Choose");
    expect(await indexedDBStorage.loadAllStrict()).toEqual(before);
  });
  it("serializes simultaneous imports and skips repeated files instead of replacing rules", async () => {
    const { bundle, choices } = await shared();
    const results = await Promise.all([indexedDBStorage.installSharedSmartPlaylistSetups(bundle, choices), indexedDBStorage.installSharedSmartPlaylistSetups(bundle, choices)]);
    expect(results.map((result) => result.importedCount).sort()).toEqual([0, 1]);
    const after = await indexedDBStorage.loadAllStrict(); expect(after.smartPlaylists).toHaveLength(2);
    expect(after.tracks["spotify:track:saved"].dateModified).toBe(123);
  });
  it("rejects a review started for another account without writing either library", async () => {
    const { bundle, choices } = await shared(); const before = await indexedDBStorage.loadAllStrict();
    await expect(indexedDBStorage.installSharedSmartPlaylistSetups(bundle, choices, "tagify-db:another-account")).rejects.toThrow("account changed");
    expect(await indexedDBStorage.loadAllStrict()).toEqual(before);
  });
});
