import { spotifyApiService } from "@/services/SpotifyApiService";

export const ALBUM_TRACK_TOTALS_STORAGE_KEY = "tagify:albumTrackTotals:v1";
const ALBUMS_PER_LOOKUP = 20;
const PAUSE_BETWEEN_LOOKUPS_MS = 400;
// Spotify throttles the batch lookup for some accounts; its own client API then
// answers one album at a time, and the rest wait for the next session.
const SINGLE_LOOKUPS_PER_SESSION = 150;

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
  private requested = new Set<string>();
  private isLookingUp = false;
  private canLookUpInBatches = true;
  private singleLookupsLeft = SINGLE_LOOKUPS_PER_SESSION;

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
      void this.lookUpQueuedAlbums();
    }
  }

  private async lookUpQueuedAlbums(): Promise<void> {
    this.isLookingUp = true;
    try {
      while (this.queue.length > 0) {
        if (!this.canLookUpInBatches && this.singleLookupsLeft <= 0) {
          // The rest wait for the next session instead of flooding Spotify.
          this.queue = [];
          break;
        }

        const albumUris = this.queue.splice(0, ALBUMS_PER_LOOKUP);
        const found = this.canLookUpInBatches
          ? await this.dependencies.lookupTotals(albumUris).catch(() => null)
          : null;

        if (found) {
          this.remember(found);
        } else {
          this.canLookUpInBatches = false;
          await this.lookUpOneByOne(albumUris);
        }

        if (this.queue.length > 0) {
          await this.dependencies.pause(PAUSE_BETWEEN_LOOKUPS_MS);
        }
      }
    } finally {
      this.isLookingUp = false;
    }
  }

  private async lookUpOneByOne(albumUris: string[]): Promise<void> {
    for (const albumUri of albumUris) {
      if (this.singleLookupsLeft <= 0) {
        return;
      }

      this.singleLookupsLeft -= 1;
      const total = await this.dependencies.lookupSingleTotal(albumUri).catch(() => null);
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
  lookupTotals: (albumUris) => spotifyApiService.getAlbumTrackTotals(albumUris),
  lookupSingleTotal: (albumUri) => spotifyApiService.getAlbumTrackTotal(albumUri),
  pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  storage: getLocalStorage(),
});
