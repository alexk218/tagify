/**
 * When a member adds other members' tag to a song (Tagged by others, a song's Community details, or
 * members' tags in the first run), the people who publicly put that tag on that song earn a curator
 * point and get Community's thank-you, as when the same tag is added on the website. Community
 * gives at most one point per member, curator and tag, and never tells the member whom it reached.
 *
 * The adds wait here until sync has sent the member's new tag to Community: Community answers which
 * ones it can't credit yet (the tag isn't there yet), and those stay for the next try. Offline, a
 * signed-out session or a Community that doesn't know these yet keep them too, for a week.
 */

const OUTBOX_KEY = "tagify:communityTagAddCredits:v1";
const MAX_ENTRIES = 300;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
// Requests Community will never accept; anything else (offline, signed out, not deployed yet,
// outages) is tried again later.
const PERMANENT_FAILURES = new Set([400, 403, 413, 422]);
const SPOTIFY_TRACK_ID = /^[0-9A-Za-z]{22}$/;

interface OutboxEntry {
  accountId: string;
  name: string;
  spotifyTrackId: string;
  queuedAt: number;
}

export interface TagAddCreditConnection {
  accountId: string;
  deviceId: string;
}

export type CommunityRequest = (path: string, options: { method: "POST"; body: unknown }) => Promise<unknown>;

const entryKey = (entry: Pick<OutboxEntry, "accountId" | "name" | "spotifyTrackId">) =>
  `${entry.accountId}\n${entry.spotifyTrackId}\n${entry.name.trim().toLowerCase()}`;

function readOutbox(now: number): OutboxEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OutboxEntry =>
      !!entry && typeof entry.accountId === "string" && typeof entry.name === "string"
      && typeof entry.spotifyTrackId === "string" && typeof entry.queuedAt === "number"
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

/** Notes members' tags just added to a Spotify song, by every spelling the members used. */
export function queueCommunityTagAddCredits(accountId: string, trackUri: string, names: readonly string[], now = Date.now()) {
  const spotifyTrackId = trackUri.startsWith("spotify:track:") ? trackUri.slice("spotify:track:".length) : "";
  if (!SPOTIFY_TRACK_ID.test(spotifyTrackId)) return;
  const entries = readOutbox(now);
  const queued = new Set(entries.map(entryKey));
  for (const raw of names) {
    const name = raw.trim().slice(0, 200);
    if (!name) continue;
    const entry = { accountId, name, spotifyTrackId, queuedAt: now };
    if (queued.has(entryKey(entry))) continue;
    queued.add(entryKey(entry));
    entries.push(entry);
  }
  writeOutbox(entries);
}

let flushing: Promise<void> | null = null;

/** Sends queued adds for the connected account, a batch at a time. */
export function flushCommunityTagAddCredits(
  connection: TagAddCreditConnection | null,
  request: CommunityRequest,
  now = Date.now(),
): Promise<void> {
  if (!connection) return Promise.resolve();
  if (flushing) return flushing;
  const run = (async () => {
    // Entries Community said it can't credit yet are skipped for the rest of this run.
    const later = new Set<string>();
    for (;;) {
      const batch = readOutbox(now)
        .filter((entry) => entry.accountId === connection.accountId && !later.has(entryKey(entry)))
        .slice(0, BATCH_SIZE);
      if (!batch.length) return;
      let waiting: number[] = [];
      try {
        const answer = await request("/api/v2/tag-adds", {
          method: "POST",
          body: { deviceId: connection.deviceId, adds: batch.map(({ name, spotifyTrackId }) => ({ name, spotifyTrackId })) },
        }) as { waiting?: unknown } | null;
        if (Array.isArray(answer?.waiting)) waiting = answer.waiting.filter((index): index is number => Number.isInteger(index));
      } catch (error) {
        const status = (error as { status?: unknown })?.status;
        if (typeof status !== "number" || !PERMANENT_FAILURES.has(status)) {
          console.debug("Curator credits for added tags will be sent later", error);
          return;
        }
      }
      for (const index of waiting) if (batch[index]) later.add(entryKey(batch[index]));
      const sent = new Set(batch.map(entryKey).filter((key) => !later.has(key)));
      writeOutbox(readOutbox(now).filter((entry) => !sent.has(entryKey(entry))));
    }
  })();
  // Cleared once settled, even when there was nothing to send and it finished at once.
  flushing = run;
  void run.finally(() => {
    if (flushing === run) flushing = null;
  });
  return run;
}
