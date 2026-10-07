import { SmartPlaylistSyncService } from "../../../src/services/SmartPlaylistSyncService";

const tracks = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [
  `spotify:track:${i}`, { rating: 5, energy: 5, bpm: 126, camelotKey: "8A", tagIds: [`tag-${i % 24}`] },
]));
let playlists = Array.from({ length: 24 }, (_, i) => ({
  playlistId: `playlist-${i}`, playlistName: `Playlist ${i}`, isActive: true,
  createdAt: 1, lastSyncAt: 1,
  criteria: { includeTagClauses: [{ tagIds: [`tag-${i}`], excludedTagIds: [], operator: "AND" }],
    clauseConnectors: [], ratingFilters: [], energyMinFilter: null, energyMaxFilter: null,
    bpmMinFilter: null, bpmMaxFilter: null },
  smartPlaylistTrackUris: Object.keys(tracks).filter((_, index) => index % 24 === i),
}));
const metrics = { passes: 0, playlistReads: 0, libraryReads: 0, playlistWrites: 0, updates: 0, elapsedWorkMs: 0 };
export const storageService = {
  isReady: () => true,
  loadAllStrict: async () => { metrics.libraryReads++; return structuredClone({ tracks, taxonomy: {} }); },
  getTracks: async () => new Map(), saveTracks: async () => true,
};
export const indexedDBStorage = {
  getAllSmartPlaylists: async () => structuredClone(playlists),
  saveSmartPlaylists: async (next: typeof playlists) => { metrics.playlistWrites++; playlists = structuredClone(next); return true; },
};
export const spotifyApiService = {
  getAllTrackUrisInPlaylistStrict: async (id: string) => {
    metrics.playlistReads++; return structuredClone(playlists.find(p => p.playlistId === id)!.smartPlaylistTrackUris);
  },
};
export const spotifyService = {};
export const flushLocalPersistence = async () => {};
export const isLocalPersistencePaused = () => false;
export const normalizeSmartPlaylistCriteriaList = (value: unknown) => value;

Object.assign(globalThis, { Spicetify: { Platform: { PlaylistAPI: {} }, showNotification() {} } });
window.addEventListener("tagify:smartPlaylistsUpdated", () => metrics.updates++);
const output = document.querySelector("#output")!;
async function run(hidden: boolean) {
  document.querySelectorAll("button").forEach(button => button.disabled = true);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
  localStorage.setItem("tagify:smartPlaylistMembershipBaselines:v1", JSON.stringify(playlists.map(p => `${p.playlistId}:${p.createdAt}`)));
  for (const key of Object.keys(metrics)) metrics[key as keyof typeof metrics] = 0;
  const service = new SmartPlaylistSyncService();
  const reconcile = service["reconcileNow"].bind(service);
  service["reconcileNow"] = async (...args) => {
    metrics.passes++;
    const start = performance.now();
    try { return await reconcile(...args); }
    finally { metrics.elapsedWorkMs += performance.now() - start; }
  };
  output.textContent = `Measuring ${hidden ? "hidden" : "visible"} idle behavior for 32 seconds…`;
  service.startBackgroundReconciliation();
  await new Promise(resolve => setTimeout(resolve, 32_000));
  service.stopBackgroundReconciliation();
  const result = { mode: hidden ? "hidden" : "visible", durationSeconds: 32, ...metrics,
    elapsedWorkMs: Math.round(metrics.elapsedWorkMs) };
  output.textContent = JSON.stringify(result, null, 2);
  await fetch("/results", { method: "POST", body: JSON.stringify(result) });
  document.querySelectorAll("button").forEach(button => button.disabled = false);
}
document.querySelector("#hidden")!.addEventListener("click", () => void run(true));
document.querySelector("#visible")!.addEventListener("click", () => void run(false));
