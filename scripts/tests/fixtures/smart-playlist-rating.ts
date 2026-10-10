import { evaluateTrackMatchesCriteria } from "../../../src/features/smart-playlists/utils/smartPlaylist.criteria";
import type { TrackData } from "../../../src/types/tagData";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "../../../src/utils/tagTaxonomy";

const trackUris = ["spotify:track:example1", "spotify:track:example2"];
const tracks = Object.fromEntries(trackUris.map(uri => [uri, {
  rating: 5, energy: 6, bpm: 120, camelotKey: "8A", tagIds: [], dateCreated: 1, dateModified: 2,
}])) as Record<string, TrackData>;
const playlist = { playlistId: "favorites", playlistName: "Five-star favorites", isActive: true,
  criteria: { includeTagClauses: [], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null,
    energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null }, smartPlaylistTrackUris: [...trackUris] };
let writes = 0;
function status() {
  document.querySelector("#status")!.textContent = JSON.stringify({ tracks, members: playlist.smartPlaylistTrackUris, writes }, null, 2);
}
function renderRows() {
  const grid = document.querySelector('[role="grid"]')!;
  grid.replaceChildren();
  playlist.smartPlaylistTrackUris.forEach((uri, index) => {
    const row = document.createElement("div");
    row.className = "main-trackList-trackListRow";
    row.setAttribute("role", "row");
    row.setAttribute("aria-selected", "false");
    Object.assign(row, { fixtureTrack: { uri } });
    row.innerHTML = `<div class="main-trackList-rowSectionFirst" aria-colindex="1">Example song ${index + 1}</div><div class="main-trackList-rowSectionEnd" aria-colindex="2">3:42</div>`;
    grid.appendChild(row);
  });
}
export const keyboardShortcutService = { initialize() {} };
export const getTagifyDatabaseName = () => "tagify-rating-fixture";
export const restoreDesktopSyncConfiguration = async () => {};
export const syncRuntime = { start() {} };
export const welcomeModal = { initialize() {} };
export const loadSmartPlaylistsFromStorage = async () => [structuredClone(playlist)];
export const smartPlaylistSyncService = {
  startBackgroundReconciliation() {},
  async syncTrack(uri: string, track: TrackData) {
    if (playlist.isActive && (!track || !evaluateTrackMatchesCriteria(track, playlist.criteria))) {
      playlist.smartPlaylistTrackUris = playlist.smartPlaylistTrackUris.filter(member => member !== uri);
      document.querySelector(`[data-tagify-track-uri="${uri}"]`)?.closest('[role="row"]')?.remove();
    }
    status();
  },
};
export const storageService = { initialize: async () => ({ status: "ready" }) };
export const flushLocalPersistence = async () => {};
// Saved songs live in memory; edits change them like the real library does.
export const indexedDBStorage = {
  init: async () => true,
  loadAllStrict: async () => ({
    schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy: createEmptyTaxonomy(),
    tracks: structuredClone(tracks), playlists: {}, artists: {}, smartPlaylists: [],
  }),
  async patchTracks(changes: Record<string, (current: TrackData | null) => TrackData | null | undefined>) {
    writes++;
    const saved: Record<string, TrackData | null> = {};
    Object.entries(changes).forEach(([uri, change]) => {
      const next = change(tracks[uri] ? { ...tracks[uri] } : null);
      if (next === undefined) return;
      saved[uri] = next;
      if (next) tracks[uri] = next;
      else delete tracks[uri];
    });
    status();
    return saved;
  },
};
Object.assign(window, { ratingFixture: { tracks, playlist, renderRows, status } });
Object.assign(globalThis, { Spicetify: {
  Platform: { History: { location: { pathname: "/playlist/favorites" }, listen() {}, push() {} } },
  ContextMenu: { Item: class { register() {} } }, showNotification: console.info,
} });
localStorage.clear();
localStorage.setItem("tagify:extensionSettings", JSON.stringify({ tracklistDisplayMode: "stars", playbarDisplayMode: "disabled" }));
renderRows();
status();
void import("../../../src/extensions/extension");
