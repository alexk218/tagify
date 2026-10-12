// Real extension + IndexedDB. Only Spotify identity responses and unrelated
// startup integrations are isolated. Open with spotify-layout.mjs PORT recordings.
import { indexedDBStorage } from "../../../src/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "../../../src/services/SpotifyApiService";
import { defaultTagData } from "../../../src/constants/defaultTagData";

export const keyboardShortcutService = { initialize() {} };
export const restoreDesktopSyncConfiguration = async () => {};
export const syncRuntime = { start() {} };
export const welcomeModal = { initialize() {} };
export const loadSmartPlaylistsFromStorage = async () => [];
export const smartPlaylistSyncService = { startBackgroundReconciliation() {}, async syncTrack() {} };
const ids = ["0FM31M7JGTYVgwcXJRZyTi", "7vuklW2wWZysUHbQigchbX", "39vBNPpuGv5U6MlNMa346j"];
const codes = ["US2641219402", "US2641005202", "US2641299902"];
const uris = ids.map(id => `spotify:track:${id}`);
const name = "Altering the Future";
const allReleases = new URLSearchParams(location.search).has("all");
const rock = Object.values(defaultTagData.taxonomy.tagsById).find(tag => tag.name === "Rock")!.id;
const identity = (i: number) => ({ isrc: codes[i], artistIds: ["4f5V3PQ66nIrBCqugJtaGn"], durationMs: 334440, name });
let visible = 1, requests = 0;
const player = { data: null, addEventListener() {}, removeEventListener() {} };
Object.assign(window, { Spicetify: { Player: player, Platform: { History: { location: { pathname: "/playlist/isolated" }, listen() {}, push() {} } }, ContextMenu: { Item: class { register() {} } }, showNotification: console.info } });
localStorage.setItem("tagify:sync:account-id", allReleases ? "isolated-playlist-all-releases" : "isolated-playlist-recordings");
localStorage.setItem("tagify:idb-migration-status", JSON.stringify({ status: "completed" }));
localStorage.setItem("tagify:extensionSettings", JSON.stringify({ tracklistDisplayMode: "combined", playbarDisplayMode: "disabled" }));
spotifyApiService.getRecordingIdentity = async uri => { requests++; await status(); return identity(uris.indexOf(uri)); };
async function status() {
  document.querySelector("#status")!.textContent = JSON.stringify({ requests, tracks: (await indexedDBStorage.loadAllStrict()).tracks }, null, 2);
}
function render() {
  const visibleReleases = allReleases ? [0, 1, 2] : [visible];
  const rows = visibleReleases.map(index => `<div role="row" aria-selected="false" data-release="${index}"><div role="presentation" style="display:grid;grid-template-columns:16px 3fr 1fr;min-height:36px"><div role="gridcell" aria-colindex="1">${index + 1}</div><div role="gridcell" aria-colindex="2"><a href="/track/${ids[index]}">${name}</a><div>Death · Release ${index + 1}</div></div><div role="gridcell" aria-colindex="3">5:34</div></div></div>`).join("");
  document.querySelector("main")!.innerHTML = `<div role="grid" aria-colcount="3"><div role="row" style="display:grid;grid-template-columns:16px 3fr 1fr"><div role="columnheader" aria-colindex="1">#</div><div role="columnheader" aria-colindex="2">Title</div><div role="columnheader" aria-colindex="3">Duration</div></div><div role="presentation">${rows}</div></div>`;
  document.querySelectorAll<HTMLElement>('[data-release]').forEach(row => Object.assign(row, { __reactFiber$fixture: { memoizedProps: { uri: uris[Number(row.dataset.release)] } } }));
}

document.querySelector("h1")!.textContent = "Playlist release matching";
document.querySelector("nav")!.remove();
document.querySelector("footer")!.remove();
document.querySelector("#toggle")!.remove(); document.querySelector("#mount")!.remove();
document.querySelector("#next")!.textContent = "Next release";
document.querySelector("#next")!.addEventListener("click", () => { visible = (visible + 1) % 3; render(); });
document.querySelector("#rerender")!.addEventListener("click", render);
window.addEventListener("tagify:trackChanged", () => { void status(); });
void (async () => {
  await indexedDBStorage.init();
  if (!(await indexedDBStorage.getTrack(uris[0]))) await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { [uris[0]]: { name, artists: "Death", rating: 3, energy: 7, bpm: null, tagIds: [rock], dateCreated: 10, dateModified: 20, recordingIdentity: identity(0) } } });
  render(); await status();
  // @ts-expect-error -- production extension is a plain script
  await import("../../../src/extensions/extension.js");
})();
