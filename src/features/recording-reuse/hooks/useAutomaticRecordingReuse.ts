import { useEffect, useRef } from "react";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { RecordingIdentity, TrackData } from "@/types/tagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { recordingAnnotations, recordingConflict, recordingName, sameRecording } from "../utils/recordingReuse";
const cache = new Map<string, { until: number; identity: Promise<RecordingIdentity | undefined> }>();
function identityFor(uri: string, saved?: RecordingIdentity) {
  if (saved) return Promise.resolve(saved);
  const existing = cache.get(uri);
  if (existing && existing.until > Date.now()) return existing.identity;
  // Failed checks are cached too; navigation must not hammer an unavailable Spotify API.
  const identity = spotifyApiService.getRecordingIdentity(uri).catch(() => undefined);
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(uri, { until: Date.now() + 5 * 60 * 1000, identity });
  return identity;
}
export function useAutomaticRecordingReuse(track: SpotifyTrack | null, tracks: Record<string, TrackData>, onChanged: (changes: Record<string, TrackData>) => Promise<void>) {
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;
  const uri = track?.uri || "";
  const name = track?.name || "";
  const account = getTagifyDatabaseName();
  const candidates = Object.entries(tracks).filter(([otherUri, data]) => otherUri !== uri && /^spotify:track:[A-Za-z0-9]{22}$/.test(otherUri) && !data.recordingReuseDisabled && recordingName(data.name || "") === recordingName(name));
  const signature = JSON.stringify([account, uri, tracks[uri]?.recordingReuseDisabled, tracks[uri]?.recordingGroupId, tracks[uri]?.recordingIdentity, recordingAnnotations(tracks[uri]), candidates.map(([otherUri, data]) => [otherUri, data.recordingGroupId, data.recordingIdentity, recordingAnnotations(data)])]);
  useEffect(() => {
    if (!track || !/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) || tracks[uri]?.recordingReuseDisabled || !candidates.length || candidates.every(([, data]) => !!tracks[uri]?.recordingGroupId && data.recordingGroupId === tracks[uri].recordingGroupId)) return;
    let current = true;
    const active = () => current && account === getTagifyDatabaseName();
    void (async () => {
      await flushLocalPersistence();
      if (!active()) return;
      const saved = (await indexedDBStorage.loadAllStrict()).tracks;
      if (!active() || saved[uri]?.recordingReuseDisabled) return;
      const identity = await identityFor(uri, saved[uri]?.recordingIdentity);
      if (!identity || !active()) return;
      const proposals: Record<string, { identity: RecordingIdentity; annotations: string; details?: Partial<TrackData> }> = {
        [uri]: { identity, annotations: recordingAnnotations(saved[uri]), details: { name: track.name, artists: track.artists.map(artist => artist.name).join(", "), albumName: track.album?.name, albumUri: track.album?.uri, albumImageUrl: track.album?.images?.[0]?.url } },
      };
      const matched: TrackData[] = saved[uri] ? [saved[uri]] : [];
      for (const [otherUri] of candidates) {
        if (!active()) return;
        const data = saved[otherUri];
        if (!data || data.recordingReuseDisabled) continue;
        const other = await identityFor(otherUri, data.recordingIdentity);
        if (!active()) return;
        if (!sameRecording(identity, other)) continue;
        if (matched.some(member => recordingConflict(member, data))) return;
        matched.push(data);
        proposals[otherUri] = { identity: other!, annotations: recordingAnnotations(data) };
      }
      if (!active() || Object.keys(proposals).length < 2) return;
      if (trackEditHistory.hasEditsFor(Object.keys(proposals))) return;
      await flushLocalPersistence();
      if (!active()) return;
      const changes = await indexedDBStorage.linkRecordings(proposals, matched.length ? Object.keys(proposals).find(id => !!saved[id])! : uri, false, { automatic: true, expectedDatabaseName: account, isCurrent: () => active() && !trackEditHistory.hasEditsFor(Object.keys(proposals)) });
      if (active()) await onChangedRef.current(changes);
    })().catch(error => { if (active()) console.debug("Tagify: Recording reuse left releases separate", error); });
    return () => { current = false; };
    // The signature includes the current account, annotations, opt-outs and matching candidates.
  }, [signature]);
}
