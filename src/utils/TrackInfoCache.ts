interface CachedTrackInfo {
  name: string;
  artists: string;
  artistsData: Array<{ name: string; uri: string }>;
  albumName: string;
  albumUri: string | null;
  duration_ms: number;
  release_date: string;
  cached_at: number;
}

interface TrackInfoCache {
  [trackUri: string]: CachedTrackInfo;
}

const CACHE_KEY = "tagify:trackInfoCache";
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

export class TrackInfoCacheManager {
  private static cachedData: TrackInfoCache | null = null;

  static getCache(): TrackInfoCache {
    if (!this.cachedData) {
      this.cachedData = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    }
    return this.cachedData || {};
  }

  static setTrackInfo(uri: string, info: CachedTrackInfo) {
    const cache = this.getCache();
    cache[uri] = { ...info, cached_at: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    this.cachedData = cache;
  }

  static getTrackInfo(uri: string): CachedTrackInfo | null {
    const cache = this.getCache();
    const cached = cache[uri];

    if (!cached) return null;

    // Check if cache is expired
    if (Date.now() - cached.cached_at > CACHE_DURATION) {
      this.removeTrackInfo(uri);
      return null;
    }

    return cached;
  }

  static removeTrackInfo(uri: string) {
    const cache = this.getCache();
    delete cache[uri];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  static getCachedUris(uris: string[]): { cached: string[]; missing: string[] } {
    const cache = this.getCache();
    const cached: string[] = [];
    const missing: string[] = [];

    uris.forEach((uri) => {
      if (cache[uri]) {
        cached.push(uri);
      } else {
        missing.push(uri);
      }
    });

    return { cached, missing };
  }

  static cleanupOrphanedEntries(currentTrackUris: string[]) {
    const cache = this.getCache();
    const cachedUris = Object.keys(cache);
    const currentUriSet = new Set(currentTrackUris);

    let removedCount = 0;
    cachedUris.forEach((uri) => {
      if (!currentUriSet.has(uri)) {
        delete cache[uri];
        removedCount++;
      }
    });

    if (removedCount > 0) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    }

    return removedCount;
  }

  static getCacheStats() {
    const cache = this.getCache();
    const entries = Object.keys(cache).length;
    const sizeEstimate = JSON.stringify(cache).length;
    return { entries, sizeEstimate };
  }
}
