import { rememberRuleFacts } from "@/features/automatic-tags/facts";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TagSelector from "@/features/tag-data/components/TagSelector";
import ArtistDetails from "@/features/artist-state/components/ArtistDetails";
import ApplyToTracksDialog from "@/features/playlist-state/components/ApplyToTracksDialog";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { buildCategoryTree, createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import { trackArtistIdentitiesStore } from "@/services/trackArtistIdentities";
import type { BatchTagUpdate, TagDataStructure } from "@/types/tagData";
import "@/styles/globals.css";

// This example never connects to Spotify or Community and never opens the user's database.
localStorage.setItem("tagify:sync:account-id", "isolated-tagging-workflows-v2");
window.fetch = async () => new Response(JSON.stringify({ perspectives: [], contributors: [] }), { headers: { "Content-Type": "application/json" } });
Object.assign(window, { Spicetify: { showNotification: (message: string) => {
  const notice = document.getElementById("notification")!; notice.textContent = message; notice.hidden = false;
}, Platform: { History: { push: () => {} } } } });
const first = "spotify:track:exampleOne";
const second = "spotify:track:exampleTwo";
const artist = "spotify:artist:exampleArtist";
const taxonomy = createEmptyTaxonomy();
taxonomy.categoryOrder = ["genre", "mood"];
taxonomy.categoriesById = {
  genre: { id: "genre", name: "Genre", subcategoryIds: [], childIds: ["house", "genreWarm"] },
  mood: { id: "mood", name: "Mood", subcategoryIds: [], childIds: ["moodWarm", "focus"] },
};
taxonomy.childrenByParentId = { genre: ["house", "genreWarm"], mood: ["moodWarm", "focus"] };
taxonomy.tagsById = {
  house: { id: "house", name: "House", subcategoryId: "genre", parentId: "genre" },
  genreWarm: { id: "genreWarm", name: "Warm", subcategoryId: "genre", parentId: "genre" },
  moodWarm: { id: "moodWarm", name: "Warm", subcategoryId: "mood", parentId: "mood" },
  focus: { id: "focus", name: "Focus", subcategoryId: "mood", parentId: "mood" },
};
const seed: TagDataStructure = { ...defaultTagData, taxonomy, tracks: {
  [first]: { name: "One", artists: "Example Artist", rating: 4, energy: 7, bpm: 120, tagIds: ["house"], dateCreated: 10, dateModified: 20 },
  [second]: { name: "Two", artists: "Example Artist", rating: 3, energy: 6, bpm: 125, tagIds: [], dateCreated: 11, dateModified: 21 },
}, artists: { [artist]: { name: "Example Artist", rating: 5, energy: 10, tagIds: ["house", "moodWarm"], dateCreated: 1, dateModified: 2 } } };
rememberRuleFacts(first, { durationMs: 170000 });
rememberRuleFacts(second, { durationMs: 250000 });
trackArtistIdentitiesStore.rememberMany([[first, [{ uri: artist, name: "Example Artist" }]], [second, [{ uri: artist, name: "Example Artist" }]]]);
function Fixture() {
  const [data, setData] = useState<TagDataStructure | null>(null);
  const [view, setView] = useState("track");
  const [showCopy, setShowCopy] = useState(false);
  const [status, setStatus] = useState("");
  const reload = async () => setData(await indexedDBStorage.loadAllStrict());
  useEffect(() => { void (async () => { await indexedDBStorage.init(); if (!(await indexedDBStorage.getTrack(first))) await indexedDBStorage.saveAll(seed); await reload(); })(); }, []);
  const apply = async (updates: BatchTagUpdate[]) => { await indexedDBStorage.applyBulkTagUpdates(updates); await reload(); setStatus("Saved to IndexedDB."); };
  if (!data) return <p>Loading isolated library…</p>;
  return <main style={{ maxWidth: 900, margin: "0 auto" }}>
    <h1>Tagging workflows</h1><p className="fixtureBar">Isolated example library · production components and IndexedDB · no live account</p>
    <nav className="fixtureBar"><button onClick={() => setView("track")}>Track tagging</button><button onClick={() => setView("artist")}>Artist details</button><button onClick={() => setShowCopy(true)}>Album copying</button>
      <button onClick={async () => { const entry = await indexedDBStorage.getLatestBulkUndo(); if (entry) { await indexedDBStorage.undoBulkTagUpdate(entry.id); await reload(); setStatus("Bulk change undone."); } }}>Undo last bulk change</button></nav>
    {view === "track" ? <TagSelector categories={buildCategoryTree(data.taxonomy)} customAccentsById={{}} trackTagIds={data.tracks[first].tagIds} onToggleTag={id => void apply([{ trackUri: first, toAdd: data.tracks[first].tagIds.includes(id) ? [] : [id], toRemove: data.tracks[first].tagIds.includes(id) ? [id] : [] }])} onCreateTag={async (name, parent) => { const tag = await indexedDBStorage.createQuickTag(name, parent); await reload(); return tag.id; }} onOpenTagManager={() => {}} isMultiTagging={false} isLockedTrack={false} /> : <ArtistDetails artistUri={artist} artistData={data.artists[artist]} taxonomy={data.taxonomy} tracks={data.tracks} activeTagFilters={[]} excludedTagFilters={[]} onSetRating={() => {}} onSetEnergy={() => {}} onAddTag={() => {}} onRemoveTag={() => {}} onToggleTagIncludeOff={() => {}} onOpenArtist={() => {}} onRefreshMetadata={() => {}} />}
    {showCopy ? <ApplyToTracksDialog entityLabel="Album" name="Example album" ownerName="Example Artist" values={{ tagIds: ["house", "moodWarm"], rating: 5, energy: 10 }} tagNames={["House", "Warm"]} tracks={data.tracks} loadTrackUris={async () => [first, second]} onApply={apply} onClose={() => setShowCopy(false)} /> : null}
    <p role="status">{status}</p><h2>Saved song annotations</h2><pre aria-label="Saved song annotations">{JSON.stringify(data.tracks, null, 2)}</pre>
  </main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
