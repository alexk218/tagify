import type { TrackData } from "../../../src/types/tagData";
import { createEmptyTaxonomy, TAG_DATA_SCHEMA_VERSION } from "../../../src/utils/tagTaxonomy";

const params = new URLSearchParams(location.search);
const layout = params.get("layout") || "modern";
const legacy = layout === "legacy";
const aliased = layout === "aliased";
const recommended = layout === "recommended";
const uris = ["spotify:track:example1", "spotify:track:example2"];
const tracks = Object.fromEntries(uris.map((uri, index) => [uri, {
  rating: index ? 3.5 : 5, energy: 6, tagIds: [], dateCreated: 1, dateModified: 2,
}])) as Record<string, TrackData>;
let writes = 0;
let currentSong = 0;
const songListeners = new Set<() => void>();

export const keyboardShortcutService = { initialize() {} };
export const getTagifyDatabaseName = () => "tagify-spotify-layout-fixture";
export const restoreDesktopSyncConfiguration = async () => {};
export const syncRuntime = { start() {} };
export const welcomeModal = { initialize() {} };
export const loadSmartPlaylistsFromStorage = async () => [];
export const smartPlaylistSyncService = { startBackgroundReconciliation() {}, async syncTrack() {} };
export const storageService = { initialize: async () => ({ status: "ready" }) };
export const flushLocalPersistence = async () => {};
export const isLocalPersistencePaused = () => false;
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

const player = {
  data: { item: { uri: uris[0] } },
  addEventListener: (_name: string, listener: () => void) => songListeners.add(listener),
  removeEventListener: (_name: string, listener: () => void) => songListeners.delete(listener),
};
Object.assign(globalThis, { Spicetify: {
  Player: player,
  Platform: { History: { location: { pathname: "/playlist/example" }, listen() {}, push() {} } },
  ContextMenu: { Item: class { register() {} } }, showNotification: console.info,
} });
localStorage.setItem("tagify:extensionSettings", JSON.stringify({ tracklistDisplayMode: "stars", playbarDisplayMode: "stars" }));

function renderTracklist() {
  const grid = document.createElement("div");
  grid.className = legacy ? "main-trackList-indexable" : "ch63k01sHw xljhkx9cbmxKi0ds5o5e Kyg5ODGXtAjkKxfxWeNL";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-colcount", recommended ? "3" : "4");
  if (recommended) grid.style.setProperty("--grid-template-columns", "[first] minmax(180px,4fr) [var1] minmax(0,2fr) [last] 120px");
  const body = document.createElement("div");
  body.setAttribute("role", "presentation");
  const rows = recommended ? uris : [null, ...uris];
  rows.forEach((uri, index) => {
    const row = document.createElement("div");
    row.className = legacy || aliased
      ? uri ? "main-trackList-trackListRow vg-aliased vg-track-row" : "main-trackList-trackListHeaderRow"
      : "hashedSpotifyRow";
    row.setAttribute("role", "row");
    row.setAttribute("aria-selected", "false");
    if (uri) Object.assign(row, { __reactFiber$fixture: { memoizedProps: { uri } } });
    const columns = !legacy && uri ? document.createElement("div") : row;
    if (columns !== row) { columns.className = "bfY_tgYxTRckp8L2joiq"; columns.setAttribute("role", "presentation"); row.append(columns); }
    columns.style.cssText = recommended
      ? "display:grid;grid-template-columns:var(--grid-template-columns);min-height:56px"
      : "display:grid;grid-template-columns:16px 3fr 2fr minmax(120px,1fr);min-height:36px";
    const texts = recommended
      ? [`<div style="display:flex;gap:12px;align-items:center;min-width:0"><div style="flex-shrink:0;width:48px;height:48px;background:#645139">♫</div><div style="min-width:0"><a data-testid="internal-track-link" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" href="/track/example${index + 1}">${index ? "A much longer recommended song title with a remix version" : "Not A Lot Left"}</a><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Example artist</div></div></div>`, "Not A Lot Left / The Beach", "<button>Add</button>"]
      : [uri ? String(index) : "#", uri ? `<a href="/track/example${index}">Example song ${index}</a>` : "Title", uri ? "Example album" : "Album", uri ? "3:42" : "Duration"];
    texts.forEach((text, columnIndex) => {
      const cell = document.createElement("div");
      cell.setAttribute("role", uri ? "gridcell" : "columnheader");
      cell.setAttribute("aria-colindex", String(columnIndex + 1));
      if (legacy) cell.className = columnIndex === 3 ? "main-trackList-rowSectionEnd" : "main-trackList-rowSectionVariable";
      else cell.className = "hashedSpotifyCell";
      if (recommended) {
        cell.style.minWidth = "0";
        if (columnIndex === 0) cell.className = "main-trackList-rowSectionStart";
        if (columnIndex === 1) cell.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        if (columnIndex === texts.length - 1) cell.style.gridColumn = "last";
      }
      cell.innerHTML = text;
      columns.append(cell);
    });
    (uri ? body : grid).append(row);
  });
  grid.append(body);
  document.querySelector("main")!.replaceChildren(grid);
}

function renderPlayer() {
  const widget = document.createElement("div");
  widget.setAttribute("data-testid", "now-playing-widget");
  widget.setAttribute("role", "region");
  widget.className = legacy || aliased ? "main-nowPlayingWidget-nowPlaying vg-np-nowplaying" : "hashedPlayerWidget";
  widget.innerHTML = `<div data-testid="cover-art-button">♫</div><div class="${legacy ? "main-trackInfo-container" : "hashedTrackInfo"}"><a href="/track/example${currentSong + 1}">Example song ${currentSong + 1}</a><div>Example artist</div></div><button>Add to Liked Songs</button>`;
  document.querySelector("footer")!.replaceChildren(widget);
}

function status() {
  document.querySelector("#status")!.textContent = JSON.stringify({ layout, tracks, writes, playing: player.data.item.uri }, null, 2);
}
document.querySelector("#rerender")!.addEventListener("click", () => { renderTracklist(); renderPlayer(); });
document.querySelector("#mount")!.addEventListener("click", renderPlayer);
document.querySelector("#next")!.addEventListener("click", () => {
  currentSong = (currentSong + 1) % uris.length;
  player.data.item.uri = uris[currentSong];
  renderPlayer();
  songListeners.forEach(listener => listener());
  status();
});
document.querySelector("#toggle")!.addEventListener("click", () => {
  const settings = JSON.parse(localStorage.getItem("tagify:extensionSettings")!);
  const mode = settings.tracklistDisplayMode === "disabled" ? "stars" : "disabled";
  localStorage.setItem("tagify:extensionSettings", JSON.stringify({ tracklistDisplayMode: mode, playbarDisplayMode: mode }));
  window.dispatchEvent(new CustomEvent("tagify:settingsChanged"));
});
renderTracklist();
if (!params.has("latePlayer")) renderPlayer();
status();
void import("../../../src/extensions/extension");
