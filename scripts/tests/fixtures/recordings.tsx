import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TrackList from "@/features/track-session/components/TrackList";
import TrackDetails from "@/features/track-session/components/TrackDetails";
import { useFilterState } from "@/features/filter-state";
import { useAutomaticRecordingReuse } from "@/features/recording-reuse/hooks/useAutomaticRecordingReuse";
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
import { discussion39Artists, discussion39Releases } from "./discussion39";
const exact = new URLSearchParams(location.search).has("discussion39");
const unopened = exact && new URLSearchParams(location.search).has("unopened");
localStorage.setItem("tagify:sync:account-id", unopened ? "isolated-discussion39-unopened" : exact ? "isolated-discussion39" : "isolated-recordings-20261009");
window.fetch = async input => {
  const release = discussion39Releases.find(value => String(input) === `https://spclient.wg.spotify.com/metadata/4/track/${value.gid}`);
  return new Response(JSON.stringify(exact && release ? release : {}), { status: exact ? (release ? 200 : 429) : 404 });
};
Object.assign(window, { Spicetify: { showNotification: console.info, Player: { data: null }, URI: {
  idToHex: (id: string) => discussion39Releases.find(value => value.id === id)?.gid,
  hexToId: (gid: string) => discussion39Artists.find(value => value.gid === gid)?.id,
}, Platform: { History: { push: () => {} }, AuthorizationAPI: { getState: () => ({ token: { accessToken: "isolated-fixture" } }) } } } });
const taxonomy = buildTaxonomyFromCategoryTree([{ id: "genre", name: "Genre", subcategories: [{ id: "styles", name: "Styles", tags: [{ id: "house", name: "House" }, { id: "ambient", name: "Ambient" }] }] }]);
const house = Object.values(taxonomy.tagsById).find(tag => tag.name === "House")!.id;
const ambient = Object.values(taxonomy.tagsById).find(tag => tag.name === "Ambient")!.id;
const uri = (letter: string) => `spotify:track:${letter.repeat(22)}`;
const identity = { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 210000, name: "Glass Horizons" };
const original: TrackData = { name: "Glass Horizons", artists: "Maya Fields", rating: 5, energy: 8, bpm: 120, camelotKey: "8A", tagIds: [house], albumName: "Glass Horizons", dateCreated: 10, dateModified: 20, recordingIdentity: identity };
const examples: Record<string, TrackData> = {
  [uri("f")]: original,
  [uri("g")]: { ...original, albumName: "Late Night Selections", rating: 0, energy: 0, tagIds: [], dateModified: 30 },
  [uri("h")]: { ...original, name: "Quiet Signals", albumName: "Quiet Signals", rating: 3, energy: 4, dateModified: 40, recordingIdentity: { ...identity, isrc: "USABC2400002", name: "Quiet Signals" } },
  [uri("i")]: { ...original, name: "Quiet Signals", albumName: "After Hours", tagIds: [ambient], dateModified: 50, recordingIdentity: { ...identity, isrc: "USABC2400002", name: "Quiet Signals" } },
  [uri("j")]: { ...original, name: "Quiet Signals (Live)", albumName: "Live at Dawn", dateModified: 60, recordingIdentity: { ...identity, isrc: "USABC2400003", name: "Quiet Signals (Live)" } },
};
const seed: Record<string, TrackData> = exact ? Object.fromEntries(discussion39Releases.map((release, index) => [`spotify:track:${release.id}`, {
  ...original, recordingIdentity: undefined, name: release.name, artists: discussion39Artists.map(artist => artist.name).join(", "),
  albumName: release.album, rating: index ? 0 : 5, energy: index ? 0 : 8, tagIds: index ? [] : [house], dateModified: 20 + index,
}])) : examples;
const initialTracks = unopened ? Object.fromEntries(Object.entries(seed).slice(0, 1)) : seed;
const sourceUri = exact ? `spotify:track:${discussion39Releases[0].id}` : uri("f");
const spotifyTrack = (id: string, data: TrackData) => ({ uri: id, name: data.name, duration_ms: exact ? 192000 : 210000, artists: exact ? discussion39Artists.map(artist => ({ name: artist.name, uri: `spotify:artist:${artist.id}` })) : [{ name: data.artists, uri: `spotify:artist:${"a".repeat(22)}` }], album: { name: data.albumName, uri: `spotify:album:${"b".repeat(22)}`, images: [] } }) as SpotifyTrack;
spotifyService.getTrackMetadata = async () => ({ releaseDate: "2024-06-07", trackLength: exact ? "3:12" : "3:30", playCount: null, genres: [], albumCoverUrl: null, sourceContext: null });
spotifyService.getTrack = async id => spotifyTrack(id, seed[id]);
audioFeaturesService.getAudioFeaturesFromUri = async () => ({ bpm: 120, camelotKey: "8A" });
function Fixture() {
  const [tracks, setTracks] = useState<Record<string, TrackData>>({});
  const [ready, setReady] = useState(false), [selected, setSelected] = useState(sourceUri);
  const filters = useFilterState("tracks");
  const reload = async () => setTracks((await indexedDBStorage.loadAllStrict()).tracks);
  useEffect(() => { void (async () => { await indexedDBStorage.init(); if (!(await indexedDBStorage.getTrack(sourceUri))) await indexedDBStorage.saveAll({ ...defaultTagData, taxonomy, tracks: initialTracks }); await reload(); setReady(true); })(); }, []);
  const displayedData = tracks[selected] || seed[selected];
  const displayed = spotifyTrack(selected, displayedData);
  useAutomaticRecordingReuse(exact && ready ? displayed : null, tracks, reload);
  const groups = useRecordingLibrary(tracks, ready, reload);
  const save = async (changes: Partial<TrackData>) => { await indexedDBStorage.saveTrack(selected, { ...tracks[selected], ...changes, dateModified: Date.now() }); await reload(); };
  if (!ready) return <p>Loading isolated library…</p>;
  return <main style={{ maxWidth: 1080, margin: "0 auto" }}>
    <div className="fixtureBar">Isolated library · production song matching and review<button onClick={async () => { await indexedDBStorage.saveAll({ ...defaultTagData, taxonomy, tracks: initialTracks }); await reload(); }}>Reset test library</button>{exact ? discussion39Releases.map((release, index) => <button key={release.id} onClick={() => setSelected(`spotify:track:${release.id}`)}>{["Single", "EP", "Album"][index]}</button>) : <button onClick={() => setSelected(uri("g"))}>Open other release</button>}</div>
    <TrackDetails displayedTrack={displayed} currentlyPlayingTrack={null} trackData={displayedData} taxonomy={taxonomy} activeTagFilters={[]} excludedTagFilters={[]} onSetRating={rating => void save({ rating })} onSetEnergy={energy => void save({ energy })} onSetBpm={bpm => void save({ bpm })} onSetCamelotKey={camelotKey => void save({ camelotKey })} onRemoveTag={tag => void save({ tagIds: tracks[selected].tagIds.filter(id => id !== tag) })} onToggleTagIncludeOff={() => {}} onPlayTrack={() => {}} isLocked={false} onToggleLock={() => {}} onSwitchToCurrentTrack={() => {}} onUpdateBpm={async () => 120} />
    <RecordingConflicts groups={groups} taxonomy={taxonomy} onSave={async (group, choices) => {
      await indexedDBStorage.linkRecordings(Object.fromEntries(group.entries.map(([id, data]) => [id, { identity: data.recordingIdentity!, annotations: recordingAnnotations(data) }])), group.entries[0][0], false, { automatic: true, choices }); await reload();
    }} />
    <TrackList tracks={tracks} taxonomy={taxonomy} includeTagClauses={filters.includeTagClauses} clauseConnectors={filters.clauseConnectors} activeTagFilters={filters.activeTagFilters} excludedTagFilters={filters.excludedTagFilters} selectedClauseIndex={filters.selectedClauseIndex} activeTrackUri={selected} onAddIncludeClause={filters.addIncludeClause} onRemoveIncludeClause={filters.removeIncludeClause} onSelectClause={filters.setSelectedClauseIndex} onSetIncludeClauseOperator={filters.setIncludeClauseOperator} onSetClauseConnector={filters.setClauseConnector} onRemoveTagFilter={filters.removeTagFilter} onToggleTagIncludeOff={filters.toggleTagIncludeOff} onMoveTagToClauseLane={filters.moveTagToClauseLane} onReplaceTagFilterFormula={filters.replaceTagFilterFormula} onClearTagFilters={filters.clearTagFilters} onPlayTrack={() => {}} onTagTrack={setSelected} onCreatePlaylist={async () => null} onCreateSmartPlaylist={async () => {}} smartPlaylists={[]} onSetSmartPlaylists={async () => {}} onSyncPlaylist={async () => {}} onExportSmartPlaylists={() => {}} onImportSmartPlaylists={async () => ({ importedCount: 0, skippedCount: 0, overwrittenCount: 0 }) as never} />
    <details><summary>Saved test data</summary><pre>{JSON.stringify(tracks, null, 2)}</pre></details>
  </main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
