import { useEffect, useRef } from "react";
import { spotifyService } from "@/services/SpotifyService";
import { fillToTagDetails, type ToTagEntry } from "./toTagStore";

/**
 * Songs on the list without a name or cover (e.g. added from a menu) get them, a few at a time.
 * Pass only songs with no Tagify data; tagged songs already show their own.
 */
export function useFillToTagNames(list: ToTagEntry[], active: boolean): void {
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!active) return;
    const missing = list
      .filter((entry) => (!entry.name || !entry.image) && entry.uri.startsWith("spotify:track:") && !tried.current.has(entry.uri))
      .slice(0, 20)
      .map((entry) => entry.uri);
    if (!missing.length) return;
    missing.forEach((uri) => tried.current.add(uri));
    const controller = new AbortController();
    let settled = false;
    void spotifyService.getBatchTracks(missing, 2, controller.signal).then((found) => {
      settled = true;
      if (controller.signal.aborted) return;
      fillToTagDetails(Object.fromEntries(Object.entries(found).map(([uri, track]) => [uri, { name: track.name, artists: track.artists, album: track.albumName, image: track.albumImageUrl ?? "" }])));
    }).catch(() => { settled = true; });
    return () => {
      controller.abort();
      // A list change cut this lookup short: let the next run try these songs again.
      if (!settled) missing.forEach((uri) => tried.current.delete(uri));
    };
  }, [list, active]);
}
