import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TrackList from "@/features/track-session/components/TrackList";
import TrackDetails from "@/features/track-session/components/TrackDetails";
import { useFilterState } from "@/features/filter-state";
import { useRecordingLibrary } from "@/features/recording-reuse/hooks/useRecordingLibrary";
import { RecordingConflicts } from "@/features/recording-reuse/components/RecordingConflicts";
import { recordingAnnotations } from "@/features/recording-reuse/utils/recordingReuse";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyService } from "@/services/SpotifyService";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { defaultTagData } from "@/constants/defaultTagData";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import type { TrackData } from "@/types/tagData";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import "@/styles/globals.css";
localStorage.setItem("tagify:sync:account-id", "isolated-recordings-20261009");
window.fetch = async () => new Response("{}", { status: 404 });
Object.assign(window, { Spicetify: { showNotification: console.info, Player: { data: null }, Platform: { History: { push: () => {} } } } });
const taxonomy = buildTaxonomyFromCategoryTree([{ id: "genre", name: "Genre", subcategories: [{ id: "styles", name: "Styles", tags: [{ id: "house", name: "House" }, { id: "ambient", name: "Ambient" }] }] }]);
const house = Object.values(taxonomy.tagsById).find(tag => tag.name === "House")!.id;
const ambient = Object.values(taxonomy.tagsById).find(tag => tag.name === "Ambient")!.id;
const uri = (letter: string) => `spotify:track:${letter.repeat(22)}`;
const identity = { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 210000, name: "Glass Horizons" };
const original: TrackData = { name: "Glass Horizons", artists: "Maya Fields", rating: 5, energy: 8, bpm: 120, camelotKey: "8A", tagIds: [house], albumName: "Glass Horizons", dateCreated: 10, dateModified: 20, recordingIdentity: identity };
const seed: Record<string, TrackData> = {
  [uri("f")]: original,
  [uri("g")]: { ...original, albumName: "Late Night Selections", rating: 0, energy: 0, tagIds: [], dateModified: 30 },
  [uri("h")]: { ...original, name: "Quiet Signals", albumName: "Quiet Signals", rating: 3, energy: 4, dateModified: 40, recordingIdentity: { ...identity, isrc: "USABC2400002", name: "Quiet Signals" } },
  [uri("i")]: { ...original, name: "Quiet Signals", albumName: "After Hours", tagIds: [ambient], dateModified: 50, recordingIdentity: { ...identity, isrc: "USABC2400002", name: "Quiet Signals" } },
  [uri("j")]: { ...original, name: "Quiet Signals (Live)", albumName: "Live at Dawn", dateModified: 60, recordingIdentity: { ...identity, isrc: "USABC2400003", name: "Quiet Signals (Live)" } },
};
const spotifyTrack = (id: string, data: TrackData) => ({ uri: id, name: data.name, duration_ms: 210000, artists: [{ name: data.artists, uri: `spotify:artist:${"a".repeat(22)}` }], album: { name: data.albumName, uri: `spotify:album:${"b".repeat(22)}`, images: [] } }) as SpotifyTrack;
spotifyService.getTrackMetadata = async () => ({ releaseDate: "2024-06-07", trackLength: "3:30", playCount: null, genres: [], albumCoverUrl: null, sourceContext: null });
spotifyService.getTrack = async id => spotifyTrack(id, seed[id]);
audioFeaturesService.getAudioFeaturesFromUri = async () => ({ bpm: 120, camelotKey: "8A" });
function Fixture() {
  const [tracks, setTracks] = useState<Record<string, TrackData>>({});
  const [ready, setReady] = useState(false), [selected, setSelected] = useState(uri("f"));
  const filters = useFilterState("tracks");
  const reload = async () => setTracks((await indexedDBStorage.loadAllStrict()).tracks);
  useEffect(() => { void (async () => { await indexedDBStorage.init(); if (!(await indexedDBStorage.getTrack(uri("f")))) await indexedDBStorage.saveAll({ ...defaultTagData, taxonomy, tracks: seed }); await reload(); setReady(true); })(); }, []);
  const groups = useRecordingLibrary(tracks, ready, reload);
  const save = async (changes: Partial<TrackData>) => { await indexedDBStorage.saveTrack(selected, { ...tracks[selected], ...changes, dateModified: Date.now() }); await reload(); };
  if (!ready) return <p>Loading isolated library…</p>;
  return <main style={{ maxWidth: 1080, margin: "0 auto" }}>
    <div className="fixtureBar">Isolated library · production song matching and review<button onClick={async () => { await indexedDBStorage.saveAll({ ...defaultTagData, taxonomy, tracks: seed }); await reload(); }}>Reset test library</button><button onClick={() => setSelected(uri("g"))}>Open other release</button></div>
    <TrackDetails displayedTrack={spotifyTrack(selected, tracks[selected])} currentlyPlayingTrack={null} trackData={tracks[selected]} taxonomy={taxonomy} activeTagFilters={[]} excludedTagFilters={[]} onSetRating={rating => void save({ rating })} onSetEnergy={energy => void save({ energy })} onSetBpm={bpm => void save({ bpm })} onSetCamelotKey={camelotKey => void save({ camelotKey })} onRemoveTag={tag => void save({ tagIds: tracks[selected].tagIds.filter(id => id !== tag) })} onToggleTagIncludeOff={() => {}} onPlayTrack={() => {}} isLocked={false} onToggleLock={() => {}} onSwitchToCurrentTrack={() => {}} onUpdateBpm={async () => 120} />
    <RecordingConflicts groups={groups} taxonomy={taxonomy} onSave={async (group, choices) => {
      await indexedDBStorage.linkRecordings(Object.fromEntries(group.entries.map(([id, data]) => [id, { identity: data.recordingIdentity!, annotations: recordingAnnotations(data) }])), group.entries[0][0], false, { automatic: true, choices }); await reload();
    }} />
    <TrackList tracks={tracks} taxonomy={taxonomy} includeTagClauses={filters.includeTagClauses} clauseConnectors={filters.clauseConnectors} activeTagFilters={filters.activeTagFilters} excludedTagFilters={filters.excludedTagFilters} selectedClauseIndex={filters.selectedClauseIndex} activeTrackUri={selected} onAddIncludeClause={filters.addIncludeClause} onRemoveIncludeClause={filters.removeIncludeClause} onSelectClause={filters.setSelectedClauseIndex} onSetIncludeClauseOperator={filters.setIncludeClauseOperator} onSetClauseConnector={filters.setClauseConnector} onRemoveTagFilter={filters.removeTagFilter} onToggleTagIncludeOff={filters.toggleTagIncludeOff} onMoveTagToClauseLane={filters.moveTagToClauseLane} onReplaceTagFilterFormula={filters.replaceTagFilterFormula} onClearTagFilters={filters.clearTagFilters} onPlayTrack={() => {}} onTagTrack={setSelected} onCreatePlaylist={async () => null} onCreateSmartPlaylist={async () => {}} smartPlaylists={[]} onSetSmartPlaylists={async () => {}} onSyncPlaylist={async () => {}} onExportSmartPlaylists={() => {}} onImportSmartPlaylists={async () => ({ importedCount: 0, skippedCount: 0, overwrittenCount: 0 }) as never} />
    <details><summary>Saved test data</summary><pre>{JSON.stringify(tracks, null, 2)}</pre></details>
  </main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
