import { getSpotifyRetryAfterMs } from "@/utils/spotifyRateLimit";

export type TrackArtist = { uri: string; name: string; };
interface CachedArtists { artists: TrackArtist[]; checkedAt: number; }
export const AUTOMATIC_ARTIST_CHECK_LIMIT = 50;
export const MANUAL_ARTIST_CHECK_LIMIT = 250;
const STORAGE_KEY = "tagify:trackArtistIdentities:v1";
const PAUSE_KEY = "tagify:trackArtistIdentities:pauseUntil";
const REQUEST_INTERVAL_MS = 1_000;
const FAILURE_PAUSE_MS = 60_000;

function validArtists(value: unknown): TrackArtist[] {
  return Array.isArray(value) ? value.filter((artist): artist is TrackArtist =>
    typeof artist?.uri === "string" && artist.uri.startsWith("spotify:artist:") && typeof artist.name === "string") : [];
}

/** Public identities only. Enrichment never writes annotations or track timestamps. */
export class TrackArtistIdentitiesStore {
  private snapshot: Readonly<Record<string, CachedArtists>> | null = null;
  private pending = new Map<string, Promise<boolean>>();
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private notifyTimer: ReturnType<typeof setTimeout> | undefined;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private activeCheck: Promise<void> | undefined;
  private automaticRemaining = AUTOMATIC_ARTIST_CHECK_LIMIT;
  private nextRequestAt = 0;
  private failed = new Set<string>();
  private checkState = { isChecking: false, blockedUntil: 0 };
  constructor(
    // Lazy import keeps the cache usable from every Spotify metadata response.
    private lookup = async (uri: string) => (await import("@/services/SpotifyService")).spotifyService.getTrackArtists(uri),
    private storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
  ) {
    try {
      const until = Number(this.storage?.getItem(PAUSE_KEY));
      if (Number.isFinite(until) && until > Date.now()) this.pauseUntil(until);
    } catch { /* A missing cache never blocks the app. */ }
  }
  getSnapshot = (): Readonly<Record<string, CachedArtists>> => {
    if (!this.snapshot) {
      this.snapshot = {};
      try {
        const data = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? "{}");
        this.snapshot = Object.fromEntries(Object.entries(data).flatMap(([uri, value]) => {
          const record = value as CachedArtists;
          const artists = validArtists(record?.artists);
          // Artist identities are stable. Normal metadata reads refresh them without a timed rescan.
          return uri.startsWith("spotify:track:") && artists.length && Number.isFinite(record?.checkedAt)
            ? [[uri, { artists, checkedAt: record.checkedAt }]] : [];
        }));
      } catch { /* Malformed or unavailable device cache is safe to rebuild. */ }
    }
    return this.snapshot;
  };
  getCheckState = () => this.checkState;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish = () => {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = undefined;
    this.listeners.forEach((listener) => listener());
  };
  private pauseUntil(until: number) {
    this.checkState = { ...this.checkState, blockedUntil: until };
    try { this.storage?.setItem(PAUSE_KEY, String(until)); } catch { /* Session protection still applies. */ }
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.checkState = { ...this.checkState, blockedUntil: 0 };
      this.publish();
    }, Math.min(until - Date.now(), 2_147_483_647));
    this.publish();
  }
  remember(uri: string, artists: TrackArtist[]): void { this.rememberMany([[uri, artists]]); }
  rememberMany(entries: Iterable<readonly [string, TrackArtist[]]>): void {
    const updates = Object.fromEntries(Array.from(entries).flatMap(([uri, artists]) => {
      const valid = validArtists(artists);
      return uri.startsWith("spotify:track:") && valid.length
        ? [[uri, { artists: valid, checkedAt: Date.now() }]] : [];
    }));
    if (!Object.keys(updates).length) return;
    this.snapshot = { ...this.getSnapshot(), ...updates };
    if (this.storage && !this.saveTimer) this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      try {
        const newest = Object.entries(this.getSnapshot()).sort(([, left], [, right]) => right.checkedAt - left.checkedAt).slice(0, 50_000);
        this.storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(newest)));
      } catch { /* Continue with the session cache when storage is full. */ }
    }, 1_000);
    // Metadata arriving in a burst should cause one library summary update.
    if (!this.notifyTimer) this.notifyTimer = setTimeout(this.publish, 250);
  }
  request(uri: string): Promise<boolean> {
    if (!uri.startsWith("spotify:track:")) return Promise.resolve(false);
    if (this.getSnapshot()[uri]) return Promise.resolve(true);
    const pending = this.pending.get(uri);
    if (pending) return pending;
    if (Date.now() < this.checkState.blockedUntil) return Promise.resolve(false);
    const task = this.lookup(uri).then((artists) => {
      if (!validArtists(artists).length) {
        this.failed.add(uri);
        this.pauseUntil(Date.now() + FAILURE_PAUSE_MS);
        return false;
      }
      this.failed.delete(uri);
      this.remember(uri, artists);
      return true;
    }).catch((error) => {
      this.failed.add(uri);
      this.pauseUntil(Date.now() + Math.max(FAILURE_PAUSE_MS, getSpotifyRetryAfterMs(error) ?? 0));
      return false;
    }).finally(() => { this.pending.delete(uri); });
    this.pending.set(uri, task);
    return task;
  }
  async check(uris: readonly string[], options: { automatic?: boolean; shouldContinue?: () => boolean } = {}): Promise<void> {
    // One queue for all mounted views, including StrictMode remounts and manual checks.
    while (this.activeCheck) await this.activeCheck;
    const shouldContinue = options.shouldContinue ?? (() => true);
    if (!shouldContinue() || Date.now() < this.checkState.blockedUntil) return;
    const budget = options.automatic ? this.automaticRemaining : MANUAL_ARTIST_CHECK_LIMIT;
    if (!budget) return;
    const run = async () => {
      this.checkState = { ...this.checkState, isChecking: true };
      this.publish();
      let attempts = 0;
      try {
        // An unavailable song must not trap every subsequent check at the same first URI.
        const candidates = Array.from(new Set(uris)).sort((left, right) => Number(this.failed.has(left)) - Number(this.failed.has(right)));
        for (const uri of candidates) {
          if (!shouldContinue() || attempts >= budget || Date.now() < this.checkState.blockedUntil) break;
          if (!uri.startsWith("spotify:track:") || this.getSnapshot()[uri]) continue;
          const wait = this.nextRequestAt - Date.now();
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          if (!shouldContinue() || Date.now() < this.checkState.blockedUntil) break;
          if (this.getSnapshot()[uri]) continue;
          this.nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
          attempts += 1;
          if (options.automatic) this.automaticRemaining -= 1;
          if (!await this.request(uri)) break;
        }
      } finally {
        this.checkState = { ...this.checkState, isChecking: false };
        this.publish();
      }
    };
    const task = run();
    this.activeCheck = task;
    try { await task; } finally { if (this.activeCheck === task) this.activeCheck = undefined; }
  }
}
export const trackArtistIdentitiesStore = new TrackArtistIdentitiesStore();
