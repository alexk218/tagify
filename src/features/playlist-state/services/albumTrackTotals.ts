import { spotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";
import { spotifyRequestAccounting } from "@/utils/spotifyRequestAccounting";
import { throwIfSpotifyRequestStopped } from "@/services/SpotifyRequests";
import { spotifyApiService } from "@/services/SpotifyApiService";

export const ALBUM_TRACK_TOTALS_STORAGE_KEY = "tagify:albumTrackTotals:v1";
const ALBUMS_PER_LOOKUP = 20;
const PAUSE_BETWEEN_LOOKUPS_MS = 400;
// Optional counts get a small hourly allowance, including retries. Foreground
// album details can still supply counts while this work is deferred.
const LOOKUP_WINDOW_MS = 60 * 60_000;
const SINGLE_LOOKUPS_PER_WINDOW = 150;

export type AlbumTrackTotals = Readonly<Record<string, number>>;

interface AlbumTrackTotalsDependencies {
  lookupTotals: (albumUris: string[]) => Promise<Map<string, number> | null>;
  lookupSingleTotal: (albumUri: string) => Promise<number | null>;
  pause: (milliseconds: number) => Promise<void>;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

function isTrackTotal(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function readStoredTotals(
  storage: AlbumTrackTotalsDependencies["storage"],
): Record<string, number> {
  try {
    const parsed = JSON.parse(storage?.getItem(ALBUM_TRACK_TOTALS_STORAGE_KEY) || "{}");
    return Object.fromEntries(
      Object.entries(parsed && typeof parsed === "object" ? parsed : {}).filter(
        ([albumUri, total]) => albumUri.startsWith("spotify:album:") && isTrackTotal(total),
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Remembers how many tracks each album has, so album progress can be shown
 * without asking Spotify again. Album lengths are public facts, so they stay
 * on this device and are not part of the user's library or backups.
 */
export class AlbumTrackTotalsStore {
  private totals: AlbumTrackTotals | null = null;
  private listeners = new Set<() => void>();
  private queue: string[] = [];
  private trackLists = new Map<string, Promise<unknown>>();
  private requested = new Set<string>();
  private isLookingUp = false;
  private canLookUpInBatches = true;
  private singleLookupsLeft = SINGLE_LOOKUPS_PER_WINDOW;
  private batchLookupsLeft = 10;
  private lookupWindowStartedAt = Date.now();
  private deferred = new Map<string, number>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly dependencies: AlbumTrackTotalsDependencies) {}

  getSnapshot = (): AlbumTrackTotals => {
    this.totals ??= readStoredTotals(this.dependencies.storage);
    return this.totals;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  remember(found: Map<string, number> | Record<string, number>): void {
    const current = this.getSnapshot();
    const changes = (found instanceof Map ? Array.from(found) : Object.entries(found)).filter(
      ([albumUri, total]) => isTrackTotal(total) && current[albumUri] !== total,
    );
    if (changes.length === 0) {
      return;
    }

    this.totals = { ...current, ...Object.fromEntries(changes) };
    try {
      this.dependencies.storage?.setItem(
        ALBUM_TRACK_TOTALS_STORAGE_KEY,
        JSON.stringify(this.totals),
      );
    } catch {
      // Lengths stay available for this session when local storage is full.
    }
    this.listeners.forEach((listener) => listener());
  }

  waitForTrackList(uri: string, task: Promise<readonly unknown[] | null>): void {
    const settled = task.then(tracks => { if (tracks?.length) this.remember({ [uri]: tracks.length }); }, () => {}).finally(() => {
      if (this.trackLists.get(uri) === settled) this.trackLists.delete(uri);
    });
    this.trackLists.set(uri, settled);
  }

  /**
   * Looks up albums whose length is unknown, a few at a time. Albums passed in
   * a later call move to the front, so whatever is on screen is answered first.
   */
  request(albumUris: string[]): void {
    const totals = this.getSnapshot();
    const queued = new Set(this.queue);
    const prioritized = new Set<string>();
    albumUris.forEach((albumUri) => {
      if (!albumUri.startsWith("spotify:album:") || totals[albumUri] !== undefined) {
        return;
      }
      if (!this.requested.has(albumUri)) {
        this.requested.add(albumUri);
        prioritized.add(albumUri);
      } else if (queued.has(albumUri)) {
        prioritized.add(albumUri);
      }
    });

    if (prioritized.size > 0) {
      this.queue = [
        ...prioritized,
        ...this.queue.filter((albumUri) => !prioritized.has(albumUri)),
      ];
    }

    if (!this.isLookingUp && this.queue.length > 0) {
      this.isLookingUp = true;
      // Let mounted tracklists register before optional count work dispatches.
      void Promise.resolve().then(() => this.lookUpQueuedAlbums());
    }
  }

  private async lookUpQueuedAlbums(): Promise<void> {
    this.isLookingUp = true;
    let candidates: string[] = [];
    try {
      while (this.queue.length > 0) {
        if (Date.now() < this.lookupWindowStartedAt || Date.now() - this.lookupWindowStartedAt >= LOOKUP_WINDOW_MS) {
          this.lookupWindowStartedAt = Date.now();
          this.singleLookupsLeft = SINGLE_LOOKUPS_PER_WINDOW;
          this.batchLookupsLeft = 10;
        }
        if (this.canLookUpInBatches ? this.batchLookupsLeft <= 0 : this.singleLookupsLeft <= 0) {
          this.defer(this.queue.splice(0), this.lookupWindowStartedAt + LOOKUP_WINDOW_MS);
          break;
        }

        candidates = this.queue.splice(0, ALBUMS_PER_LOOKUP);
        await Promise.all(candidates.flatMap(uri => this.trackLists.has(uri) ? [this.trackLists.get(uri)!] : []));
        const albumUris = candidates.filter(uri => {
          if (this.getSnapshot()[uri] !== undefined) { spotifyRequestAccounting.record("album-counts", "cached"); return false; }
          if (spotifyBackgroundPolicy.reserve("album-counts", uri, 200)) return true;
          this.defer([uri]);
          return false;
        });
        if (!albumUris.length) continue;
        if (this.canLookUpInBatches) this.batchLookupsLeft--;
        const found = this.canLookUpInBatches
          ? await this.dependencies.lookupTotals(albumUris).catch(error => { throwIfSpotifyRequestStopped(error); return null; })
          : null;

        if (found) {
          this.remember(found);
        } else {
          this.canLookUpInBatches = false;
          await this.lookUpOneByOne(albumUris);
        }
        candidates = [];

        if (this.queue.length > 0) {
          await this.dependencies.pause(PAUSE_BETWEEN_LOOKUPS_MS);
        }
      }
    } catch (error) {
      this.defer([...candidates, ...this.queue.splice(0)]);
      console.warn("Album counts paused", error);
    } finally {
      this.isLookingUp = false;
      this.scheduleRetry();
    }
  }

  private defer(uris: string[], earliest = Date.now() + 60_000): void {
    for (const uri of uris) {
      if (this.getSnapshot()[uri] !== undefined) continue;
      this.deferred.set(uri, Math.max(earliest, spotifyBackgroundPolicy.reservationRetryAt("album-counts", uri, 200)));
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    let next = Infinity;
    for (const [uri, at] of this.deferred) {
      if (this.getSnapshot()[uri] !== undefined) this.deferred.delete(uri);
      else next = Math.min(next, at);
    }
    if (!Number.isFinite(next)) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      for (const [uri, at] of this.deferred) {
        if (at <= Date.now()) { this.deferred.delete(uri); this.queue.push(uri); }
      }
      this.request([]);
      if (!this.isLookingUp) this.scheduleRetry();
    }, Math.max(1, next - Date.now()));
  }

  private async lookUpOneByOne(albumUris: string[]): Promise<void> {
    for (const albumUri of albumUris) {
      if (this.singleLookupsLeft <= 0) {
        this.defer(albumUris.slice(albumUris.indexOf(albumUri)), this.lookupWindowStartedAt + LOOKUP_WINDOW_MS);
        return;
      }

      if (this.trackLists.has(albumUri)) await this.trackLists.get(albumUri);
      if (this.getSnapshot()[albumUri] !== undefined) continue;
      this.singleLookupsLeft -= 1;
      const total = await this.dependencies.lookupSingleTotal(albumUri).catch(error => { throwIfSpotifyRequestStopped(error); return null; });
      if (isTrackTotal(total)) {
        this.remember({ [albumUri]: total });
      }
      await this.dependencies.pause(PAUSE_BETWEEN_LOOKUPS_MS);
    }
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const albumTrackTotalsStore = new AlbumTrackTotalsStore({
  lookupTotals: (albumUris) => spotifyApiService.getAlbumTrackTotals(albumUris, { priority: "background", feature: "album-counts" }),
  lookupSingleTotal: (albumUri) => spotifyApiService.getAlbumTrackTotal(albumUri, { priority: "background", feature: "album-counts" }),
  pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  storage: getLocalStorage(),
});
