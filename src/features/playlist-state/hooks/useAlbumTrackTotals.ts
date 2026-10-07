import { useEffect, useSyncExternalStore } from "react";
import {
  albumTrackTotalsStore,
  type AlbumTrackTotals,
} from "../services/albumTrackTotals";

/** Album lengths known on this device; updates as lookups finish. */
export function useKnownAlbumTrackTotals(): AlbumTrackTotals {
  return useSyncExternalStore(
    albumTrackTotalsStore.subscribe,
    albumTrackTotalsStore.getSnapshot,
  );
}

/**
 * Looks up the lengths of these albums in the background, in the given order.
 * Pass a memoized array.
 */
export function useAlbumTrackTotalLookups(albumUrisToLookUp: string[]): void {
  useEffect(() => {
    albumTrackTotalsStore.request(albumUrisToLookUp);
  }, [albumUrisToLookUp]);
}

/**
 * Album lengths known on this device. Albums in `albumUrisToLookUp` that are
 * still unknown are looked up in the background; pass a memoized array.
 */
export function useAlbumTrackTotals(albumUrisToLookUp: string[]): AlbumTrackTotals {
  useAlbumTrackTotalLookups(albumUrisToLookUp);
  return useKnownAlbumTrackTotals();
}
