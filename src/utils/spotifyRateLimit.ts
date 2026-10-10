/** Spotify's desktop client exposes different error shapes across versions. */
export function getSpotifyRetryAfterMs(error: unknown): number | null {
  const value = error as { status?: unknown; statusCode?: unknown; message?: unknown; retryAfter?: unknown; retryAfterSeconds?: unknown;
    headers?: Headers | Record<string, string>; response?: { status?: unknown; headers?: Headers | Record<string, string> }; extensions?: { status?: unknown; http?: { status?: unknown; headers?: Headers | Record<string, string> } } } | null;
  if (!value) return null;
  const status = Number(value.status ?? value.statusCode ?? value.response?.status ?? value.extensions?.status ?? value.extensions?.http?.status);
  if (status !== 429 && !/\b429\b|rate.?limit|too many requests/i.test(String(value.message ?? ""))) return null;
  const headers = value.headers ?? value.response?.headers ?? value.extensions?.http?.headers;
  const header = headers && (typeof (headers as Headers).get === "function"
    ? (headers as Headers).get("Retry-After") : (headers as Record<string, string>)["retry-after"] ?? (headers as Record<string, string>)["Retry-After"]);
  const raw = value.retryAfterSeconds ?? value.retryAfter ?? header;
  const seconds = raw == null ? NaN : Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, seconds * 1_000);
  const date = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 60_000;
}
