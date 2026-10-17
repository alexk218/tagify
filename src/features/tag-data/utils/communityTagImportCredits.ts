import type { TagTaxonomy } from "@/types/tagData";

/**
 * When someone saves a community tag into their library, the people who share that tag publicly
 * get a thank-you on Community. Tagify only reports it from a desktop signed in to Community, and
 * never tells the user whether or whom it reached.
 */

const OUTBOX_KEY = "tagify:communityTagImportCredits:v1";
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
// Requests Community will never accept; anything else (offline, signed out, not deployed yet,
// outages) is tried again later.
const PERMANENT_FAILURES = new Set([400, 403, 413, 422]);

interface OutboxEntry {
  accountId: string;
  name: string;
  queuedAt: number;
}

export interface CreditConnection {
  accountId: string;
  deviceId: string;
}

export type CommunityRequest = (path: string, options: { method: "POST"; body: unknown }) => Promise<unknown>;

/** Community tags imported into this draft since it was opened, by the name Community knows. */
export function newlyImportedCommunityTagNames(base: TagTaxonomy, next: TagTaxonomy): string[] {
  const names = Object.values(next.tagsById)
    .filter((tag) => tag.source?.type === "community" && !(tag.id in base.tagsById))
    .map((tag) => (tag.source?.publicTagName || tag.name).trim())
    .filter(Boolean);
  return [...new Set(names)];
}

function readOutbox(now: number): OutboxEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OutboxEntry =>
      !!entry && typeof entry.accountId === "string" && typeof entry.name === "string"
      && typeof entry.queuedAt === "number" && now - entry.queuedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeOutbox(entries: OutboxEntry[]) {
  try {
    if (entries.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // Storage can be full or unavailable; the thank-you is a courtesy, never worth an error.
  }
}

export function queueCommunityTagImportCredits(accountId: string, names: string[], now = Date.now()) {
  if (!names.length) return;
  const entries = readOutbox(now);
  const queued = new Set(entries.filter((entry) => entry.accountId === accountId).map((entry) => entry.name.toLowerCase()));
  for (const name of names) {
    if (queued.has(name.toLowerCase())) continue;
    queued.add(name.toLowerCase());
    entries.push({ accountId, name, queuedAt: now });
  }
  writeOutbox(entries);
}

let flushing: Promise<void> | null = null;

/** Sends queued imports for the connected account, a batch at a time. */
export function flushCommunityTagImportCredits(
  connection: CreditConnection | null,
  request: CommunityRequest,
  now = Date.now(),
): Promise<void> {
  if (!connection) return Promise.resolve();
  if (flushing) return flushing;
  const run = (async () => {
    for (;;) {
      const batch = readOutbox(now).filter((entry) => entry.accountId === connection.accountId).slice(0, BATCH_SIZE);
      if (!batch.length) return;
      try {
        await request("/api/v2/tag-imports", {
          method: "POST",
          body: { deviceId: connection.deviceId, tags: batch.map((entry) => ({ name: entry.name })) },
        });
      } catch (error) {
        const status = (error as { status?: unknown })?.status;
        if (typeof status !== "number" || !PERMANENT_FAILURES.has(status)) {
          console.debug("Tag import thank-yous will be sent later", error);
          return;
        }
      }
      const sent = new Set(batch.map((entry) => `${entry.accountId}\n${entry.name}`));
      writeOutbox(readOutbox(now).filter((entry) => !sent.has(`${entry.accountId}\n${entry.name}`)));
    }
  })();
  // Cleared once settled, even when there was nothing to send and it finished at once.
  flushing = run;
  void run.finally(() => {
    if (flushing === run) flushing = null;
  });
  return run;
}
