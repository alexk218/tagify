import { useEffect, useMemo, useSyncExternalStore } from "react";
import { albumTrackListsStore, EMPTY_ALBUM_TRACKS, type AlbumTracksState } from "../services/albumTrackLists";
export type { AlbumTracksState } from "../services/albumTrackLists";

export function useAlbumMembership(): Readonly<Record<string, readonly string[]>> {
  const snapshot = useSyncExternalStore(albumTrackListsStore.subscribe, albumTrackListsStore.getSnapshot);
  return useMemo(() => Object.fromEntries(Object.entries(snapshot)
    .filter(([, state]) => state.status === "loaded")
    .map(([uri, state]) => [uri, state.tracks.map((track) => track.uri)])), [snapshot]);
}

/** Requests are shared, including when details and a list mount together. */
export function useAlbumTrackListLookups(uris: string[]): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const uri of uris) {
        if (cancelled) break;
        await albumTrackListsStore.request(uri);
      }
    })();
    return () => { cancelled = true; };
  }, [uris]);
}

export function useAlbumTracks(albumUri: string): AlbumTracksState {
  const snapshot = useSyncExternalStore(albumTrackListsStore.subscribe, albumTrackListsStore.getSnapshot);
  useEffect(() => { void albumTrackListsStore.request(albumUri); }, [albumUri]);
  return snapshot[albumUri] ?? EMPTY_ALBUM_TRACKS;
}
