import React, { useCallback, useEffect, useRef } from "react";
import { Portal } from "@/components/ui";
import styles from "./StatsSheet.module.css";

/**
 * Shows Stats above Tagify without replacing it. While closed it stays mounted but invisible, so
 * reopening returns to the same section, time range, tag and scroll position.
 */
export function StatsSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Runs each time Stats opens, including the first time, when the portal mounts the sheet a render later.
  const attachSheet = useCallback((node: HTMLDivElement | null) => {
    // Keep the last sheet when React detaches the ref, so closing can still check where focus is.
    if (!node) return;
    sheet.current = node;
    if (open && !node.contains(document.activeElement)) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      // Return to whatever opened Stats, unless the member has since moved focus elsewhere.
      if (returnFocus.current?.isConnected && (!document.activeElement || document.activeElement === document.body || sheet.current?.contains(document.activeElement))) {
        returnFocus.current.focus({ preventScroll: true });
      }
    };
  }, [open, onClose]);

  return (
    <Portal>
      <div className={open ? styles.overlay : `${styles.overlay} ${styles.overlayClosed}`} aria-hidden={!open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={attachSheet} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="tagify-stats-title" tabIndex={-1}>
          {children}
        </div>
      </div>
    </Portal>
  );
}

/** Shown in the sheet for the moment it takes to read the dates Stats count by. */
export function StatsLoading() {
  return <p className={styles.loading} role="status">Loading your stats…</p>;
}
