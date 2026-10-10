import React, { useCallback, useEffect, useRef, useState } from "react";
import { Undo2, Redo2 } from "lucide-react";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import type { BulkUndoEntry } from "../utils/bulkUndo";
import styles from "./BulkUndoNotice.module.css";
type Result = { restoredTracks: number; skippedFields: number };
export function BulkUndoNotice({ onUndo, onRedo }: { onUndo: (id: string) => Promise<Result>; onRedo: (id: string) => Promise<Result> }) {
  const [history, setHistory] = useState<{ undo: BulkUndoEntry | null; redo: BulkUndoEntry | null }>({ undo: null, redo: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const operation = useRef(false);
  const account = getTagifyDatabaseName();
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const latest = await indexedDBStorage.getBulkEditHistory();
      if (ticket === generation.current && account === getTagifyDatabaseName()) setHistory(latest);
    } catch (error) { console.error("Tagify: Couldn't read edit history", error); }
  }, [account]);
  useEffect(() => {
    void refresh();
    window.addEventListener("tagify:dataUpdated", refresh);
    return () => { generation.current++; window.removeEventListener("tagify:dataUpdated", refresh); };
  }, [refresh]);
  const run = async (kind: "undo" | "redo") => {
    const entry = history[kind];
    if (!entry || operation.current || account !== getTagifyDatabaseName()) return;
    operation.current = true; setBusy(true); setMessage("");
    try {
      const result = await (kind === "undo" ? onUndo : onRedo)(entry.id);
      if (account !== getTagifyDatabaseName()) return;
      setMessage(`${kind === "undo" ? "Undid" : "Redid"} changes to ${result.restoredTracks} ${result.restoredTracks === 1 ? "song" : "songs"}.${result.skippedFields ? " Kept values edited since that change." : ""}`);
      Spicetify.showNotification(`${kind === "undo" ? "Undid" : "Redid"} changes to ${result.restoredTracks} ${result.restoredTracks === 1 ? "song" : "songs"}.${result.skippedFields ? " Kept later edits." : ""}`);
      await refresh();
    } catch (error) { const message = error instanceof Error ? error.message : "That change couldn't be restored. Please try again."; setMessage(message); Spicetify.showNotification(message, true); }
    finally { operation.current = false; setBusy(false); }
  };
  const description = (kind: "undo" | "redo") => {
    const count = history[kind] ? Object.keys(history[kind]!.changes).length : 0;
    return count ? `${kind === "undo" ? "Undo" : "Redo"} bulk changes to ${count} ${count === 1 ? "song" : "songs"}` : `No changes to ${kind}`;
  };
  return <div className={styles.history} role="group" aria-label="Tag edit history">
    <button type="button" aria-label="Undo" title={description("undo")} disabled={!history.undo || busy} onClick={() => void run("undo")}><Undo2 size={17} aria-hidden="true" /></button>
    <button type="button" aria-label="Redo" title={description("redo")} disabled={!history.redo || busy} onClick={() => void run("redo")}><Redo2 size={17} aria-hidden="true" /></button>
    <span className={styles.feedback} role="status" aria-live="polite">{message}</span>
  </div>;
}
