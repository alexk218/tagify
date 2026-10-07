import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import SmartPlaylistModal from "../../../src/features/smart-playlists/components/SmartPlaylistModal";
import { indexedDBStorage } from "../../../src/services/storage/IndexedDBStorageService";
import { storageService } from "../../../src/services/storage/StorageService";
import { spotifyApiService } from "../../../src/services/SpotifyApiService";
import { SmartPlaylistSyncService } from "../../../src/services/SmartPlaylistSyncService";
import { defaultTagData } from "../../../src/constants/defaultTagData";
import { markConfirmedMembershipBaselines } from "../../../src/features/smart-playlists/utils/smartPlaylist.storage";
import { createSmartPlaylistRecipeBundle, downloadSmartPlaylistRecipeBundle, getRecipeSelections, type SmartPlaylistRecipeSelection } from "../../../src/features/smart-playlists/utils/smartPlaylist.recipes";
import { createSharedSmartPlaylist } from "../../../src/features/smart-playlists/utils/smartPlaylist.createShared";
import { buildTaxonomyFromCategoryTree } from "../../../src/utils/tagTaxonomy";
import type { SmartPlaylistCriteria, SmartPlaylistRecipeBundle } from "../../../src/features/smart-playlists/model/smartPlaylist.types";

const uri = "spotify:track:0000000000000000000001";
const taxonomy = buildTaxonomyFromCategoryTree([{ id: "genres", name: "My music", subcategories: [{ id: "dance", name: "Dance", tags: [{ id: "house", name: "House" }, { id: "techno", name: "Techno" }] }] }]);
const tagIds = Object.keys(taxonomy.tagsById);
const saved: SmartPlaylistCriteria = { id: "saved-house", playlistId: "existing-spotify", playlistName: "My favourites", isActive: true, createdAt: 1, lastSyncAt: 1, smartPlaylistTrackUris: [uri], source: { recipeId: "shared-house", revision: 1 },
  criteria: { includeTagClauses: [{ tagIds: [tagIds[0]], excludedTagIds: [], operator: "AND" }], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null },
};
const bundle: SmartPlaylistRecipeBundle = { format: "tagify-smart-playlist-recipes", version: 1, exportedAt: new Date().toISOString(), recipes: [{ id: "shared-house", name: "Shared House", source: { recipeId: "shared-house", revision: 2 }, tagReferences: [{ key: "house", name: "House", categoryName: "Genre", folderPath: ["Electronic"] }], criteria: { ...saved.criteria, includeTagClauses: [{ tagIds: ["house"], excludedTagIds: [], operator: "AND" }], ratingFilters: [4] } }] };
const library = { ...defaultTagData, taxonomy, smartPlaylists: [saved], tracks: { [uri]: { rating: 5, energy: 5, bpm: 120, tagIds: [tagIds[0]], name: "Night Drive", artists: "Maya Fields", dateModified: 10 }, "spotify:local:Artist:Album:Song:100": { rating: 5, energy: 5, bpm: 120, tagIds: [tagIds[0]], name: "Local mix", dateModified: 11 } } };
bundle.recipes.push({ ...bundle.recipes[0], id: "fresh-night", name: "Night favourites", source: { recipeId: "fresh-night", revision: 1 }, criteria: { ...bundle.recipes[0].criteria, ratingFilters: [5] } });
const remoteKey = "tagify-sharing-example:spotify";
const remote = JSON.parse(localStorage.getItem(remoteKey) ?? "null");
let members: Record<string, string[]> = remote?.members ?? { "existing-spotify": [uri] };
let creations: number = remote?.creations ?? 0;
spotifyApiService.createPrivatePlaylist = async () => { const id = `newSpotify${++creations}`; members[id] = []; return id; };
spotifyApiService.getAllTrackUrisInPlaylistStrict = async (id) => [...(members[id] ?? [])];
spotifyApiService.getPlaylistTrackCounts = async () => Object.fromEntries(Object.entries(members).map(([id, songs]) => [id, songs.length]));
spotifyApiService.getAllUserPlaylistReferencesStrict = async () => [];
spotifyApiService.removeTrackFromPlaylist = async (removed, id) => { members[id] = (members[id] ?? []).filter((item) => item !== removed); return true; };
spotifyApiService.addTrackToSpotifyPlaylist = async (added, id) => { if (added.startsWith("spotify:local:")) return { success: true, wasAdded: false }; if (!(members[id] ?? []).includes(added)) (members[id] ??= []).push(added); return { success: true, wasAdded: true }; };
storageService.isReady = () => true;
const service = new SmartPlaylistSyncService();

Spicetify.Platform.PlaylistAPI.getMetadata = async () => null;

function App() {
  const [data, setData] = useState(library);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const refresh = async () => { const next = await indexedDBStorage.loadAllStrict(); localStorage.setItem(remoteKey, JSON.stringify({ creations, members })); setData(next as typeof data); setStatus(JSON.stringify({ creations, members, playlists: next.smartPlaylists, tracks: next.tracks }, null, 2)); };
  const importFile = async (value: unknown, choices?: SmartPlaylistRecipeSelection[]) => {
    const current = await indexedDBStorage.loadAllStrict();
    const installed = await indexedDBStorage.installSharedSmartPlaylistSetups(value as SmartPlaylistRecipeBundle, choices ?? getRecipeSelections(value as SmartPlaylistRecipeBundle, current.taxonomy, current.smartPlaylists ?? []));
    await refresh();
    return { importedCount: installed.importedCount, skippedCount: installed.skippedCount, createdTagCount: installed.createdTagCount, relinkedCount: 0, unresolvedCount: 0, verificationUnavailable: false, recipeImport: true };
  };
  const reset = async () => { await indexedDBStorage.init(); await indexedDBStorage.saveAll(library); markConfirmedMembershipBaselines([saved], new Set([saved.playlistId])); members = { "existing-spotify": [uri] }; creations = 0; await refresh(); setOpen(true); };
  return <><h1>Sharing safety example</h1><p>Isolated library and Spotify membership.</p><button onClick={() => void reset()}>Open example</button><button onClick={() => void refresh().then(() => setOpen(true))}>Reopen saved library</button><button onClick={() => void service.reconcileAll().then(refresh)}>Run Spotify sync</button><button onClick={() => downloadSmartPlaylistRecipeBundle(bundle)}>Download example share</button><pre>{status}</pre>
    {open ? <SmartPlaylistModal smartPlaylists={data.smartPlaylists ?? []} taxonomy={data.taxonomy} tracks={data.tracks} onEditPlaylist={() => {}} onUpdateSmartPlaylists={async (update) => { const current = await indexedDBStorage.getAllSmartPlaylists(); await indexedDBStorage.saveSmartPlaylists(typeof update === "function" ? update(current) : update); await refresh(); }} onSyncPlaylist={async () => {}} onExportSmartPlaylists={async (selected) => { downloadSmartPlaylistRecipeBundle(await createSmartPlaylistRecipeBundle(selected ?? data.smartPlaylists ?? [], data.taxonomy)); }} onImportSmartPlaylists={importFile} onBindRecipe={async (setup) => { await createSharedSmartPlaylist(setup.id!); await refresh(); }} onClose={() => setOpen(false)} /> : null}</>;
}
createRoot(document.getElementById("app")!).render(<App />);
