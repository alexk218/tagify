import React from "react";
import { StickyNote } from "lucide-react";
import styles from "./PrivateNotePreview.module.css";

export function PrivateNotePreview({ text, trackName, onOpen }: {
  text?: string;
  trackName: string;
  onOpen?: () => void;
}) {
  const preview = text?.replace(/\s+/g, " ").trim();
  if (!preview) return null;
  const content = <><StickyNote size={13} aria-hidden="true" /><span className={styles.text}>{preview}</span></>;
  const title = `Your private note\n${text}`;
  return onOpen ? (
    <button type="button" className={styles.preview} title={title} aria-label={`Open private note for ${trackName}`} onClick={onOpen}>{content}</button>
  ) : (
    <span className={styles.preview} title={title}>{content}</span>
  );
}

export function PrivateNotePreviewError({ onRetry }: { onRetry: () => void }) {
  return <p className={styles.error} role="status">Your note previews couldn't be loaded. <button type="button" onClick={onRetry}>Try again</button></p>;
}
