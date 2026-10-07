import type { TrackData } from "../../../src/types/tagData";

const params = new URLSearchParams(location.search);
const layout = params.get("layout") || "modern";
const legacy = layout === "legacy";
const aliased = layout === "aliased";
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
export const storageService = {
  initialize: async () => ({ status: "ready" }),
  async saveTrackChanges(changes: Map<string, TrackData | null>) {
    writes++;
    changes.forEach((track, uri) => {
      if (track) tracks[uri] = track;
      else delete tracks[uri];
    });
    localStorage.setItem("tagify:tagData", JSON.stringify({ tracks, categories: [] }));
    status();
    return true;
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
localStorage.setItem("tagify:tagData", JSON.stringify({ tracks, categories: [] }));
localStorage.setItem("tagify:extensionSettings", JSON.stringify({ tracklistDisplayMode: "stars", playbarDisplayMode: "stars" }));

function renderTracklist() {
  const grid = document.createElement("div");
  grid.className = legacy ? "main-trackList-indexable" : "ch63k01sHw xljhkx9cbmxKi0ds5o5e Kyg5ODGXtAjkKxfxWeNL";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-colcount", "4");
  const body = document.createElement("div");
  body.setAttribute("role", "presentation");
  const rows = [null, ...uris];
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
    columns.style.cssText = "display:grid;grid-template-columns:16px 3fr 2fr minmax(120px,1fr);min-height:36px";
    [uri ? String(index) : "#", uri ? `<a href="/track/example${index}">Example song ${index}</a>` : "Title", uri ? "Example album" : "Album", uri ? "3:42" : "Duration"].forEach((text, columnIndex) => {
      const cell = document.createElement("div");
      cell.setAttribute("role", uri ? "gridcell" : "columnheader");
      cell.setAttribute("aria-colindex", String(columnIndex + 1));
      if (legacy) cell.className = columnIndex === 3 ? "main-trackList-rowSectionEnd" : "main-trackList-rowSectionVariable";
      else cell.className = "hashedSpotifyCell";
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
