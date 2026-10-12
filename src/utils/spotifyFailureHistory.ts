import { classifySpotifyFailure, spotifyEndpointLabel, spotifyStatus, spotifyRetryAfterSeconds } from "./spotifyRequestFailure";
import { requestFeature, type SpotifyRequestFeature } from "./spotifyRequestAccounting";

type FailureEntry = {
  at: string; lastAt: string; count: number; endpoint: string;
  feature: SpotifyRequestFeature; transport: string; credentialType: "desktop-session";
  dispatched: boolean; kind: string; status?: number; retryAfterSeconds?: number;
  reason?: "QUOTA_EXCEEDED"; evidence: "response-status" | "local-control" | "transport-error";
};
const LIMIT = 50, MAX_AGE = 7 * 24 * 60 * 60_000;
const features = new Set(["album-counts", "album-tracks", "metadata-backfill", "smart-playlists", "recording-matching", "audio-features", "artist-identities", "track-details", "playlist-contents", "playlist-details", "library", "other"]);
const kinds = new Set(["rate-limit", "quota-exceeded", "server-429", "local-pause", "unsupported-endpoint", "http-error", "transport-error", "cancelled"]);
const endpoint = (value: string) => {
  if (value.startsWith("GraphQL ") && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(value.slice(8))) return value;
  if (value === "Spotify SDK" || /^Desktop (PlaylistAPI|RootlistAPI|LibraryAPI)\.(getContents|getMetadata|getTracks|add|remove|createPlaylist)$/.test(value)) return value;
  const match = value.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD) (api\.spotify\.com|spclient\.wg\.spotify\.com)(\/[^?]*)$/);
  return match ? spotifyEndpointLabel(`https://${match[2]}${match[3]}`, match[1]) : "Spotify SDK";
};

/** Local-only, bounded diagnostics. Never keep raw errors, headers, variables or account IDs in entries. */
export class SpotifyFailureHistory {
  private seen = new WeakSet<object>();
  private memory = new Map<string, FailureEntry[]>();
  constructor(private storage = () => globalThis.localStorage) {}
  private key(account: string) { return `tagify:spotify-failures:v1:${account}`; }
  read(account: string): FailureEntry[] {
    const key = this.key(account);
    let source: unknown = this.memory.get(key);
    if (!source) {
      try { const raw = this.storage().getItem(key); source = raw && raw.length <= 100_000 ? JSON.parse(raw) : []; } catch { source = []; }
    }
    // Reconstruct the allowed fields even for corrupted or old saved data.
    return (Array.isArray(source) ? source : []).slice(-LIMIT).flatMap(row => {
      if (!row || !Number.isFinite(Date.parse(row.at)) || !Number.isFinite(Date.parse(row.lastAt)) || Date.parse(row.lastAt) < Date.now() - MAX_AGE || Date.parse(row.lastAt) > Date.now() || !kinds.has(row.kind)) return [];
      return [{ at: new Date(row.at).toISOString(), lastAt: new Date(row.lastAt).toISOString(), count: Math.min(1_000_000, Math.max(1, Number(row.count) || 1)),
        endpoint: endpoint(String(row.endpoint)), feature: features.has(row.feature) ? row.feature : "other",
        transport: ["fetch", "graphql", "desktop"].includes(row.transport) ? row.transport : "desktop", credentialType: "desktop-session" as const,
        dispatched: row.dispatched === true, kind: row.kind,
        ...(Number.isInteger(row.status) && row.status >= 400 && row.status <= 599 ? { status: row.status } : {}),
        ...(Number.isFinite(row.retryAfterSeconds) && row.retryAfterSeconds >= 0 ? { retryAfterSeconds: row.retryAfterSeconds } : {}),
        ...(row.kind === "quota-exceeded" ? { reason: "QUOTA_EXCEEDED" as const } : {}),
        evidence: row.dispatched === false ? "local-control" as const : row.status >= 400 ? "response-status" as const : "transport-error" as const,
      }];
    });
  }
  record(account: string, key: string, error: unknown, feature = requestFeature(key), transport = "desktop", dispatched = true, source?: unknown): void {
    if (error && typeof error === "object") {
      if (this.seen.has(error)) return;
      if (source && typeof source === "object" && this.seen.has(source)) { this.seen.add(error); return; }
      this.seen.add(error);
      if (source && typeof source === "object") this.seen.add(source);
    }
    const failure = classifySpotifyFailure(error), status = failure?.kind === "local-pause" ? NaN : spotifyStatus(error);
    const kind = failure?.kind ?? ((error as { name?: string })?.name === "AbortError" ? "cancelled" : status >= 400 ? "http-error" : "transport-error");
    if (kind === "cancelled") return;
    const now = new Date().toISOString(), entries = this.read(account);
    const row: FailureEntry = { at: now, lastAt: now, count: 1, endpoint: failure?.endpoint ? endpoint(failure.endpoint) : spotifyEndpointLabel(key, key.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD) /)?.[1] ?? "GET"), feature, transport, credentialType: "desktop-session",
      dispatched: failure?.dispatched ?? dispatched, kind,
      ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}),
      ...(spotifyRetryAfterSeconds(error) !== undefined ? { retryAfterSeconds: spotifyRetryAfterSeconds(error) } : {}),
      ...(kind === "quota-exceeded" ? { reason: "QUOTA_EXCEEDED" } : {}),
      evidence: failure?.dispatched === false || !dispatched ? "local-control" : status >= 400 ? "response-status" : "transport-error",
    };
    const last = entries.at(-1);
    // Local blocked checks must not evict the actual response that caused the pause.
    if (!row.dispatched) {
      const prior = entries.findLast(entry => !entry.dispatched && entry.endpoint === row.endpoint && entry.kind === row.kind);
      if (prior) { prior.lastAt = now; prior.count++; prior.retryAfterSeconds = row.retryAfterSeconds; }
      else entries.push(row);
    } else if (last && last.kind === row.kind && last.endpoint === row.endpoint && last.lastAt === now) last.count++;
    else entries.push(row);
    const bounded = entries.slice(-LIMIT);
    this.memory.set(this.key(account), bounded);
    while (this.memory.size > 4) this.memory.delete(this.memory.keys().next().value!);
    try { this.storage().setItem(this.key(account), JSON.stringify(bounded)); } catch { /* Diagnostics never block tagging. */ }
  }
}
const shared = globalThis as typeof globalThis & { __tagifyFailureHistoryV1?: SpotifyFailureHistory };
export const spotifyFailureHistory = shared.__tagifyFailureHistoryV1 ??= new SpotifyFailureHistory();
