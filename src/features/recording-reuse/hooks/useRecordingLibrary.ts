import { useEffect, useMemo, useRef, useState } from "react";
import type { TrackData } from "@/types/tagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName, isLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { confirmedRecordingSets, hasRecordingConflict, recordingCandidates } from "../utils/recordingLibrary";
import { recordingAnnotations } from "../utils/recordingReuse";

/** Identity itself is the resumable checkpoint; only possible duplicate titles need requests. */
export function useRecordingLibrary(tracks: Record<string, TrackData>, enabled: boolean, onChanged: (changes: Record<string, TrackData>) => Promise<void>) {
  const account = getTagifyDatabaseName();
  const changed = useRef(onChanged); changed.current = onChanged;
  const failedChecks = useRef(new Map<string, number>());
  const [retry, setRetry] = useState(0);
  const candidates = useMemo(() => recordingCandidates(tracks), [tracks]);
  const signature = JSON.stringify([account, candidates.map(members => members.map(uri => [uri, tracks[uri].recordingIdentity, tracks[uri].recordingGroupId, recordingAnnotations(tracks[uri])]))]);
  const conflicts = useMemo(() => confirmedRecordingSets(tracks).filter(hasRecordingConflict), [tracks]);
  useEffect(() => {
    const resume = () => setRetry(value => value + 1);
    window.addEventListener("online", resume);
    window.addEventListener("tagify:localPersistence", resume);
    return () => { window.removeEventListener("online", resume); window.removeEventListener("tagify:localPersistence", resume); };
  }, []);
  useEffect(() => {
    let session = trackEditHistory.getSnapshot().session?.id;
    return trackEditHistory.subscribe(() => {
      const next = trackEditHistory.getSnapshot().session?.id;
      if (next !== session) { session = next; setRetry(value => value + 1); }
    });
  }, []);
  useEffect(() => {
    if (!enabled || !candidates.length || isLocalPersistencePaused()) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => !controller.signal.aborted && account === getTagifyDatabaseName() && !isLocalPersistencePaused();
    const failed = (key: string) => {
      if (failedChecks.current.size >= 1000) failedChecks.current.delete(failedChecks.current.keys().next().value!);
      failedChecks.current.set(key, Date.now() + 5 * 60_000);
    };
    void (async () => {
      let incomplete = false;
      for (const members of candidates) {
        if (!active()) return;
        if (members.every(uri => tracks[uri].recordingIdentity) && confirmedRecordingSets(Object.fromEntries(members.map(uri => [uri, tracks[uri]]))).every(set => hasRecordingConflict(set) || set.entries.every(([, data]) => data.recordingGroupId && data.recordingGroupId === set.entries[0][1].recordingGroupId))) continue;
        await flushLocalPersistence();
        const saved = (await indexedDBStorage.loadAllStrict()).tracks;
        if (!active()) return;
        const identities: Record<string, NonNullable<TrackData["recordingIdentity"]>> = {};
        let stopRequests = false;
        for (const uri of members) {
          if (!active()) return;
          if (!saved[uri] || saved[uri].recordingReuseDisabled || saved[uri].recordingIdentity) continue;
          const checkKey = `${account}:${uri}`;
          if ((failedChecks.current.get(checkKey) || 0) > Date.now()) { incomplete = true; continue; }
          try {
            const identity = await spotifyApiService.getRecordingIdentity(uri, controller.signal);
            if (identity) identities[uri] = identity;
            else { incomplete = true; failed(checkKey); }
          } catch {
            incomplete = true; stopRequests = true;
            if (!controller.signal.aborted) failed(checkKey);
            break;
          } // Spotify outages/rate limits stop further requests this pass.
        }
        if (!active()) return;
        if (Object.keys(identities).length) {
          await flushLocalPersistence();
          if (!active()) return;
          const updates = await indexedDBStorage.rememberRecordingIdentities(identities, account);
          if (!active()) return;
          if (Object.keys(updates).length) await changed.current(updates);
        }
        await flushLocalPersistence();
        if (!active()) return;
        const latest = (await indexedDBStorage.loadAllStrict()).tracks;
        if (!active()) return;
        for (const set of confirmedRecordingSets(Object.fromEntries(members.filter(uri => latest[uri]).map(uri => [uri, latest[uri]])))) {
          if (hasRecordingConflict(set) || set.entries.every(([, data]) => data.recordingGroupId && data.recordingGroupId === set.entries[0][1].recordingGroupId)) continue;
          const uris = set.entries.map(([uri]) => uri);
          if (trackEditHistory.hasEditsFor(uris)) { incomplete = true; continue; }
          const proposals = Object.fromEntries(set.entries.map(([uri, data]) => [uri, { identity: data.recordingIdentity!, annotations: recordingAnnotations(data) }]));
          if (!active()) return;
          try {
            const updates = await indexedDBStorage.linkRecordings(proposals, set.entries[0][0], false, { automatic: true, expectedDatabaseName: account, isCurrent: () => active() && !trackEditHistory.hasEditsFor(uris) });
            if (active()) await changed.current(updates);
          } catch { incomplete = true; } // Concurrent edits are rechecked from their latest saved choices.
        }
        if (stopRequests) break;
      }
      if (active() && incomplete) timer = setTimeout(() => setRetry(value => value + 1), 5 * 60_000);
    })().catch(error => { if (active()) { console.debug("Tagify: Duplicate-song check will resume later", error); timer = setTimeout(() => setRetry(value => value + 1), 5 * 60_000); } });
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
    // A compact signature avoids restarting on unrelated album/artwork updates.
  }, [account, signature, enabled, retry]);
  return conflicts;
}
