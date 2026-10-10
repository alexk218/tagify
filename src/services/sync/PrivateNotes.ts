import { assertPrivateNotePage, assertPrivateNoteWriteResult, isPrivateNoteUri, MAX_PRIVATE_NOTE_BATCH, MAX_PRIVATE_NOTE_LENGTH, type PrivateNoteV1 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getDesktopSyncConfiguration, getTagifyDatabaseName, SYNC_OUTBOX_CHANGED_EVENT, type DesktopSyncConfiguration } from "./SyncLocalState";
import { syncClientHeaders } from "./SyncClientHeaders";
import { PRIVATE_NOTES_CHANGED_EVENT, type LocalPrivateNote, type PrivateNotesBackup } from "./PrivateNotes.types";
export { PRIVATE_NOTES_CHANGED_EVENT } from "./PrivateNotes.types";
export type { PrivateNotesBackup } from "./PrivateNotes.types";
export const emptyPrivateNote = (uri: string): LocalPrivateNote => ({ uri, text: "", revision: 0, updatedAt: new Date().toISOString(), dirty: false, baseText: "" });
export function notifyPrivateNotesChanged(local = false, dataChanged = true) {
  window.dispatchEvent(new CustomEvent(PRIVATE_NOTES_CHANGED_EVENT, { detail: { dataChanged } }));
  if (local) window.dispatchEvent(new CustomEvent(SYNC_OUTBOX_CHANGED_EVENT));
}
function validateText(text: string) {
  if (text.length > MAX_PRIVATE_NOTE_LENGTH || text.includes("\u0000")) throw new Error("Your note is too long or contains a character that can't be saved. Shorten it or remove that character, then try again.");
}
export async function savePrivateNote(uri: string, text: string, expectedText: string, resolveConflict = false, expectedRevision?: number) {
  if (!isPrivateNoteUri(uri)) throw new Error("Notes are available for songs, albums, artists, and playlists.");
  validateText(text);
  const databaseName = getTagifyDatabaseName();
  await indexedDBStorage.mutatePrivateNotes([uri], notes => {
    const current = notes[uri] || emptyPrivateNote(uri);
    if (current.text !== expectedText || (current.conflict && !resolveConflict)) throw new Error("This note changed on another device. Review both copies before saving.");
    if (resolveConflict && expectedRevision !== undefined && (current.conflict?.revision ?? current.revision) !== expectedRevision) throw new Error("Another saved copy arrived. Review it before choosing which note to keep.");
    const revision = resolveConflict ? current.conflict?.revision ?? current.revision : current.revision;
    const baseText = resolveConflict ? current.conflict?.text ?? current.baseText : current.baseText;
    return { [uri]: { ...current, text, revision, baseText, dirty: text !== baseText, conflict: undefined, updatedAt: new Date().toISOString() } };
  }, databaseName);
  notifyPrivateNotesChanged(true);
}
export async function mergeRemotePrivateNotes(remote: PrivateNoteV1[], databaseName = getTagifyDatabaseName(), notify = true) {
  if (!remote.length) return;
  await indexedDBStorage.mutatePrivateNotes(remote.map(note => note.uri), notes => Object.fromEntries(remote.map(note => {
    const current = notes[note.uri];
    if (current && Math.max(current.revision, current.conflict?.revision ?? 0) > note.revision) return [note.uri, current];
    if (current?.dirty && current.text !== note.text && current.baseText !== note.text) return [note.uri, { ...current, conflict: note }];
    if (current?.dirty && current.text !== note.text) return [note.uri, { ...current, revision: note.revision, baseText: note.text, conflict: undefined }];
    return [note.uri, { ...note, dirty: false, baseText: note.text }];
  })), databaseName);
  if (notify) notifyPrivateNotesChanged();
}
export async function privateNotesBackup(): Promise<PrivateNotesBackup> {
  return Object.fromEntries((await indexedDBStorage.getPrivateNotes()).map(note => [note.uri, { text: note.text, ...(note.conflict ? { conflictText: note.conflict.text } : {}) }]));
}
export function normalizePrivateNotesBackup(value: unknown): PrivateNotesBackup {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The note backup couldn't be read. Keep the original file and try another backup.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100000) throw new Error("The note backup is too large.");
  return Object.fromEntries(entries.map(([uri, raw]) => {
    const note = raw as { text?: unknown; conflictText?: unknown };
    if (!isPrivateNoteUri(uri) || !note || typeof note.text !== "string" || (note.conflictText !== undefined && typeof note.conflictText !== "string")) throw new Error("The note backup couldn't be read. Keep the original file and try another backup.");
    validateText(note.text); if (typeof note.conflictText === "string") validateText(note.conflictText);
    return [uri, { text: note.text, ...(typeof note.conflictText === "string" ? { conflictText: note.conflictText } : {}) }];
  }));
}
export async function restorePrivateNotesBackup(value: PrivateNotesBackup) {
  const databaseName = getTagifyDatabaseName();
  const incoming = normalizePrivateNotesBackup(value);
  const current = await indexedDBStorage.getPrivateNotes(databaseName);
  const uris = [...new Set([...current.map(note => note.uri), ...Object.keys(incoming)])];
  await indexedDBStorage.mutatePrivateNotes(uris, notes => Object.fromEntries(uris.map(uri => {
    const old = notes[uri] || emptyPrivateNote(uri);
    const text = incoming[uri]?.text || "";
    const conflictText = incoming[uri]?.conflictText;
    return [uri, { ...old, text, dirty: text !== old.baseText, conflict: conflictText === undefined ? undefined : { uri, text: conflictText, revision: old.revision, updatedAt: old.updatedAt }, updatedAt: new Date().toISOString() }];
  })), databaseName);
  notifyPrivateNotesChanged(true);
}
export type PrivateNoteBackupStatus = "local" | "syncing" | "synced" | "conflict" | "error";
let status: PrivateNoteBackupStatus = "local";
let statusAccount: string | undefined;
export const privateNoteBackupStatus = () => statusAccount === getDesktopSyncConfiguration()?.accountId ? status : "local";
function setStatus(value: PrivateNoteBackupStatus) { status = value; statusAccount = getDesktopSyncConfiguration()?.accountId; notifyPrivateNotesChanged(false, false); }
/** Returns false when notes could not be read or backed up; they stay on this device and retry later. */
export async function syncPrivateNotes(configuration: DesktopSyncConfiguration, enabled: boolean, options: { remoteCursor?: number } = {}): Promise<boolean> {
  if (!enabled) { setStatus("local"); return true; }
  const databaseName = getTagifyDatabaseName();
  const guard = () => { if (getDesktopSyncConfiguration()?.accountId !== configuration.accountId) throw new Error("The connected account changed."); };
  setStatus("syncing");
  let dataChanged = false;
  try {
    guard();
    let cursor = await indexedDBStorage.privateNoteCursor(undefined, databaseName);
    // Community's pull reported the same note cursor: nothing new to read.
    let hasMore = options.remoteCursor !== cursor;
    while (hasMore) {
      const response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/private-notes?deviceId=${encodeURIComponent(configuration.deviceId)}&after=${cursor}`, { headers: syncClientHeaders(configuration.accessToken) });
      if (!response.ok) throw new Error("Your note backup couldn't be read.");
      const page = await response.json(); assertPrivateNotePage(page); guard();
      if (page.hasMore && page.nextCursor <= cursor) throw new Error("Your note backup stopped before the end.");
      await mergeRemotePrivateNotes(page.notes, databaseName, false); dataChanged ||= page.notes.length > 0; guard();
      cursor = page.nextCursor; await indexedDBStorage.privateNoteCursor(cursor, databaseName); hasMore = page.hasMore;
    }
    const dirty = (await indexedDBStorage.getPrivateNotes(databaseName)).filter(note => note.dirty && !note.conflict);
    for (let index = 0; index < dirty.length; index += MAX_PRIVATE_NOTE_BATCH) {
      const submitted = dirty.slice(index, index + MAX_PRIVATE_NOTE_BATCH);
      guard();
      const response = await fetch(`${configuration.apiBaseUrl}/api/v2/sync/private-notes`, {
        method: "PUT", headers: { ...syncClientHeaders(configuration.accessToken), "content-type": "application/json" },
        body: JSON.stringify({ deviceId: configuration.deviceId, edits: submitted.map(note => ({ uri: note.uri, text: note.text, expectedRevision: note.revision })) }),
      });
      if (!response.ok) throw new Error("Your notes couldn't be backed up. They'll retry when you sync again.");
      const result = await response.json(); assertPrivateNoteWriteResult(result); guard();
      const returned = [...result.saved, ...result.conflicts];
      if (returned.length !== submitted.length || returned.some(note => !submitted.some(item => item.uri === note.uri))) throw new Error("Community didn't confirm every note. They'll retry when you sync again.");
      await indexedDBStorage.mutatePrivateNotes(returned.map(note => note.uri), notes => Object.fromEntries(returned.map(note => {
        const current = notes[note.uri];
        if (!current) throw new Error("A note changed while it was being backed up.");
        if (result.conflicts.some(item => item.uri === note.uri)) return [note.uri, { ...current, conflict: note }];
        return [note.uri, { ...current, revision: note.revision, baseText: note.text, dirty: current.text !== note.text, conflict: undefined }];
      })), databaseName);
      dataChanged = true;
    }
    guard();
    const latest = await indexedDBStorage.getPrivateNotes(databaseName);
    setStatus(latest.some(note => note.conflict) ? "conflict" : latest.some(note => note.dirty) ? "syncing" : "synced");
    return true;
  } catch (error) { console.warn("Tagify: Private notes will retry", error); if (getDesktopSyncConfiguration()?.accountId === configuration.accountId) setStatus("error"); return false; }
  finally { if (dataChanged && getDesktopSyncConfiguration()?.accountId === configuration.accountId) notifyPrivateNotesChanged(); }
}
