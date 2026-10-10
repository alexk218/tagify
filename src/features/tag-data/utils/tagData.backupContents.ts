import { PRIVATE_NOTES_CHANGED_EVENT, privateNotesBackup } from "@/services/sync/PrivateNotes";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { readLocalDurableAppState } from "@/services/sync/DurableAppState";
import {
  getAutoFileBackupFrequencyIntervalMs,
  getTrailingFileBackupDueAt,
  isTrailingFileBackupDue,
  maybeDownloadTrailingTagDataFileBackup,
  readAutoFileBackupFrequency,
  type AutomaticFileBackupResult,
  type CompleteBackupContents,
} from "./tagData.backup";
import { TAG_DATA_UPDATED_EVENT } from "./tagData.events";

/** How long the library must stay unchanged before its newest changes are saved to a file. */
export const TRAILING_FILE_BACKUP_IDLE_MS = 5 * 60_000;

/** Everything a backup file carries besides tag data: Community provenance and saved settings. */
export async function readCompleteBackupContents(): Promise<Required<CompleteBackupContents>> {
  const [publicationPolicy, ownerIdentityMapping, installations, privateNotes] = await Promise.all([
    indexedDBStorage.getCommunityPublicationPolicy(),
    indexedDBStorage.getCommunityOwnerIdentityMapping(),
    indexedDBStorage.getCommunityInstallations(),
    privateNotesBackup(),
  ]);
  return {
    community: { publicationPolicy, ownerIdentityMapping, installations },
    appState: readLocalDurableAppState(), privateNotes,
  };
}

/**
 * Saves the saved library to a file when it changed after the latest
 * automatic file. Reads the library only when a file may be due.
 */
export async function saveTrailingFileBackup(): Promise<AutomaticFileBackupResult> {
  const frequency = readAutoFileBackupFrequency();
  if (getAutoFileBackupFrequencyIntervalMs(frequency) === null) return { status: "skipped", reason: "disabled" };
  if (!isTrailingFileBackupDue(Date.now(), frequency)) return { status: "skipped", reason: "too-soon" };
  const [data, contents] = await Promise.all([indexedDBStorage.loadAllStrict(), readCompleteBackupContents()]);
  return maybeDownloadTrailingTagDataFileBackup(data, contents);
}

/**
 * Keeps the newest library changes in a backup file. After any change (from
 * this page, the extension, sync, or notes), the library is saved to a file
 * once it has been unchanged for `idleMs`, when Spotify hides the page, or
 * when watching stops. Files stay throttled to a fraction of the chosen
 * backup period; a change that is too soon waits until one is allowed.
 * Returns a function that stops watching and saves any pending change.
 */
export function startTrailingFileBackups({ idleMs = TRAILING_FILE_BACKUP_IDLE_MS } = {}): () => void {
  let pending = false;
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number) => {
    if (timer) clearTimeout(timer);
    timer = stopped ? null : setTimeout(save, Math.max(0, delayMs));
  };

  function save(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending || running) return;
    pending = false;
    running = true;
    void saveTrailingFileBackup().then((result) => {
      if (result.status === "created") {
        console.log(`Tagify: Automatic file backup saved: ${result.metadata.filename}`);
      } else if (result.status === "skipped" && result.reason === "too-soon") {
        pending = true;
        const dueAt = getTrailingFileBackupDueAt();
        schedule(Math.max(idleMs, (dueAt ?? 0) - Date.now()));
      } else if (result.status === "failed") {
        throw new Error(result.error);
      }
    }).catch((error) => {
      console.warn("Tagify: Failed to create automatic file backup", error);
      pending = true;
      schedule(idleMs);
    }).finally(() => {
      running = false;
      // A change made while this file was being saved still needs one.
      if (pending && !timer) schedule(idleMs);
    });
  }

  const noteChange = (event: Event) => {
    if ((event as CustomEvent<{ dataChanged?: boolean }>).detail?.dataChanged === false) return;
    pending = true;
    schedule(idleMs);
  };
  const saveWhenHidden = () => {
    if (document.visibilityState === "hidden") save();
  };

  window.addEventListener(TAG_DATA_UPDATED_EVENT, noteChange);
  window.addEventListener(PRIVATE_NOTES_CHANGED_EVENT, noteChange);
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", saveWhenHidden);

  return () => {
    window.removeEventListener(TAG_DATA_UPDATED_EVENT, noteChange);
    window.removeEventListener(PRIVATE_NOTES_CHANGED_EVENT, noteChange);
    window.removeEventListener("pagehide", save);
    document.removeEventListener("visibilitychange", saveWhenHidden);
    save();
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
