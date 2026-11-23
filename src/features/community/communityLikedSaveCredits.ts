/**
 * When a member saves a song from "On Community" (the track list's shelf of songs other members
 * tagged) to their Liked Songs, a member who publicly tagged it that way earns a curator point and
 * Community's thank-you, as when a song is saved from someone's profile on the website. Community
 * picks whom to credit from the searched tags and never tells the member whom it reached.
 *
 * Saves wait here until Community takes them: offline, signed out, or a Community that doesn't
 * know this request yet keep them for a week. Each save carries its own request id, so a retry
 * is never counted twice.
 */

export const LIKED_SAVE_CREDIT_PATH = "/api/v2/sync/liked-song-credit";
const OUTBOX_KEY = "tagify:communityLikedSaveCredits:v1";
const MAX_ENTRIES = 300;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TAGS = 10;
// Requests Community will never accept; anything else (offline, signed out, not deployed yet,
// switched off, busy) is tried again later.
const PERMANENT_FAILURES = new Set([400, 403, 409, 413, 422]);
const SPOTIFY_TRACK_ID = /^[0-9A-Za-z]{22}$/;

interface OutboxEntry {
  accountId: string;
  requestId: string;
  spotifyTrackId: string;
  tags: string[];
  queuedAt: number;
}

export interface LikedSaveCreditConnection {
  accountId: string;
  deviceId: string;
}

export type CommunityRequest = (path: string, options: { method: "POST"; body: unknown }) => Promise<unknown>;

function readOutbox(now: number): OutboxEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OutboxEntry =>
      !!entry && typeof entry.accountId === "string" && typeof entry.requestId === "string"
      && typeof entry.spotifyTrackId === "string" && Array.isArray(entry.tags) && typeof entry.queuedAt === "number"
      && now - entry.queuedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeOutbox(entries: OutboxEntry[]) {
  try {
    if (entries.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // Storage can be full or unavailable; the credit is a courtesy, never worth an error.
  }
}

const newRequestId = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

/** Notes a song just saved to Liked Songs from On Community, with the tags that found it. */
export function queueLikedSaveCredit(accountId: string, trackUri: string, searchedTags: readonly string[], now = Date.now()) {
  const spotifyTrackId = trackUri.startsWith("spotify:track:") ? trackUri.slice("spotify:track:".length) : "";
  if (!SPOTIFY_TRACK_ID.test(spotifyTrackId)) return;
  const tags = [...new Set(searchedTags.map((tag) => tag.trim().slice(0, 100)).filter(Boolean))].slice(0, MAX_TAGS);
  if (!tags.length) return;
  const entries = readOutbox(now);
  // Saved, removed and saved again: one credit is enough.
  if (entries.some((entry) => entry.accountId === accountId && entry.spotifyTrackId === spotifyTrackId)) return;
  entries.push({ accountId, requestId: newRequestId(), spotifyTrackId, tags, queuedAt: now });
  writeOutbox(entries);
}

let flushing: Promise<void> | null = null;

/** Sends waiting saves for the connected account, one at a time. */
export function flushLikedSaveCredits(
  connection: LikedSaveCreditConnection | null,
  request: CommunityRequest,
  now = Date.now(),
): Promise<void> {
  if (!connection) return Promise.resolve();
  if (flushing) return flushing;
  const run = (async () => {
    for (const entry of readOutbox(now).filter((item) => item.accountId === connection.accountId)) {
      try {
        await request(LIKED_SAVE_CREDIT_PATH, {
          method: "POST",
          body: { deviceId: connection.deviceId, requestId: entry.requestId, spotifyTrackId: entry.spotifyTrackId, tags: entry.tags },
        });
      } catch (error) {
        const status = (error as { status?: unknown })?.status;
        if (typeof status !== "number" || !PERMANENT_FAILURES.has(status)) {
          console.debug("Curator credit for a saved song will be sent later", error);
          return;
        }
      }
      writeOutbox(readOutbox(now).filter((item) => item.requestId !== entry.requestId));
    }
  })();
  flushing = run;
  void run.finally(() => {
    if (flushing === run) flushing = null;
  });
  return run;
}
