import { useCallback, useEffect, useRef, useState } from "react";
import { COMMUNITY_UPDATES_CHECKED_EVENT, communityUpdateService } from "@/features/community-updates/communityUpdateService";
import { isAnotherDialogOpen } from "@/utils/openDialogs";
import { recordAndroidReleaseNoticeShown } from "./phoneAppAnalytics";
import { updatePhoneAppState, usePhoneAppState } from "./phoneAppState";

/** Delay after other dialogs close, so the notice never flashes between two of them. */
const SETTLE_MS = 1000;

export function useAndroidReleased(): boolean {
  const [released, setReleased] = useState(() => communityUpdateService.isAndroidAppReleased());
  useEffect(() => {
    const read = () => setReleased(communityUpdateService.isAndroidAppReleased());
    window.addEventListener(COMMUNITY_UPDATES_CHECKED_EVENT, read);
    read();
    return () => window.removeEventListener(COMMUNITY_UPDATES_CHECKED_EVENT, read);
  }, []);
  return released;
}

/**
 * "The Tagify Android app is out": shown once, only to people who pressed "Notify me when it's
 * out" on this computer, once Community's update feed (which every Tagify already reads) says so.
 */
export function useAndroidReleaseNotice({ enabled }: { enabled: boolean }) {
  const state = usePhoneAppState();
  const released = useAndroidReleased();
  const [visible, setVisible] = useState(false);
  const waiting = enabled && released && Boolean(state.androidNotify) && !state.androidNoticeDone;

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

  const shown = waiting && visible;
  const reported = useRef(false);
  useEffect(() => {
    if (shown && !reported.current) {
      reported.current = true;
      recordAndroidReleaseNoticeShown();
    }
  }, [shown]);

  const done = useCallback(() => updatePhoneAppState({ androidNoticeDone: true }), []);
  return { holdsPlace: waiting, shown, done };
}
