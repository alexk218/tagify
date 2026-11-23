import { useEffect, useRef, useState } from "react";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { TrackData } from "@/types/tagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { findNearRecording, nearRecordingCandidates, type NearRecordingMatch, type RecordingReuseStatus } from "../services/automaticRecordingReuse";
import { recordingAnnotations } from "../utils/recordingReuse";

type Changed = (changes: Record<string, TrackData>, syncChanges?: Record<string, TrackData>) => Promise<void>;

/**
 * Links the song on the song card to a saved other release of it (a single and its album
 * cut, for example) when Spotify reports the same play count for both. Nothing is shown:
 * a song that doesn't qualify stays unlinked. Waits for the automatic check, which links
 * exact copies on its own. Returns the match it linked, for the album check on this card.
 */
export function useNearRecording(track: SpotifyTrack | null, tracks: Record<string, TrackData>, automaticStatus: RecordingReuseStatus, onChanged: Changed) {
  const changed = useRef(onChanged); changed.current = onChanged;
  const [linked, setLinked] = useState<NearRecordingMatch>();
  const uri = track?.uri || "";
  const account = getTagifyDatabaseName();
  useEffect(() => setLinked(undefined), [account, uri]);
  const entry = (id: string) => [id, tracks[id]?.recordingGroupId, tracks[id]?.recordingNotSameAs, tracks[id]?.recordingIdentity, tracks[id]?.name, recordingAnnotations(tracks[id])];
  const candidates = track ? nearRecordingCandidates({ uri, name: track.name }, tracks) : [];
  const signature = track && automaticStatus !== "checking"
    ? JSON.stringify([account, track.name, entry(uri), candidates.map(([id]) => entry(id))]) : "";
  useEffect(() => {
    if (!track || !signature) return;
    let current = true;
    void findNearRecording({ uri, name: track.name, details: {
      artists: track.artists.map(artist => artist.name).join(", "), albumName: track.album?.name,
      albumUri: track.album?.uri, albumImageUrl: track.album?.images?.[0]?.url,
    } }, tracks, () => current).then(async found => {
      // Never overwrite an edit that hasn't saved yet.
      if (!current || !found || trackEditHistory.hasEditsFor(Object.keys(found.proposals))) return;
      await flushLocalPersistence();
      if (!current || account !== getTagifyDatabaseName()) return;
      const changes = await indexedDBStorage.linkRecordings(found.proposals, found.uri, false, { confirmSimilar: true, expectedDatabaseName: account });
      trackEditHistory.resetForTracks(Object.keys(changes));
      setLinked(found);
      if (account === getTagifyDatabaseName()) await changed.current(changes);
    })
      .catch(error => console.debug("Tagify: Couldn't link another version of this song", error));
    return () => { current = false; };
  }, [signature]);

  return { linked, hasCandidates: candidates.length > 0 };
}
