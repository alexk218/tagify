import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { albumTrackListsStore } from "@/features/playlist-state/services/albumTrackLists";
import { findAlbumNearRecordings, nearRecordingCandidates, type RecordingReuseTrack } from "../services/automaticRecordingReuse";
import { recordingAnnotations } from "../utils/recordingReuse";

type Changed = (changes: Record<string, TrackData>, syncChanges?: Record<string, TrackData>) => Promise<void>;

/**
 * When the song on the card has another saved version (its single, for example), checks the
 * other songs on its album too and links each one whose versions Spotify reports with the
 * same play count. Nothing is shown; the rest stay unlinked. Looks only at that album's
 * songs, and only when `active` (the song on the card has a same-title saved song or was
 * just linked). The song on the card is left to its own check.
 */
export function useAlbumNearRecordings(track: SpotifyTrack | null, tracks: Record<string, TrackData>, active: boolean, onChanged: Changed) {
  const changed = useRef(onChanged); changed.current = onChanged;
  const account = getTagifyDatabaseName();
  const uri = track?.uri || "";
  const albumUri = active && track?.album?.uri?.startsWith("spotify:album:") ? track.album.uri : "";
  const lists = useSyncExternalStore(albumTrackListsStore.subscribe, albumTrackListsStore.getSnapshot);
  useEffect(() => { if (albumUri) void albumTrackListsStore.request(albumUri); }, [albumUri]);
  const list = albumUri && lists[albumUri]?.status === "loaded" ? lists[albumUri].tracks : undefined;
  const albumTracks: RecordingReuseTrack[] = (list || []).filter(item => item.uri !== uri && /^spotify:track:[A-Za-z0-9]{22}$/.test(item.uri)).map(item => ({
    uri: item.uri, name: item.name, details: { artists: item.artists, albumName: track?.album?.name, albumUri, albumImageUrl: track?.album?.images?.[0]?.url },
  }));
  const entry = (id: string) => [id, tracks[id]?.recordingGroupId, tracks[id]?.recordingNotSameAs, tracks[id]?.recordingIdentity, tracks[id]?.name, recordingAnnotations(tracks[id])];
  const signature = albumTracks.length
    ? JSON.stringify([account, albumUri, albumTracks.map(item => [entry(item.uri), nearRecordingCandidates(item, tracks).map(([id]) => entry(id))])]) : "";
  useEffect(() => {
    if (!signature) return;
    let current = true;
    void findAlbumNearRecordings(albumTracks, tracks, () => current)
      .then(async found => {
        const matches = found.filter(match => !trackEditHistory.hasEditsFor(Object.keys(match.proposals)));
        if (!current || !matches.length) return;
        let linked: Record<string, TrackData> = {};
        try {
          await flushLocalPersistence();
          for (const match of matches) {
            if (!current || account !== getTagifyDatabaseName()) return;
            try {
              const changes = await indexedDBStorage.linkRecordings(match.proposals, match.uri, false, { confirmSimilar: true, expectedDatabaseName: account });
              trackEditHistory.resetForTracks(Object.keys(changes));
              linked = { ...linked, ...changes };
            } catch (error) { console.debug("Tagify: Couldn't link another version of an album song", error); }
          }
        } finally {
          if (Object.keys(linked).length && account === getTagifyDatabaseName()) await changed.current(linked);
        }
      })
      .catch(error => console.debug("Tagify: Couldn't check this album for other versions of its songs", error));
    return () => { current = false; };
  }, [signature]);
}
