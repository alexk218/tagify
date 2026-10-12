import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { spotifyRequestAccounting } from "@/utils/spotifyRequestAccounting";
import type { RequestOptions } from "@/utils/RateLimiter";
import { albumTrackTotalsStore } from "./albumTrackTotals";
import { spotifyAccountKey, promoteSpotifyRequest } from "@/services/SpotifyRequests";
import { trackArtistIdentitiesStore } from "@/services/trackArtistIdentities";
import { spotifyApiService, type SpotifyAlbumTrack } from "@/services/SpotifyApiService";

export interface AlbumTracksState {
  status: "loading" | "loaded" | "failed";
  tracks: SpotifyAlbumTrack[];
}
const EMPTY: AlbumTracksState = { status: "loading", tracks: [] };
type Snapshot = Readonly<Record<string, AlbumTracksState>>;

/** Session tracklists are shared by details, progress, and list statistics. */
export class AlbumTrackListsStore {
  private snapshot: Snapshot = {};
  private listeners = new Set<() => void>();
  private pending = new Map<string, Promise<void>>();
  private pendingOptions = new Map<string, RequestOptions>();
  private generation = 0;
  private cached = new Map<string, { at: number; tracks: SpotifyAlbumTrack[] }>();
  private cacheLoaded = false;
  private automaticLoads = 0;
  private cacheKey() { return `tagify:album-tracklists:v1:${spotifyAccountKey()}`; }
  private loadCache() {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const entries = JSON.parse(localStorage.getItem(this.cacheKey()) ?? "[]");
      if (!Array.isArray(entries)) return;
      for (const [uri, value] of entries.slice(-100)) {
        if (typeof uri === "string" && uri.startsWith("spotify:album:") && value && Date.now() - value.at < 7 * 86_400_000 &&
          Array.isArray(value.tracks) && value.tracks.length <= 200 && value.tracks.every((track: SpotifyAlbumTrack) => typeof track.uri === "string" && typeof track.name === "string")) this.cached.set(uri, value);
      }
    } catch { /* Discard damaged optional cache. */ }
  }
  private remember(uri: string, tracks: SpotifyAlbumTrack[]) {
    albumTrackTotalsStore.remember({ [uri]: tracks.length });
    if (tracks.length > 200) return;
    this.cached.delete(uri);
    this.cached.set(uri, { at: Date.now(), tracks });
    while (this.cached.size > 100) this.cached.delete(this.cached.keys().next().value!);
    try { localStorage.setItem(this.cacheKey(), JSON.stringify([...this.cached])); } catch { /* Session cache remains usable. */ }
  }
  constructor(private lookup = (uri: string, options?: RequestOptions) => spotifyApiService.getAlbumTracks(uri, options)) { }
  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(uri: string, state: AlbumTracksState): void {
    this.snapshot = { ...this.snapshot, [uri]: state };
    this.listeners.forEach((listener) => listener());
  }
  request(uri: string, retry = false, automatic = false): Promise<void> {
    if (!uri.startsWith("spotify:album:")) return Promise.resolve();
    const pending = this.pending.get(uri);
    if (pending) {
      spotifyRequestAccounting.record("album-tracks", "shared", "store");
      if (!automatic) promoteSpotifyRequest(this.pendingOptions.get(uri));
      return pending;
    }
    if (this.snapshot[uri] && !retry) return Promise.resolve();
    this.loadCache();
    const cached = this.cached.get(uri);
    if (!retry && cached && Date.now() - cached.at < 7 * 86_400_000) {
      spotifyRequestAccounting.record("album-tracks", "cached");
      trackArtistIdentitiesStore.rememberMany(cached.tracks.map(track => [track.uri, track.artistsData ?? []] as const));
      albumTrackTotalsStore.remember({ [uri]: cached.tracks.length });
      this.publish(uri, { status: "loaded", tracks: cached.tracks });
      return Promise.resolve();
    }
    if (automatic && (this.automaticLoads >= 100 || !spotifyBackgroundPolicy.reserve("album-tracks", uri, 100))) return Promise.resolve();
    if (automatic) this.automaticLoads++;
    this.publish(uri, EMPTY);
    const generation = this.generation;
    const options: RequestOptions = { feature: "album-tracks", priorityToken: { current: automatic ? "background" : "foreground" } };
    this.pendingOptions.set(uri, options);
    const lookup = this.lookup(uri, options);
    albumTrackTotalsStore.waitForTrackList(uri, lookup);
    const request = lookup.then((tracks) => {
      if (generation !== this.generation) return;
      trackArtistIdentitiesStore.rememberMany((tracks ?? []).map((track) => [track.uri, track.artistsData ?? []] as const));
      if (tracks?.length) this.remember(uri, tracks);
      this.publish(uri, tracks?.length ? { status: "loaded", tracks } : { status: "failed", tracks: [] });
    }).catch(() => {
      if (generation !== this.generation) return;
      this.publish(uri, { status: "failed", tracks: [] });
    }).finally(() => { if (generation === this.generation) { this.pending.delete(uri); this.pendingOptions.delete(uri); } });
    this.pending.set(uri, request);
    return request;
  }
  clear(): void {
    this.generation += 1;
    this.pending.clear(); this.pendingOptions.clear();
    this.snapshot = {};
    this.cached.clear(); this.cacheLoaded = false;
    this.listeners.forEach((listener) => listener());
  }
}
export const albumTrackListsStore = new AlbumTrackListsStore();
export const EMPTY_ALBUM_TRACKS = EMPTY;
