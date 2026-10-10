import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TrackList from "@/features/track-session/components/TrackList";
import AlbumTrackList from "@/features/playlist-state/components/AlbumTrackList";
import { PrivateNote } from "@/features/private-notes/components/PrivateNote";
import { useFilterState } from "@/features/filter-state";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { savePrivateNote, notifyPrivateNotesChanged } from "@/services/sync/PrivateNotes";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { buildTaxonomyFromCategoryTree, buildResolvedTagLookup } from "@/utils/tagTaxonomy";
import type { TagDataStructure } from "@/types/tagData";
import "@/styles/globals.css";

localStorage.setItem("tagify:sync:account-id", "isolated-track-notes-20261009");
window.fetch = async () => new Response("{}", { status: 404 });
Object.assign(window, { Spicetify: { showNotification: () => {}, Player: { data: null }, Platform: { History: { push: () => {} } } } });
const albumUri = `spotify:album:${"b".repeat(22)}`;
const songs = [
  { uri: `spotify:track:${"a".repeat(22)}`, name: "Glass Horizons" },
  { uri: `spotify:track:${"c".repeat(22)}`, name: "Quiet Signals" },
  { uri: `spotify:local:Maya%20Fields:Glass%20Horizons:First%20Light:210`, name: "First Light" },
];
const taxonomy = buildTaxonomyFromCategoryTree([{ id: "genre", name: "Genre", subcategories: [{ id: "styles", name: "Styles", tags: [{ id: "house", name: "House" }] }] }]);
spotifyApiService.getAlbumTracks = async () => songs.map((song, index) => ({ ...song, artists: "Maya Fields", discNumber: 1, trackNumber: index + 1 }));
const readNotes = indexedDBStorage.getPrivateNotesForUris.bind(indexedDBStorage);
let failReads = false;
indexedDBStorage.getPrivateNotesForUris = (...args) => failReads ? Promise.reject(new Error("Isolated read failure")) : readNotes(...args);

function Fixture() {
  const [data, setData] = useState<TagDataStructure | null>(null);
  const [selected, setSelected] = useState(songs[0].uri);
  const [narrow, setNarrow] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [failed, setFailed] = useState(false);
  const filters = useFilterState("tracks");
  useEffect(() => { void (async () => {
    await indexedDBStorage.init();
    await indexedDBStorage.saveTaxonomy(taxonomy);
    for (const song of songs) await indexedDBStorage.saveTrack(song.uri, { name: song.name, artists: "Maya Fields", albumUri, rating: 4, energy: 6, bpm: 120, tagIds: Object.keys(taxonomy.tagsById), dateCreated: 1720000000000, dateModified: 1720000000000 });
    if (!localStorage.getItem("fixture:notes-seeded")) {
      await savePrivateNote(songs[0].uri, "Warm opener — let the intro breathe.", "");
      await savePrivateNote(songs[1].uri, " \n ", "");
      await savePrivateNote(songs[2].uri, "Starts quietly.\n" + "A long reminder about the transition and the second breakdown. ".repeat(40), "");
      localStorage.setItem("fixture:notes-seeded", "yes");
    }
    setData({ ...await indexedDBStorage.loadAllStrict(), taxonomy });
  })(); }, []);
  const open = (uri: string) => { setSelected(uri); document.getElementById("editor")?.scrollIntoView({ block: "center" }); };
  return <main style={{ maxWidth: narrow ? 350 : 1000, margin: "0 auto" }}>
    <div className="fixtureBar">Isolated production UI
      <button onClick={() => setNarrow(value => !value)}>{narrow ? "Desktop layout" : "Narrow layout"}</button>
      <button onClick={() => setEmpty(value => !value)}>{empty ? "Restore songs" : "Empty list"}</button>
      <button onClick={() => { failReads = !failReads; setFailed(failReads); notifyPrivateNotesChanged(); }}>{failed ? "Allow note reads" : "Fail note reads"}</button>
    </div>
    <section id="editor" style={{ maxWidth: 360, marginBottom: 16 }}>
      <h2>{songs.find(song => song.uri === selected)?.name}</h2>
      <PrivateNote key={selected} uri={selected} inline />
    </section>
    {data && <>
      <TrackList tracks={empty ? {} : data.tracks} taxonomy={taxonomy} includeTagClauses={filters.includeTagClauses} clauseConnectors={filters.clauseConnectors} activeTagFilters={filters.activeTagFilters} excludedTagFilters={filters.excludedTagFilters} selectedClauseIndex={filters.selectedClauseIndex} activeTrackUri={selected}
        onAddIncludeClause={filters.addIncludeClause} onRemoveIncludeClause={filters.removeIncludeClause} onSelectClause={filters.setSelectedClauseIndex} onSetIncludeClauseOperator={filters.setIncludeClauseOperator} onSetClauseConnector={filters.setClauseConnector} onRemoveTagFilter={filters.removeTagFilter} onToggleTagIncludeOff={filters.toggleTagIncludeOff} onMoveTagToClauseLane={filters.moveTagToClauseLane} onReplaceTagFilterFormula={filters.replaceTagFilterFormula} onPlayTrack={() => {}} onTagTrack={open} onClearTagFilters={filters.clearTagFilters}
        onCreatePlaylist={async () => null} onCreateSmartPlaylist={async () => {}} smartPlaylists={[]} onSetSmartPlaylists={async () => {}} onSyncPlaylist={async () => {}} onExportSmartPlaylists={() => {}} onImportSmartPlaylists={async () => ({ importedCount: 0, relinkedCount: 0, unresolvedCount: 0, verificationUnavailable: false })} />
      <h2>Album tracks</h2>
      <AlbumTrackList albumUri={albumUri} tracks={data.tracks} resolvedLookup={buildResolvedTagLookup(taxonomy)} customAccentsById={{}} onTagTrack={open} onRateTrack={() => {}} />
    </>}
  </main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
