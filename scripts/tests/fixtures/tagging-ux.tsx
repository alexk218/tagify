import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import TrackDetails from "@/features/track-session/components/TrackDetails";
import TagSelector from "@/features/tag-data/components/TagSelector";
import DataManager from "@/features/tag-data/components/DataManager";
import MultiTrackDetails from "@/features/multi-track-tagging/components/MultiTrackDetails";
import { useMultiTrackTagging } from "@/features/multi-track-tagging/hooks/useMultiTrackTagging";
import { useTagDataTrackActions } from "@/features/tag-data/hooks/useTagDataTrackActions";
import { useTrackEditHistory } from "@/features/track-session/history/useTrackEditHistory";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { TrackEditHistoryControls } from "@/features/track-session/history/TrackEditHistoryControls";
import { registerLocalPersistenceFlusher, flushLocalPersistence } from "@/services/sync/SyncLocalState";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyService } from "@/services/SpotifyService";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { buildTaxonomyFromCategoryTree, buildCategoryTree } from "@/utils/tagTaxonomy";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { TagDataStructure } from "@/types/tagData";
import "@/styles/globals.css";
localStorage.setItem("tagify:sync:account-id", "isolated-tagging-session-20261009");
window.fetch = async () => new Response(JSON.stringify({ perspectives: [], contributors: [] }), { status: 404, headers: { "Content-Type": "application/json" } });
Object.assign(window, { Spicetify: { showNotification: (message: string) => { document.getElementById("notification")!.textContent = message; document.getElementById("notification")!.hidden = false; }, Player: { data: null }, Platform: { History: { push: () => {} } } } });
const uri = `spotify:track:${"f".repeat(22)}`;
const taxonomy = buildTaxonomyFromCategoryTree([{ id: "genre", name: "Genre", subcategories: [{ id: "styles", name: "Styles", tags: [{ id: "house", name: "House" }, { id: "ambient", name: "Ambient" }] }] }]);
const track = { uri, name: "Glass Horizons", duration_ms: 210000, artists: [{ name: "Maya Fields", uri: `spotify:artist:${"a".repeat(22)}` }], album: { name: "Glass Horizons", uri: `spotify:album:${"b".repeat(22)}`, images: [] } } as SpotifyTrack;
spotifyService.getTrackMetadata = async () => ({ releaseDate: "2024-06-07", trackLength: "3:30", playCount: null, genres: [], albumCoverUrl: null, sourceContext: null });
audioFeaturesService.getAudioFeaturesFromUri = async () => ({ bpm: 120, camelotKey: "8A" });
const songs = [track, { ...track, uri: `spotify:track:${"g".repeat(22)}`, name: "Quiet Signals" }, { ...track, uri: `spotify:track:${"h".repeat(22)}`, name: "First Light" }];
const mutateNotes = indexedDBStorage.mutatePrivateNotes.bind(indexedDBStorage);
let failNextNoteSave = false;
indexedDBStorage.mutatePrivateNotes = (...args) => {
  if (failNextNoteSave) { failNextNoteSave = false; return Promise.reject(new Error("Your note couldn't be saved. Your draft is kept; please try again.")); }
  return mutateNotes(...args);
};
function Fixture() {
  const [initial, setInitial] = useState<TagDataStructure | null>(null);
  useEffect(() => { void (async () => {
    await indexedDBStorage.init();
    for (const song of songs) if (!(await indexedDBStorage.getTrack(song.uri))) await indexedDBStorage.saveTrack(song.uri, { name: song.name, artists: "Maya Fields", rating: 4, energy: 6, bpm: 120, camelotKey: "8A", tagIds: [], dateCreated: 10, dateModified: 20 });
    const data = await indexedDBStorage.loadAllStrict();
    await indexedDBStorage.saveTaxonomy(taxonomy);
    setInitial({ ...data, taxonomy });
  })(); }, []);
  return initial ? <Editor initial={initial} /> : <p>Loading isolated example…</p>;
}
function Editor({ initial }: { initial: TagDataStructure }) {
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState(0);
  const [hidden, setHidden] = useState(false);
  const latestTagDataRef = useRef(initial);
  const committedRef = useRef(initial);
  const persistence = useRef(Promise.resolve());
  const applySnapshot = useCallback((next: TagDataStructure) => { latestTagDataRef.current = next; committedRef.current = next; setData(next); }, []);
  const commit = useCallback((update: React.SetStateAction<TagDataStructure>) => {
    const next = typeof update === "function" ? update(latestTagDataRef.current) : update;
    const changes = Object.entries(next.tracks).filter(([uri, value]) => committedRef.current.tracks[uri] !== value);
    Object.keys(committedRef.current.tracks).filter(uri => !next.tracks[uri]).forEach(uri => changes.push([uri, null as never]));
    applySnapshot(next);
    persistence.current = persistence.current.then(async () => { if (!(await indexedDBStorage.saveTrackChanges(new Map(changes)))) throw new Error("Couldn't save the isolated edit."); });
  }, [applySnapshot]);
  useEffect(() => registerLocalPersistenceFlusher(() => persistence.current), []);
  const reload = async () => applySnapshot(await indexedDBStorage.loadAllStrict());
  const actions = useTagDataTrackActions({ tagData: data, latestTagDataRef, setTagData: commit, applyPersistedSnapshot: applySnapshot, emitUserTrackAddedEvent: () => {}, onSyncTrack: undefined, onSyncMultipleTracks: undefined });
  const multi = useMultiTrackTagging({ tagData: data });
  const displayed = songs[selected];
  const mode = hidden ? null : multi.isMultiTagging ? "bulk" : "single";
  const selection = mode === "bulk" ? multi.multiTagTracks.map(song => song.uri) : mode === "single" ? [displayed.uri] : [];
  const history = useTrackEditHistory(mode, selection, { draft: multi.multiTrackDraftTags, replaceDraft: multi.replaceMultiTrackDraft, onSaved: async () => { await reload(); } });
  const choose = (index: number) => { setHidden(false); multi.setIsMultiTagging(false); setSelected(index); };
  const chooseBulk = (index: number) => { setHidden(false); multi.setMultiTagTracks(songs.slice(index, index + 2)); multi.setIsMultiTagging(true); };
  const batch = async (updates: Parameters<typeof actions.applyBatchTagUpdates>[0]) => {
    const session = trackEditHistory.capture("bulk", selection);
    if (!trackEditHistory.hold(session)) throw new Error("Wait for the current edit to finish.");
    try { await flushLocalPersistence(); const before = (await indexedDBStorage.loadAllStrict()).tracks; await actions.applyBatchTagUpdates(updates); const after = (await indexedDBStorage.loadAllStrict()).tracks; trackEditHistory.record(session, before, after, "saved"); }
    finally { trackEditHistory.release(session); }
  };
  const selectedData = data.tracks[displayed.uri] || { rating: 0, energy: 0, bpm: null, tagIds: [] };
  return <main style={{ maxWidth: 1060, margin: "0 auto" }}>
    <div className="fixtureBar">Isolated UI review · production controls · no live account
      <button onClick={() => choose(0)}>Song A</button><button onClick={() => choose(1)}>Song B</button>
      <button onClick={() => chooseBulk(0)}>Bulk A+B</button><button onClick={() => chooseBulk(1)}>Bulk B+C</button>
      <button onClick={() => setHidden(true)}>Other view</button>
      <button onClick={() => { failNextNoteSave = true; }}>Fail next note save</button>
    </div>
    <DataManager onExportTagData={async () => {}} onImportTagData={async () => {}} onExportRekordbox={() => {}} onResetTagifyData={async () => {}} onRetryMigration={async () => { throw new Error("Not available in isolated review"); }} historyControls={mode && <TrackEditHistoryControls {...history} onUndo={history.undo} onRedo={history.redo} />} />
    {mode === "bulk" && multi.multiTrackDraftTags ? <MultiTrackDetails tracks={multi.multiTagTracks} trackDataMap={Object.fromEntries(multi.multiTagTracks.map(song => [song.uri, data.tracks[song.uri]]))} onCancelTagging={multi.cancelMultiTagging} onPlayTrack={() => {}} lockedTrackUri={multi.lockedMultiTrackUri} onLockTrack={multi.setLockedMultiTrackUri} multiTrackDraftTags={multi.multiTrackDraftTags} onSetMultiTrackDraftTags={multi.setMultiTrackDraftTags} onApplyBatchTagUpdates={batch} onFindCommonTagsFromDraft={multi.findCommonTagsFromDraft} onFindCommonStarRatingFromDraft={multi.findCommonStarRatingFromDraft} onFindCommonEnergyRatingFromDraft={multi.findCommonEnergyRatingFromDraft} onToggleStarRatingDraft={multi.toggleStarRatingDraft} onToggleEnergyRatingDraft={multi.toggleEnergyRatingDraft} onFindTagName={actions.findTagName} onToggleCommonTagDraft={multi.toggleCommonTagDraft} onToggleTagForSpecificTrackDraft={multi.toggleTagForSpecificTrackDraft} onCalculateBatchChanges={multi.calculateBatchChanges} /> : !hidden && <TrackDetails displayedTrack={displayed} currentlyPlayingTrack={track} trackData={selectedData} taxonomy={data.taxonomy} activeTagFilters={[]} excludedTagFilters={[]} onSetRating={value => void actions.setRating(displayed.uri, value)} onSetEnergy={value => void actions.setEnergy(displayed.uri, value)} onSetBpm={value => void actions.setBpm(displayed.uri, value)} onSetCamelotKey={value => void actions.setCamelotKey(displayed.uri, value)} onRemoveTag={id => void actions.toggleTagSingleTrack(displayed.uri, id)} onToggleTagIncludeOff={() => {}} onPlayTrack={() => {}} isLocked={false} onToggleLock={() => {}} onSwitchToCurrentTrack={() => {}} onUpdateBpm={async () => 120} />}
    {!hidden && <TagSelector categories={buildCategoryTree(data.taxonomy)} customAccentsById={{}} trackTagIds={mode === "bulk" ? multi.selectedTagsForSelector || [] : selectedData.tagIds} onToggleTag={id => mode === "bulk" ? multi.toggleTagMultiTrackDraft(id) : void actions.toggleTagSingleTrack(displayed.uri, id)} onOpenTagManager={() => {}} isMultiTagging={mode === "bulk"} isLockedTrack={false} />}
    <pre aria-label="Saved annotations">{JSON.stringify(data.tracks, null, 2)}</pre>
  </main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
