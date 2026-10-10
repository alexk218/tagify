import React from "react";
import { Undo2, Redo2 } from "lucide-react";
import styles from "./TrackEditHistoryControls.module.css";
export function TrackEditHistoryControls({ canUndo, canRedo, busy, onUndo, onRedo }: { canUndo: boolean; canRedo: boolean; busy: boolean; onUndo: () => void; onRedo: () => void }) {
  return <div className={styles.history} role="group" aria-label="Song edit history">
    <button type="button" aria-label="Undo" title={canUndo ? "Undo changes to the selected songs" : "No changes to undo for this selection"} disabled={!canUndo || busy} onClick={onUndo}><Undo2 size={17} aria-hidden="true" /></button>
    <button type="button" aria-label="Redo" title={canRedo ? "Redo changes to the selected songs" : "No changes to redo for this selection"} disabled={!canRedo || busy} onClick={onRedo}><Redo2 size={17} aria-hidden="true" /></button>
  </div>;
}
