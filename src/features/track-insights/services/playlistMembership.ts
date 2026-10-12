import type { RequestOptions } from "@/utils/RateLimiter";
import { promoteSpotifyRequest } from "@/services/SpotifyRequests";
import { spotifyApiService } from "@/services/SpotifyApiService";

export interface PlaylistMembership {
  status: "loading" | "loaded" | "failed";
  uris?: readonly string[];
  listedTrackCount?: number;
  checkedAt?: number;
}
const REFRESH_MS = 5 * 60_000;

/** Private playlist contents stay in memory and are never added to backups or sync. */
export class PlaylistMembershipStore {
  private snapshot: Readonly<Record<string, PlaylistMembership>> = {};
  private pending = new Map<string, Promise<void>>();
  private pendingOptions = new Map<string, RequestOptions>();
  private listeners = new Set<() => void>();
  private attemptedAt = new Map<string, number>();
  private revisions = new Map<string, string>();
  constructor(private lookup = (uri: string, fresh = false, options?: RequestOptions) => spotifyApiService.getAllTrackUrisInPlaylistStrict(uri.split(":").pop()!, fresh ? 0 : 30_000, options)) { }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(uri: string, state: PlaylistMembership): void {
    this.snapshot = { ...this.snapshot, [uri]: state };
    this.listeners.forEach((listener) => listener());
  }
  request(uri: string, revision = "", force = false, options?: RequestOptions): Promise<void> {
    const pending = this.pending.get(uri);
    if (pending) {
      if (force || options?.priority !== "background") promoteSpotifyRequest(this.pendingOptions.get(uri));
      // A playlist can change while its previous contents are still loading.
      if (force || this.revisions.get(uri) !== revision) {
        return pending.then(() => this.request(uri, revision, force, options));
      }
      return pending;
    }
    const current = this.snapshot[uri];
    if (!force && current && Date.now() - (this.attemptedAt.get(uri) ?? 0) < REFRESH_MS && this.revisions.get(uri) === revision) return Promise.resolve();
    const fresh = force || this.revisions.get(uri) !== revision;
    this.revisions.set(uri, revision);
    this.attemptedAt.set(uri, Date.now());
    this.publish(uri, { ...current, status: "loading" });
    const requestOptions: RequestOptions = { ...options, priorityToken: { current: options?.priority ?? "foreground" } };
    this.pendingOptions.set(uri, requestOptions);
    const task = this.lookup(uri, fresh, requestOptions).then((uris) => {
      const songs = uris.filter((uri) => uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:"));
      this.publish(uri, { status: "loaded", uris: [...new Set(songs)], listedTrackCount: songs.length, checkedAt: Date.now() });
    }).catch(() => {
      this.publish(uri, { ...current, status: "failed" });
    }).finally(() => { this.pending.delete(uri); this.pendingOptions.delete(uri); });
    this.pending.set(uri, task);
    return task;
  }
}
export const playlistMembershipStore = new PlaylistMembershipStore();
