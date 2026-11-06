import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TrackList from "@/features/track-session/components/TrackList";
import { useFilterState } from "@/features/filter-state";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import type { TagDataStructure, TrackData } from "@/types/tagData";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
import "@/styles/globals.css";

// Length and release year filters on the production track list, with an
// isolated IndexedDB library and no Spotify. Run: node scripts/tests/track-notes.mjs 4386 song-details-filters
localStorage.setItem("tagify:sync:account-id", "isolated-song-details-20261103");
window.fetch = async () => new Response("{}", { status: 404 });
Object.assign(window, { Spicetify: { showNotification: (text: string) => console.log("notification:", text), Player: { data: null }, Platform: { History: { push: () => {} } } } });
const taxonomy = buildTaxonomyFromCategoryTree([{ id: "genre", name: "Genre", subcategories: [{ id: "styles", name: "Styles", tags: [{ id: "techno", name: "Techno" }, { id: "house", name: "House" }] }] }]);
const [techno, house] = Object.keys(taxonomy.tagsById);
const songs: Array<[string, string, number | undefined, string | undefined, string[]]> = [
  ["Night Drive", "Maya Fields", 185_000, "1998-03-02", [techno]],
  ["Glass Horizons", "Maya Fields", 242_000, "2008", [techno, house]],
  ["Quiet Signals", "Low Tide", 431_000, "2016-09", [house]],
  ["Long Form", "Low Tide", 728_000, "2022-05-20", [techno]],
  ["Still Looking Up", "Field Notes", undefined, undefined, [house]],
];
const uri = (index: number) => `spotify:track:${String.fromCharCode(97 + index).repeat(22)}`;

function Fixture() {
  const [data, setData] = useState<TagDataStructure | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [noDetails, setNoDetails] = useState(false);
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylistCriteria[]>([]);
  const filters = useFilterState("tracks");
  useEffect(() => { void (async () => {
    await indexedDBStorage.init();
    await indexedDBStorage.saveTaxonomy(taxonomy);
    for (const [index, [name, artists, durationMs, releaseDate, tagIds]] of songs.entries()) {
      const track: TrackData = { name, artists, rating: 4, energy: 5 + index, bpm: 118 + index * 4, tagIds, dateCreated: 1720000000000 + index, dateModified: 1720000000000 + index,
        ...(durationMs ? { durationMs } : {}), ...(releaseDate ? { releaseDate } : {}) };
      await indexedDBStorage.saveTrack(uri(index), track);
    }
    setData({ ...await indexedDBStorage.loadAllStrict(), taxonomy });
  })(); }, []);
  const tracks = data && noDetails
    ? Object.fromEntries(Object.entries(data.tracks).map(([key, { durationMs: _d, releaseDate: _r, ...track }]) => [key, track]))
    : data?.tracks;
  return <main style={{ maxWidth: narrow ? 350 : 1000, margin: "0 auto" }}>
    <div className="fixtureBar">Isolated production UI
      <button onClick={() => setNarrow(value => !value)}>{narrow ? "Desktop layout" : "Narrow layout"}</button>
      <button onClick={() => setNoDetails(value => !value)}>{noDetails ? "Restore song details" : "No lengths or dates yet"}</button>
      <span data-testid="saved-playlists">{JSON.stringify(smartPlaylists.map(playlist => playlist.criteria))}</span>
    </div>
    {tracks && <TrackList tracks={tracks} taxonomy={taxonomy} includeTagClauses={filters.includeTagClauses} clauseConnectors={filters.clauseConnectors} activeTagFilters={filters.activeTagFilters} excludedTagFilters={filters.excludedTagFilters} selectedClauseIndex={filters.selectedClauseIndex} activeTrackUri={null}
      onAddIncludeClause={filters.addIncludeClause} onRemoveIncludeClause={filters.removeIncludeClause} onSelectClause={filters.setSelectedClauseIndex} onSetIncludeClauseOperator={filters.setIncludeClauseOperator} onSetClauseConnector={filters.setClauseConnector} onRemoveTagFilter={filters.removeTagFilter} onToggleTagIncludeOff={filters.toggleTagIncludeOff} onMoveTagToClauseLane={filters.moveTagToClauseLane} onReplaceTagFilterFormula={filters.replaceTagFilterFormula} onPlayTrack={() => {}} onTagTrack={() => {}} onClearTagFilters={filters.clearTagFilters}
      onCreatePlaylist={async () => "fixture-playlist"} onCreateSmartPlaylist={async (playlist) => setSmartPlaylists(current => [...current, playlist])} smartPlaylists={smartPlaylists}
      onSetSmartPlaylists={async (update) => setSmartPlaylists(current => typeof update === "function" ? update(current) : update)} onSyncPlaylist={async () => {}} onExportSmartPlaylists={() => {}}
      onImportSmartPlaylists={async () => ({ importedCount: 0, relinkedCount: 0, unresolvedCount: 0, verificationUnavailable: false })} />}
  </main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
