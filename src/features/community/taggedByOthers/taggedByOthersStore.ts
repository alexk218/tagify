import type { TaggedByOthersOutcome } from "./taggedByOthersScan";
import { onboardingPreviewDatabaseName } from "@/features/onboarding/preview/onboardingPreview";

// The last finished check, kept on this computer in a small database of its own: it is not part of
// the library database, so it never enters cloud app state, sync or a backup file, and losing it
// only means checking again.
const DATABASE = "tagify-tagged-by-others";
const STORE = "checks";
const LAST = "last";
/** A saved check older than this is checked again when Community opens. */
export const SAVED_CHECK_FRESH_MS = 24 * 60 * 60_000;

export interface SavedCheck {
  /** The Community account the check was made for. */
  account: string;
  /** When it finished, or when it was last saved while running, in milliseconds. */
  checkedAt: number;
  outcome: TaggedByOthersOutcome;
  /**
   * Saved while the check was still running: Spotify closed or reloaded before it ended, or
   * Community couldn't answer. Community continues it from `outcome.songIds` when it opens.
   */
  inProgress?: boolean;
}

export interface TaggedByOthersStore {
  /** The saved check for this account. One saved for another account is removed. */
  load(account: string): Promise<SavedCheck | null>;
  save(check: SavedCheck): Promise<void>;
  clear(): Promise<void>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(onboardingPreviewDatabaseName(DATABASE), 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The saved check is in use"));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

const isSaved = (value: unknown): value is SavedCheck & { id: string } => {
  const check = value as Partial<SavedCheck> | null;
  return !!check && typeof check.account === "string" && typeof check.checkedAt === "number" && Number.isFinite(check.checkedAt) &&
    !!check.outcome && Array.isArray(check.outcome.matches) && typeof check.outcome.checked === "number";
};

/** Saving is a convenience: a computer that can't keep the check simply checks again next time. */
export const taggedByOthersStore: TaggedByOthersStore = {
  async load(account) {
    try {
      const saved = await run("readonly", (store) => store.get(LAST));
      if (!isSaved(saved)) return null;
      if (saved.account !== account) { await this.clear(); return null; }
      // Checks saved before scopes existed read Liked Songs and every playlist.
      const outcome = saved.outcome;
      const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
      return { account: saved.account, checkedAt: saved.checkedAt, ...(saved.inProgress === true ? { inProgress: true } : {}), outcome: {
        ...outcome,
        scope: outcome.scope === "liked" ? "liked" : "liked+playlists",
        songIds: ids(outcome.songIds),
        playlistIds: ids(outcome.playlistIds),
        playlistsLeft: Number.isInteger(outcome.playlistsLeft) && Number(outcome.playlistsLeft) >= 0 ? outcome.playlistsLeft : null,
      } };
    } catch { return null; }
  },
  async save(check) {
    try { await run("readwrite", (store) => store.put({ id: LAST, ...check })); } catch { /* Checked again next time. */ }
  },
  async clear() {
    try { await run("readwrite", (store) => store.delete(LAST)); } catch { /* Nothing was kept. */ }
  },
};
