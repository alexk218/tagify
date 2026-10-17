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
  /** Spotify's playlist version when the held contents were read, so unchanged playlists aren't downloaded again. */
  private versions = new Map<string, string>();
  constructor(
    private lookup = (uri: string, fresh = false, options?: RequestOptions) => spotifyApiService.getAllTrackUrisInPlaylistStrict(uri.split(":").pop()!, fresh ? 0 : 30_000, options),
    private probeVersion = (uri: string, options: RequestOptions) => spotifyApiService.getPlaylistVersion(uri.split(":").pop()!, options),
  ) { }
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
    const unchangedRevision = this.revisions.get(uri) === revision;
    this.revisions.set(uri, revision);
    this.attemptedAt.set(uri, Date.now());
    const requestOptions: RequestOptions = { ...options, priorityToken: { current: options?.priority ?? "foreground" } };
    this.pendingOptions.set(uri, requestOptions);
    const mayBeUnchanged = !force && unchangedRevision && current?.status === "loaded" && this.versions.has(uri);
    if (!mayBeUnchanged) this.publish(uri, { ...current, status: "loading" });
    const task = (async () => {
      // The version is requested before the contents, so an edit during the read leaves a newer version to catch next time.
      let version: string | null, uris: readonly string[];
      if (mayBeUnchanged) {
        version = await this.probeVersion(uri, requestOptions);
        if (version === this.versions.get(uri)) return;
        this.publish(uri, { ...current, status: "loading" });
        uris = await this.lookup(uri, true, requestOptions);
      } else {
        const probe = this.probeVersion(uri, requestOptions).catch(() => null);
        uris = await this.lookup(uri, force || !unchangedRevision, requestOptions);
        version = await probe;
      }
      if (version) this.versions.set(uri, version); else this.versions.delete(uri);
      const songs = uris.filter((uri) => uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:"));
      this.publish(uri, { status: "loaded", uris: [...new Set(songs)], listedTrackCount: songs.length, checkedAt: Date.now() });
    })().catch(() => {
      this.publish(uri, { ...current, status: "failed" });
    }).finally(() => { this.pending.delete(uri); this.pendingOptions.delete(uri); });
    this.pending.set(uri, task);
    return task;
  }
}
export const playlistMembershipStore = new PlaylistMembershipStore();
