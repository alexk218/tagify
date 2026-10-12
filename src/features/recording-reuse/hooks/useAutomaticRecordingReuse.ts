import { useEffect, useRef, useState } from "react";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { TrackData } from "@/types/tagData";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { checkAutomaticRecordingReuse, getRecordingReuseStatus, getRecordingReuseRetryAt, RECORDING_REUSE_EVENT, recordingReuseSignature } from "../services/automaticRecordingReuse";

export function useAutomaticRecordingReuse(track: SpotifyTrack | null, tracks: Record<string, TrackData>, onChanged: (changes: Record<string, TrackData>, syncChanges?: Record<string, TrackData>) => Promise<void>) {
  const changed = useRef(onChanged); changed.current = onChanged;
  const uri = track?.uri || "";
  const account = getTagifyDatabaseName();
  const signature = track ? recordingReuseSignature(track, tracks) : "";
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState(() => getRecordingReuseStatus(uri));
  useEffect(() => {
    const update = () => setStatus(getRecordingReuseStatus(uri));
    update();
    window.addEventListener(RECORDING_REUSE_EVENT, update);
    return () => window.removeEventListener(RECORDING_REUSE_EVENT, update);
  }, [account, uri]);
  useEffect(() => {
    if (!uri || status !== "unavailable") return;
    const timer = setTimeout(() => setRetry(value => value + 1), Math.max(1000, getRecordingReuseRetryAt(uri) - Date.now()));
    return () => clearTimeout(timer);
  }, [account, uri, status, retry]);
  useEffect(() => {
    if (!track) return;
    let current = true;
    void checkAutomaticRecordingReuse({ uri, name: track.name, details: {
      artists: track.artists.map(artist => artist.name).join(", "), albumName: track.album?.name,
      albumUri: track.album?.uri, albumImageUrl: track.album?.images?.[0]?.url,
    } }, tracks, (changes, syncChanges) => changed.current(changes, syncChanges), () => current);
    return () => { current = false; };
  }, [signature, retry]);
  return status;
}
