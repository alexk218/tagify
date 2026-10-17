import { getSpotifyRetryAfterMs } from "@/utils/spotifyRateLimit";

/** Why Tagify could not read a Smart Playlist from Spotify. */
export type SmartPlaylistCheckFailure =
  | { kind: "paused"; retryAt: number }
  | { kind: "notResponding" }
  | { kind: "failed" };

export function describeSmartPlaylistCheckFailure(error: unknown, now = Date.now()): SmartPlaylistCheckFailure {
  const retryMs = getSpotifyRetryAfterMs(error);
  if (retryMs !== null) return { kind: "paused", retryAt: now + retryMs };
  if ((error as { recoveryRequired?: boolean } | null)?.recoveryRequired) return { kind: "notResponding" };
  return { kind: "failed" };
}

/** A Spotify that stopped responding needs the user; a pause only needs time. */
export function mostActionableCheckFailure(failures: Iterable<SmartPlaylistCheckFailure | undefined>): SmartPlaylistCheckFailure | undefined {
  let chosen: SmartPlaylistCheckFailure | undefined;
  for (const failure of failures) {
    if (!failure || chosen?.kind === "notResponding") continue;
    if (failure.kind === "notResponding" || !chosen || chosen.kind === "failed" ||
      (failure.kind === "paused" && failure.retryAt > chosen.retryAt)) chosen = failure;
  }
  return chosen;
}

export function formatCheckRetryWait(retryAt: number, now = Date.now()): string {
  const minutes = Math.ceil(Math.max(0, retryAt - now) / 60_000);
  if (minutes <= 1) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}
