import type { SpotifyFailureKind } from "./spotifyRequestFailure";
export type SpotifyRequestFeature = "album-counts" | "album-tracks" | "metadata-backfill" | "smart-playlists" | "recording-matching" | "audio-features" | "artist-identities" | "track-details" | "playlist-contents" | "playlist-details" | "library" | "other";
export type RequestEvent = "requested" | "dispatched" | "shared" | "cached" | "succeeded" | "failed" | "stopped" | "cancelled" | "timedOut" | "repeated";
type Counts = Partial<Record<RequestEvent, number>>;

/** Local aggregate diagnostics only: never retain URLs, tokens, song IDs or error bodies. */
export class SpotifyRequestAccounting {
  private counts: Record<string, Counts> = {};
  private recent = new Map<number, number>();
  private failures: Partial<Record<SpotifyFailureKind, number>> = {};
  recordFailure(kind: SpotifyFailureKind): void { this.failures[kind] = (this.failures[kind] ?? 0) + 1; }
  private startedAt = Date.now();
  record(feature: SpotifyRequestFeature, event: RequestEvent, transport = "cache", key?: string): void {
    const group = `${feature}:${transport}`;
    const counts = this.counts[group] ??= {};
    counts[event] = (counts[event] ?? 0) + 1;
    if (event === "dispatched" && key) {
      const hash = requestFingerprint(key), now = Date.now();
      if (now - (this.recent.get(hash) ?? -Infinity) < 60_000) counts.repeated = (counts.repeated ?? 0) + 1;
      this.recent.delete(hash); this.recent.set(hash, now);
      while (this.recent.size > 256) this.recent.delete(this.recent.keys().next().value!);
    }
  }
  snapshot() { return { failures: { ...this.failures }, startedAt: this.startedAt, byFeature: Object.fromEntries(Object.entries(this.counts).map(([key, value]) => [key, { ...value }])), recentKeys: this.recent.size }; }
  reset() { this.failures = {}; this.counts = {}; this.recent.clear(); this.startedAt = Date.now(); }
}
export function requestFingerprint(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return hash >>> 0;
}
const shared = globalThis as typeof globalThis & { __tagifyRequestAccountingV1?: SpotifyRequestAccounting };
export const spotifyRequestAccounting = shared.__tagifyRequestAccountingV1 ??= new SpotifyRequestAccounting();

export function requestFeature(key: string): SpotifyRequestFeature {
  if (/audio|analysis|extended-metadata/i.test(key)) return "audio-features";
  if (/metadata\/4\/track/i.test(key)) return "recording-matching";
  if (/album/i.test(key)) return "album-tracks";
  if (/artist/i.test(key)) return "artist-identities";
  if (/playlist/i.test(key)) return /getMetadata|\/playlists\/[^/?]+(?:$|\?)/.test(key) ? "playlist-details" : "playlist-contents";
  if (/library|\/me\//i.test(key)) return "library";
  if (/track/i.test(key)) return "track-details";
  return "other";
}
