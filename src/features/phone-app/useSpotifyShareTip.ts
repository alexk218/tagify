import { useCallback, useEffect, useState } from "react";
import packageJson from "@/package";
import { isNewInstallation } from "@/features/onboarding/installedVersion";
import { updatePhoneAppState, usePhoneAppState } from "./phoneAppState";
import { useShowWhenClear } from "./useShowWhenClear";

/**
 * "Tag Spotify songs from your phone" (Tagify 3.4.1): shown once on this computer to people who
 * had Tagify before, except those who chose "Don't show this button again" for the phone apps
 * button. Someone who just installed Tagify never gets it (the phone apps button and the Guide
 * already cover it), not even after a later update.
 */
export function useSpotifyShareTip({ enabled }: { enabled: boolean }) {
  const state = usePhoneAppState();
  const [newInstallation] = useState(() => isNewInstallation(packageJson.version));
  useEffect(() => {
    if (newInstallation && !state.spotifyShareTipDone) updatePhoneAppState({ spotifyShareTipDone: true });
  }, [newInstallation, state.spotifyShareTipDone]);
  const waiting = enabled && !newInstallation && !state.hidden && !state.spotifyShareTipDone;
  const shown = useShowWhenClear(waiting);
  const done = useCallback(() => updatePhoneAppState({ spotifyShareTipDone: true }), []);
  return { holdsPlace: waiting, shown, done };
}
