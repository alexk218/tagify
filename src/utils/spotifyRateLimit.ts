import { classifySpotifyFailure, spotifyRetryAfterSeconds, spotifyStatus } from "./spotifyRequestFailure";

/** Backoff is separate from classification: unknown 429s still need protection. */
export function getSpotifyRetryAfterMs(error: unknown): number | null {
  const value = error as { message?: unknown } | null;
  if (!value) return null;
  const failure = classifySpotifyFailure(error);
  if (failure?.kind === "unsupported-endpoint") return null;
  if (spotifyStatus(error) !== 429 && !/\b429\b|rate.?limit|too many requests/i.test(String(value.message ?? ""))) return null;
  const seconds = spotifyRetryAfterSeconds(error);
  if (seconds !== undefined) return Math.max(1000, seconds * 1000);
  // Quota reset time is unknown. Avoid retrying it every minute.
  return failure?.kind === "quota-exceeded" ? 60 * 60_000 : 60_000;
}
