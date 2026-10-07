import { useEffect, useState } from "react";
import { spotifyApiService, type SpotifyAlbumTrack } from "@/services/SpotifyApiService";

export interface AlbumTracksState {
  status: "loading" | "loaded" | "failed";
  tracks: SpotifyAlbumTrack[];
}

// Tracklists rarely change, so each album is asked for once per session.
const loadedTracklists = new Map<string, SpotifyAlbumTrack[]>();
const pendingTracklists = new Map<string, Promise<SpotifyAlbumTrack[] | null>>();

function loadTracklist(albumUri: string): Promise<SpotifyAlbumTrack[] | null> {
  const pending =
    pendingTracklists.get(albumUri) ??
    spotifyApiService
      .getAlbumTracks(albumUri)
      .catch(() => null)
      .finally(() => pendingTracklists.delete(albumUri));
  pendingTracklists.set(albumUri, pending);
  return pending;
}

function getInitialState(albumUri: string): AlbumTracksState {
  const loaded = loadedTracklists.get(albumUri);
  return loaded ? { status: "loaded", tracks: loaded } : { status: "loading", tracks: [] };
}

/** The album's tracks in album order, as Spotify lists them. */
export function useAlbumTracks(albumUri: string): AlbumTracksState {
  const [state, setState] = useState(() => getInitialState(albumUri));

  useEffect(() => {
    setState(getInitialState(albumUri));
    if (loadedTracklists.has(albumUri)) {
      return;
    }

    let isCurrent = true;
    void loadTracklist(albumUri).then((tracks) => {
      if (tracks && tracks.length > 0) {
        loadedTracklists.set(albumUri, tracks);
      }
      if (isCurrent) {
        setState(
          tracks && tracks.length > 0
            ? { status: "loaded", tracks }
            : { status: "failed", tracks: [] },
        );
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [albumUri]);

  return state;
}
