import { useCallback, useEffect, useRef, useState } from "react";
import { COMMUNITY_UPDATES_CHECKED_EVENT, communityUpdateService } from "@/features/community-updates/communityUpdateService";
import { recordAndroidReleaseNoticeShown } from "./phoneAppAnalytics";
import { updatePhoneAppState, usePhoneAppState } from "./phoneAppState";
import { useShowWhenClear } from "./useShowWhenClear";

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
  const waiting = enabled && released && Boolean(state.androidNotify) && !state.androidNoticeDone;
  const shown = useShowWhenClear(waiting);

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
