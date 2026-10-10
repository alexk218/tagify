import { buildArtistTrackSummaries } from "../utils/artistTrackSummaries";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { hasTrackAnnotation } from "@/features/playlist-state";
import { trackArtistIdentitiesStore } from "@/services/trackArtistIdentities";

export function useArtistTrackInsights(tracks: Record<string, TrackData>, taxonomy: TagTaxonomy, enabled: boolean) {
  const visible = useRef(false);
  const generation = useRef(0);
  const identities = useSyncExternalStore(trackArtistIdentitiesStore.subscribe, trackArtistIdentitiesStore.getSnapshot);
  const check = useSyncExternalStore(trackArtistIdentitiesStore.subscribe, trackArtistIdentitiesStore.getCheckState);
  const requestKey = useMemo(() => JSON.stringify(Object.entries(tracks).filter(([uri, track]) =>
    uri.startsWith("spotify:track:") && hasTrackAnnotation(track, taxonomy)).map(([uri]) => uri).sort()), [tracks, taxonomy]);
  useEffect(() => {
    visible.current = enabled;
    if (!enabled) return;
    let cancelled = false;
    const shouldContinue = () => !cancelled && document.visibilityState !== "hidden";
    void trackArtistIdentitiesStore.check(JSON.parse(requestKey), { automatic: true, shouldContinue });
    return () => { cancelled = true; visible.current = false; generation.current += 1; };
  }, [requestKey, enabled]);
  const retry = useCallback(() => {
    const current = generation.current;
    if (enabled) void trackArtistIdentitiesStore.check(JSON.parse(requestKey), {
      shouldContinue: () => current === generation.current && visible.current && document.visibilityState !== "hidden",
    });
  }, [requestKey, enabled]);
  const pendingCount = useMemo(() => (JSON.parse(requestKey) as string[]).filter((uri) => !identities[uri]).length, [requestKey, identities]);
  const summaries = useMemo(() => buildArtistTrackSummaries(tracks, taxonomy, identities), [tracks, taxonomy, identities]);
  return useMemo(() => ({ summaries, pendingCount, isChecking: check.isChecking, blockedUntil: check.blockedUntil, retry }), [summaries, pendingCount, check, retry]);
}
export type ArtistTrackInsights = ReturnType<typeof useArtistTrackInsights>;
