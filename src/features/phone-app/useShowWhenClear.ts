import { useEffect, useState } from "react";
import { isAnotherDialogOpen } from "@/utils/openDialogs";

/** Delay after other dialogs close, so a notice never flashes between two of them. */
const SETTLE_MS = 1000;

/**
 * True once `waiting` holds, the window is visible and no other dialog is on screen (after a
 * short settle). Stays true until `waiting` turns false, so the notice doesn't hide itself.
 */
export function useShowWhenClear(waiting: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!waiting) {
      setVisible(false);
      return;
    }
    if (visible) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryShowing = () => {
      if (document.visibilityState !== "visible" || isAnotherDialogOpen()) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (!timer) timer = setTimeout(() => setVisible(true), SETTLE_MS);
    };
    // Observe only while the notice is waiting behind another dialog.
    const observer = new MutationObserver(tryShowing);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", tryShowing);
    tryShowing();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", tryShowing);
    };
  }, [waiting, visible]);

  return waiting && visible;
}
