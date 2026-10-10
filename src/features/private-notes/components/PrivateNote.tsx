import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_PRIVATE_NOTE_LENGTH } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { emptyPrivateNote, privateNoteBackupStatus, PRIVATE_NOTES_CHANGED_EVENT, savePrivateNote } from "@/services/sync/PrivateNotes";
import type { LocalPrivateNote } from "@/services/sync/PrivateNotes.types";
import { getDesktopSyncConfiguration, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import styles from "./PrivateNote.module.css";
export function PrivateNote({ uri, inline = false }: { uri: string; inline?: boolean }) {
  const account = getTagifyDatabaseName();
  const key = `tagify:private-note-draft:${account}:${uri}`;
  const readDraft = () => {
    try { return JSON.parse(localStorage.getItem(key) || "null") as { text: string; baseText: string } | null; } catch { return null; }
  };
  const [note, setNote] = useState<LocalPrivateNote>(() => emptyPrivateNote(uri));
  const [draft, setDraft] = useState(() => readDraft()?.text || "");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(privateNoteBackupStatus);
  const [changedCopy, setChangedCopy] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  const editBase = useRef("");
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const savedNote = await indexedDBStorage.getPrivateNote(uri, account);
      if (!mounted.current || request !== revision.current || account !== getTagifyDatabaseName()) return;
      const next = savedNote || emptyPrivateNote(uri);
      setNote(next); setLoaded(true); setStatus(privateNoteBackupStatus());
      let savedDraft: { text: string; baseText: string } | null = null;
      try { savedDraft = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* Keep the saved note if a draft could not be read. */ }
      if (savedDraft === null) { setDraft(next.text); editBase.current = next.text; setChangedCopy(null); }
      else { editBase.current = savedDraft.baseText; setChangedCopy(next.text !== savedDraft.baseText ? next.text : null); }
    } catch { if (mounted.current) setError("Your note couldn't be loaded. Your draft is kept; please try again."); }
  }, [account, key, uri]);
  useEffect(() => {
    mounted.current = true; void refresh();
    window.addEventListener(PRIVATE_NOTES_CHANGED_EVENT, refresh);
    return () => { mounted.current = false; revision.current++; window.removeEventListener(PRIVATE_NOTES_CHANGED_EVENT, refresh); };
  }, [refresh]);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!inline || !field) return;
    const resize = () => {
      field.style.height = "auto";
      const height = field.scrollHeight + 2;
      field.style.height = `${Math.min(160, Math.max(32, height))}px`;
      field.style.overflowY = height > 160 ? "auto" : "hidden";
    };
    resize();
    let width = field.clientWidth;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (width !== field.clientWidth) { width = field.clientWidth; resize(); }
    });
    observer?.observe(field);
    return () => observer?.disconnect();
  }, [inline, draft, loaded]);
  const commit = async (text: string, resolve = false) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError("");
    try {
      if (account !== getTagifyDatabaseName()) throw new Error("Your connected account changed. Reopen this note before saving.");
      await savePrivateNote(uri, text, resolve ? note.text : editBase.current, resolve, note.conflict?.revision ?? note.revision);
      if (mounted.current && account === getTagifyDatabaseName()) { localStorage.removeItem(key); setChangedCopy(null); editBase.current = text; setDraft(text); await refresh(); }
    } catch (failure) { if (mounted.current) { setError(failure instanceof Error ? failure.message : "Your note couldn't be saved. Your draft is kept; please try again."); await refresh(); } }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  const connected = !!getDesktopSyncConfiguration();
  const remoteText = note.conflict?.text ?? changedCopy;
  const backup = !connected ? "Saved on this device and in file backups." : status === "synced" && !note.dirty ? "Backed up privately to Community." : status === "local" ? "Cloud note backup isn't available yet. Your note stays on this device and in file backups." : status === "error" ? "Saved on this device. Cloud backup will retry when you sync again." : "Saved on this device. Waiting for private cloud backup.";
  const field = <textarea ref={textarea} className={styles.editor} aria-label="Private note" title={backup} rows={inline ? 1 : 5} maxLength={MAX_PRIVATE_NOTE_LENGTH} disabled={!loaded || busy} value={draft} onKeyDown={event => {
    if (inline && (event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing && loaded && !busy && draft !== note.text && remoteText === null) { event.preventDefault(); void commit(draft); }
  }} onBlur={() => {
    if (inline && loaded && !busy && draft !== note.text && remoteText === null) void commit(draft);
  }} onChange={event => {
    const text = event.target.value; setDraft(text); try { localStorage.setItem(key, JSON.stringify({ text, baseText: editBase.current })); } catch { setError("Your draft could not be kept on this device. Save your note before leaving this page."); }
  }} placeholder={inline ? "Add a private note…" : "Write something you want to remember…"} />;
  const content = <>
    {!inline && <p>Only you can see this note. It is excluded from public sharing.</p>}
    {field}
    {inline && <span className={styles.announcement} role="status">{busy ? "Saving…" : draft !== note.text ? "Draft" : note.text ? "Saved" : ""}</span>}
    {(!inline || busy || draft !== note.text || !!error || draft.length > MAX_PRIVATE_NOTE_LENGTH * .9) && <div className={styles.actions}>
      {!inline && <span title={backup}>{draft.length} / {MAX_PRIVATE_NOTE_LENGTH}</span>}
      {inline && <span className={styles.saveStatus}>{busy ? "Saving…" : draft !== note.text ? "Draft" : ""}</span>}
      {(!inline || !!error) && <button disabled={!loaded || busy || draft === note.text || remoteText !== null} onMouseDown={event => event.preventDefault()} onClick={() => void commit(draft)}>{busy ? "Saving…" : "Save note"}</button>}
      {!inline && localStorage.getItem(key) !== null && <button disabled={busy} onClick={() => { localStorage.removeItem(key); setDraft(note.text); editBase.current = note.text; setChangedCopy(null); }}>Discard draft</button>}
      {draft.length > MAX_PRIVATE_NOTE_LENGTH * .9 && inline && <span>{draft.length} / {MAX_PRIVATE_NOTE_LENGTH}</span>}
    </div>}
    {remoteText !== null && <div className={styles.conflict}>
      <p>This note has another saved copy. Your draft is kept above. Review both copies before choosing.</p>
      <textarea className={styles.editor} aria-label="Other saved note" readOnly rows={4} value={remoteText} />
      <button disabled={busy} onClick={() => void commit(draft, true)}>Keep my note</button>
      <button disabled={busy} onClick={() => void commit(remoteText, true)}>Use other saved note</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {!loaded && error && <button onClick={() => void refresh()}>Retry loading note</button>}
    {!inline && loaded && <p role="status">{backup}{localStorage.getItem(key) !== null ? " Your draft is saved on this device; choose Save note to include it in backups." : ""}</p>}
  </>;
  if (inline) return <div className={styles.inline} aria-label="Private note editor">{content}</div>;
  return <details className={styles.note}><summary>Private note{note.text || localStorage.getItem(key) ? (localStorage.getItem(key) ? " · Draft" : " · Saved") : ""}</summary>{content}</details>;
}
