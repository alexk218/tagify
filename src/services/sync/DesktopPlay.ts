import { syncClientHeaders } from "./SyncClientHeaders";
import type { SendSession } from "./SpotifyLibrarySender";

// Playing a song pressed on Tagify Community in this Spotify (Community migration 9002).
//
// The member chooses "My Spotify app" in Community's player and presses Play. Community tells the
// member's most recently used computer on the private library channel (`desktop_play_request`);
// only that computer plays the song, with Spotify's own player, and answers so the website can say
// it's playing. Requests are never repeated on a pull, and one older than a minute is ignored, so a
// Tagify that was closed or asleep never starts music later. No Spotify Web API request is made.

/** What this Tagify tells Community it can do when it starts (with SPOTIFY_LISTS_FEATURE). */
export const DESKTOP_PLAY_FEATURE = "desktopPlay";

/** A request older than this (or this far in the future, for a computer whose clock is off) is ignored. */
export const DESKTOP_PLAY_MAX_AGE_MS = 60_000;

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DesktopPlayRequest { requestId: string; trackId: string }

/** Whether this Spotify can play a song by its URI. */
export function canPlayFromCommunity(player: unknown = typeof Spicetify === "undefined" ? undefined : Spicetify.Player): boolean {
  return typeof (player as { playUri?: unknown } | undefined)?.playUri === "function";
}

/**
 * The request in a `desktop_play_request` broadcast, when it is for this library and this computer,
 * names one Spotify song and is recent; anything else is null.
 */
export function readDesktopPlayRequest(payload: unknown, device: { libraryId: string; deviceId: string }, now = Date.now()): DesktopPlayRequest | null {
  const value = (payload ?? {}) as Record<string, unknown>;
  if (value.libraryId !== device.libraryId || value.deviceId !== device.deviceId) return null;
  if (typeof value.requestId !== "string" || !UUID.test(value.requestId)) return null;
  if (typeof value.trackId !== "string" || !SPOTIFY_ID.test(value.trackId)) return null;
  const requestedAt = typeof value.requestedAt === "string" ? Date.parse(value.requestedAt) : NaN;
  if (!Number.isFinite(requestedAt) || Math.abs(now - requestedAt) > DESKTOP_PLAY_MAX_AGE_MS) return null;
  return { requestId: value.requestId, trackId: value.trackId };
}

/** Plays the song in this Spotify. Resolves whether Spotify accepted it. */
export async function playRequestedSong(trackId: string, player: { playUri(uri: string): Promise<unknown> | unknown } = Spicetify.Player): Promise<boolean> {
  try {
    await player.playUri(`spotify:track:${trackId}`);
    return true;
  } catch (error) {
    console.warn("Tagify: Spotify couldn't play the song from Community", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Tells Community how the request went. Never throws; a Community without the route answers 404. */
export async function answerDesktopPlay(session: SendSession, requestId: string, outcome: "played" | "failed", request: typeof fetch = fetch): Promise<boolean> {
  try {
    const current = await session();
    const response = await request(`${current.apiBaseUrl}/api/v2/sync/desktop-play`, {
      method: "POST",
      headers: { ...syncClientHeaders(current.accessToken), "content-type": "application/json" },
      body: JSON.stringify({ deviceId: current.deviceId, requestId, outcome }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Plays a request once (broadcasts can repeat after a reconnect) and answers it. */
export class DesktopPlayer {
  private readonly handled: string[] = [];

  constructor(private readonly play: (trackId: string) => Promise<boolean> = playRequestedSong, private readonly answer = answerDesktopPlay) {}

  async handle(request: DesktopPlayRequest, session: SendSession): Promise<"played" | "failed" | "repeat"> {
    if (this.handled.includes(request.requestId)) return "repeat";
    this.handled.push(request.requestId);
    if (this.handled.length > 50) this.handled.shift();
    const outcome = await this.play(request.trackId) ? "played" : "failed";
    await this.answer(session, request.requestId, outcome);
    return outcome;
  }
}
