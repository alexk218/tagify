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
  private generation = 0;
  constructor(private lookup = (uri: string) => spotifyApiService.getAlbumTracks(uri)) { }
  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(uri: string, state: AlbumTracksState): void {
    this.snapshot = { ...this.snapshot, [uri]: state };
    this.listeners.forEach((listener) => listener());
  }
  request(uri: string, retry = false): Promise<void> {
    if (!uri.startsWith("spotify:album:")) return Promise.resolve();
    const pending = this.pending.get(uri);
    if (pending) return pending;
    if (this.snapshot[uri] && !retry) return Promise.resolve();
    this.publish(uri, EMPTY);
    const generation = this.generation;
    const request = this.lookup(uri).then((tracks) => {
      if (generation !== this.generation) return;
      trackArtistIdentitiesStore.rememberMany((tracks ?? []).map((track) => [track.uri, track.artistsData ?? []] as const));
      this.publish(uri, tracks?.length ? { status: "loaded", tracks } : { status: "failed", tracks: [] });
    }).catch(() => {
      if (generation !== this.generation) return;
      this.publish(uri, { status: "failed", tracks: [] });
    }).finally(() => { if (generation === this.generation) this.pending.delete(uri); });
    this.pending.set(uri, request);
    return request;
  }
  clear(): void {
    this.generation += 1;
    this.pending.clear();
    this.snapshot = {};
    this.listeners.forEach((listener) => listener());
  }
}
export const albumTrackListsStore = new AlbumTrackListsStore();
export const EMPTY_ALBUM_TRACKS = EMPTY;
