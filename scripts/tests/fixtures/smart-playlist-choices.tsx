import React from "react";
import { createRoot } from "react-dom/client";
import SmartPlaylistTagChoices from "../../../src/features/smart-playlists/components/SmartPlaylistTagChoices";
import { indexedDBStorage } from "../../../src/services/storage/IndexedDBStorageService";
import { storageService } from "../../../src/services/storage/StorageService";
import { spotifyApiService } from "../../../src/services/SpotifyApiService";
import { SmartPlaylistSyncService } from "../../../src/services/SmartPlaylistSyncService";
import { defaultTagData } from "../../../src/constants/defaultTagData";
import { markConfirmedMembershipBaselines } from "../../../src/features/smart-playlists/utils/smartPlaylist.storage";
import { buildTaxonomyFromCategoryTree } from "../../../src/utils/tagTaxonomy";
import type { SmartPlaylistCriteria } from "../../../src/features/smart-playlists/model/smartPlaylist.types";

const uri = "spotify:track:0000000000000000000001";
const taxonomy = buildTaxonomyFromCategoryTree([{ id: "genres", name: "Genre", subcategories: [{ id: "dance", name: "Dance", tags: [{ id: "house", name: "House" }, { id: "techno", name: "Techno" }] }] }]);
const tagIds = Object.keys(taxonomy.tagsById);
const playlist: SmartPlaylistCriteria = {
  id: "choice-fixture", playlistId: "isolated-spotify", playlistName: "Late night favourites", isActive: true, createdAt: 1, lastSyncAt: 1, smartPlaylistTrackUris: [],
  criteria: { includeTagClauses: [{ tagIds, excludedTagIds: [], operator: "OR" }], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null },
};
let members = [uri];
spotifyApiService.getAllTrackUrisInPlaylistStrict = async () => [...members];
spotifyApiService.removeTrackFromPlaylist = async (removed) => { members = members.filter((item) => item !== removed); return true; };
spotifyApiService.addTrackToSpotifyPlaylist = async (added) => { if (!members.includes(added)) members.push(added); return { success: true, wasAdded: true }; };
storageService.isReady = () => true;
const service = new SmartPlaylistSyncService();
let root: ReturnType<typeof createRoot>;
function open() { root?.unmount(); root = createRoot(document.getElementById("app")!); root.render(<SmartPlaylistTagChoices enabled />); }
async function status() {
  const data = await indexedDBStorage.loadAllStrict();
  document.getElementById("status")!.textContent = JSON.stringify({ rating: data.tracks[uri]?.rating, tags: data.tracks[uri]?.tagIds.map((id) => taxonomy.tagsById[id]?.name), pending: data.smartPlaylists?.[0].pendingTagChoices?.length ?? 0, spotifyMembers: members.length }, null, 2);
}
async function reset() {
  await indexedDBStorage.init();
  await indexedDBStorage.saveAll({ ...defaultTagData, taxonomy, smartPlaylists: [playlist], tracks: { [uri]: { rating: 5, energy: 0, bpm: null, tagIds: [], name: "Night Drive", artists: "Maya Fields", dateModified: 10 } } });
  markConfirmedMembershipBaselines([playlist], new Set([playlist.playlistId]));
  members = [uri];
  await service.reconcileAll();
  open(); await status();
}
document.getElementById("reset")!.addEventListener("click", () => void reset());
document.getElementById("reopen")!.addEventListener("click", open);
window.addEventListener("tagify:smartPlaylistsUpdated", () => void status());
void reset();
