import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PlaylistDetails from "@/features/playlist-state/components/PlaylistDetails";
import ArtistDetails from "@/features/artist-state/components/ArtistDetails";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { savePrivateNote } from "@/services/sync/PrivateNotes";
import { spotifyApiService } from "@/services/SpotifyApiService";
import type { AlbumTrackSummary } from "@/types/tagData";
import "@/styles/globals.css";

localStorage.setItem("tagify:sync:account-id", "isolated-entity-notes-20261009");
window.fetch = async () => new Response("{}", { status: 404 });
Object.assign(window, { Spicetify: { showNotification: () => {}, Player: { data: null }, Platform: { History: { push: () => {} } } } });
const entities = [
  { uri: `spotify:album:${"a".repeat(22)}`, name: "Glass Horizons", kind: "Album" },
  { uri: `spotify:playlist:${"b".repeat(22)}`, name: "Late Night Warmup", kind: "Playlist" },
  { uri: `spotify:artist:${"c".repeat(22)}`, name: "Maya Fields", kind: "Artist" },
  { uri: `spotify:album:${"d".repeat(22)}`, name: "Quiet Signals", kind: "Other album" },
];
const [chillTagId, rockTagId, rnbTagId] = ["Chill", "Rock", "R&B"].map(name => Object.values(defaultTagData.taxonomy.tagsById).find(tag => tag.name === name)!.id);
const summary: AlbumTrackSummary = { albumName: "Glass Horizons", artistName: "Maya Fields", imageUrl: null,
  taggedTrackCount: 4, ratedTrackCount: 3, ratingAverage: 4.5, energyTrackCount: 2, energyAverage: 6.5, lastTaggedAt: 1720000000000,
  commonTags: [{ tagId: chillTagId, trackCount: 3, coverage: 0.75 }, { tagId: rockTagId, trackCount: 2, coverage: 0.5 }, { tagId: rnbTagId, trackCount: 1, coverage: 0.25 }] };
const tracks = Object.fromEntries([1, 2].map(index => [`spotify:track:${String(index).repeat(22)}`, {
  rating: 4, energy: 7, bpm: null, tagIds: [chillTagId, rockTagId, ...(index === 1 ? [rnbTagId] : [])], albumUri: entities[0].uri, dateModified: 1720000000000,
}]));
spotifyApiService.getAlbumTracks = async () => ["First Light", "Glass Horizons"].map((name, index) => ({ uri: `spotify:track:${String(index + 1).repeat(22)}`, name, artists: "Maya Fields", trackNumber: index + 1, discNumber: 1 }));
const mutate = indexedDBStorage.mutatePrivateNotes.bind(indexedDBStorage);
let failNextSave = false;
indexedDBStorage.mutatePrivateNotes = (...args) => {
  if (failNextSave) { failNextSave = false; return Promise.reject(new Error("Your note couldn't be saved. Your draft is kept; please try again.")); }
  return mutate(...args);
};

function Fixture() {
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(0);
  const [applied, setApplied] = useState<Record<string, string[]>>({});
  useEffect(() => { void (async () => {
    await indexedDBStorage.init();
    if (!localStorage.getItem("fixture:entity-notes-seeded")) {
      await savePrivateNote(entities[1].uri, "Build slowly; leave room for the headliner.", "");
      await savePrivateNote(entities[2].uri, Array.from({ length: 45 }, (_, i) => `Listening note ${i + 1}: warm textures and patient transitions.`).join("\n"), "");
      localStorage.setItem("fixture:entity-notes-seeded", "yes");
    }
    setReady(true);
  })(); }, []);
  const entity = entities[selected];
  const tagIds = applied[entity.uri] ?? [chillTagId];
  const actions = { onSetRating: () => {}, onSetEnergy: () => {},
    onAddTag: (id: string) => setApplied(previous => ({ ...previous, [entity.uri]: [...new Set([...(previous[entity.uri] ?? [chillTagId]), id])] })),
    onRemoveTag: (id: string) => setApplied(previous => ({ ...previous, [entity.uri]: (previous[entity.uri] ?? [chillTagId]).filter(tag => tag !== id) })),
    onToggleTagIncludeOff: () => {} };
  return <main style={{ maxWidth: 1000, margin: "0 auto" }}>
    <div className="fixtureBar">Isolated production UI
      {entities.map((item, index) => <button key={item.uri} onClick={() => setSelected(index)}>{item.kind}</button>)}
      <button onClick={() => { failNextSave = true; }}>Fail next save</button>
    </div>
    {ready && <>
      {entity.kind === "Artist" ? <ArtistDetails artistUri={entity.uri} artistData={{ name: entity.name, rating: 4, energy: 7, tagIds, genres: [], followerCount: 12345, dateModified: 1720000000000 }} trackInsights={{ summaries: new Map([[entity.uri, summary]]), pendingCount: 0, isChecking: false, blockedUntil: 0, retry: () => {} }} taxonomy={defaultTagData.taxonomy} activeTagFilters={[]} excludedTagFilters={[]} {...actions} onOpenArtist={() => {}} onRefreshMetadata={() => {}} /> :
        <PlaylistDetails playlistUri={entity.uri} playlistData={{ name: entity.name, ownerName: "Maya Fields", rating: 4, energy: 7, tagIds, trackCount: 2, description: entity.kind === "Playlist" ? "Patient grooves for the early hours." : "Released 2024-06-07", dateModified: 1720000000000 }} albumTrackSummary={summary} playlistTrackInsights={{ status: "loaded", uris: [], listedTrackCount: 4, totalTrackCount: 4, summary }} tracks={tracks} taxonomy={defaultTagData.taxonomy} activeTagFilters={[]} excludedTagFilters={[]} {...actions} onOpenPlaylist={() => {}} onRefreshMetadata={() => {}} onLoadTrackUris={async () => []} onApplyTrackUpdates={async () => {}} onTagTrack={() => {}} onSetTrackRating={() => {}} />}
    </>}
  </main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
