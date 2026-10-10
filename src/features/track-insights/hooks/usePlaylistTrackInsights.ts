import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AlbumTrackSummary, PlaylistData, TagTaxonomy, TrackData } from "@/types/tagData";
import { summarizeTrackUris } from "@/features/playlist-state";
import { buildResolvedTagLookup } from "@/utils/tagTaxonomy";
import { playlistMembershipStore, type PlaylistMembership } from "../services/playlistMembership";

export interface PlaylistTrackInsights extends PlaylistMembership {
  summary?: AlbumTrackSummary;
  totalTrackCount?: number;
}

export function usePlaylistTrackInsights(
  playlists: Record<string, PlaylistData>, tracks: Record<string, TrackData>, taxonomy: TagTaxonomy,
  enabled: boolean, activeUri: string | null,
): Readonly<Record<string, PlaylistTrackInsights>> {
  const snapshot = useSyncExternalStore(playlistMembershipStore.subscribe, playlistMembershipStore.getSnapshot);
  const requestKey = JSON.stringify(Object.entries(playlists).filter(([uri]) => uri.startsWith("spotify:playlist:"))
    .map(([uri, data]) => [uri, data.snapshotId ?? "", data.trackCount ?? ""]));
  useEffect(() => {
    if (!enabled) return;
    const entries: [string, string, number | string][] = JSON.parse(requestKey);
    if (activeUri?.startsWith("spotify:playlist:") && !entries.some(([uri]) => uri === activeUri)) entries.unshift([activeUri, "", ""]);
    entries.sort(([left], [right]) => Number(right === activeUri) - Number(left === activeUri));
    let cancelled = false;
    const refresh = async (force = false) => {
      for (const [uri, revision, count] of entries) {
        if (cancelled) break;
        await playlistMembershipStore.request(uri, `${revision}:${count}`, force);
      }
    };
    const onFocus = () => { void refresh(true); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    const interval = window.setInterval(onVisible, 60_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [requestKey, enabled, activeUri]);
  const resolvedTags = useMemo(() => buildResolvedTagLookup(taxonomy), [taxonomy]);
  return useMemo(() => Object.fromEntries(Object.entries(snapshot).map(([uri, state]) => [uri, {
    ...state,
    ...(state.uris ? { summary: summarizeTrackUris(tracks, taxonomy, state.uris, resolvedTags), totalTrackCount: state.uris.length } : {}),
  }])), [snapshot, tracks, taxonomy, resolvedTags]);
}
