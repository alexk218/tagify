import React, { useEffect, useRef, useState } from "react";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import type { RecordingIdentity, TagTaxonomy, TrackData } from "@/types/tagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence } from "@/services/sync/SyncLocalState";
import { recordingAnnotations, recordingConflict, recordingName, sameRecording } from "../utils/recordingReuse";
import styles from "./RecordingReuse.module.css";

type Proposal = { identity: RecordingIdentity; annotations: string; details?: Partial<TrackData> };
export function RecordingReuse({ track, tracks, taxonomy, onChanged }: { track: SpotifyTrack; tracks: Record<string, TrackData>; taxonomy: TagTaxonomy; onChanged: (changes: Record<string, TrackData>) => Promise<void> }) {
  const current = tracks[track.uri];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [reviewed, setReviewed] = useState<Record<string, TrackData>>({});
  const [source, setSource] = useState("");
  const [replace, setReplace] = useState(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const conflict = Object.values(reviewed).some(a => Object.values(reviewed).some(b => recordingConflict(a, b)));
  const members = current?.recordingGroupId ? Object.entries(tracks).filter(([, value]) => value.recordingGroupId === current.recordingGroupId) : [];
  const check = async () => {
    setBusy(true); setMessage(""); setProposals({}); setReplace(false);
    controller.current = new AbortController();
    try {
      await flushLocalPersistence();
      const saved = (await indexedDBStorage.loadAllStrict()).tracks;
      const identity = await spotifyApiService.getRecordingIdentity(track.uri, controller.current.signal);
      if (!identity) throw new Error("Spotify hasn't provided enough information to confirm this recording.");
      const candidates = Object.entries(saved).filter(([uri, data]) => uri !== track.uri && !data.recordingReuseDisabled && /^spotify:track:/.test(uri) && recordingName(data.name || "") === recordingName(identity.name));
      const matches: Record<string, Proposal> = { [track.uri]: { identity, annotations: recordingAnnotations(saved[track.uri]), details: { name: track.name, artists: track.artists.map(artist => artist.name).join(", "), albumName: track.album?.name, albumUri: track.album?.uri, albumImageUrl: track.album?.images?.[0]?.url } } };
      for (const [uri, data] of candidates) {
        const candidate = await spotifyApiService.getRecordingIdentity(uri, controller.current.signal);
        if (sameRecording(identity, candidate)) matches[uri] = { identity: candidate!, annotations: recordingAnnotations(data) };
      }
      if (!mounted.current) return;
      const matchedSaved = Object.fromEntries(Object.entries(saved).filter(([uri]) => uri in matches));
      setReviewed(matchedSaved); setProposals(matches); setSource(Object.keys(matchedSaved)[0] || "");
      setMessage(Object.keys(matches).length > 1 ? `${Object.keys(matches).length} releases confirmed. Review their tagging before linking.` : "No other saved releases could be confirmed. Tag another release first, then check again.");
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Couldn't check the recording. Please try again.");
    } finally { if (mounted.current) setBusy(false); }
  };
  const save = async (unlink: boolean, disabled = true) => {
    setBusy(true); setMessage("");
    try {
      await flushLocalPersistence();
      const changes = unlink ? await indexedDBStorage.unlinkRecording(track.uri, disabled) : await indexedDBStorage.linkRecordings(proposals, source, replace);
      await onChanged(changes);
      if (mounted.current) { setProposals({}); setMessage(unlink ? disabled ? "This release keeps its tagging and will stay separate." : "You can check for matching releases again." : "Releases linked. Tag, rating, and energy edits now apply to all linked releases."); }
    } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : "Couldn't save this change. Please try again."); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (!/^spotify:track:/.test(track.uri)) return null;
  return <details className={styles.panel}>
    <summary>Other releases of this recording{members.length > 1 ? ` · ${members.length} linked` : ""}</summary>
    <p>Reuse tags, ratings, and energy across confirmed copies of the same recording. Linked edits apply to every linked release. Links are saved on this device and in file backups.</p>
    {members.length > 1 && <ul>{members.map(([uri, data]) => <li key={uri}>{data.albumName || data.name || "Saved release"}{uri === track.uri ? " · This release" : ""}</li>)}</ul>}
    {current?.recordingReuseDisabled ? <button disabled={busy} onClick={() => void save(true, false)}>Allow recording reuse</button> : <>
      <button disabled={busy} onClick={() => void check()}>{busy ? "Checking or saving…" : "Check saved releases"}</button>
      {current && <button disabled={busy} onClick={() => void save(true)}>{members.length > 1 ? "Unlink this release" : "Keep this release separate"}</button>}
    </>}
    {message && <p role="status">{message}</p>}
    {Object.keys(proposals).length > 1 && <div>
      <ul>{Object.keys(proposals).map(uri => <li key={uri}>{reviewed[uri]?.albumName || (uri === track.uri ? track.album?.name : null) || "Saved release"}{uri === track.uri ? " · This release" : ""} · Rating {reviewed[uri]?.rating || "unset"} · Energy {reviewed[uri]?.energy || "unset"} · Tags: {reviewed[uri]?.tagIds.map(id => taxonomy.tagsById[id]?.name || "Unavailable tag").join(", ") || "none"}</li>)}</ul>
      {conflict && <>
        <p>These releases have different tagging. Choose one release to keep its tags, rating, and energy for all of them.</p>
        <label>Keep tagging from <select aria-label="Recording tagging to keep" value={source} onChange={event => { setSource(event.target.value); setReplace(false); }} disabled={busy}>
          {Object.keys(reviewed).map(uri => <option value={uri} key={uri}>{reviewed[uri].albumName || reviewed[uri].name || "Saved release"}</option>)}
        </select></label>
        <label><input type="checkbox" checked={replace} disabled={busy} onChange={event => setReplace(event.target.checked)} /> Replace different tagging with this release's tags, rating, and energy</label>
      </>}
      <button disabled={busy || !source || (conflict && !replace)} onClick={() => void save(false)}>Link confirmed releases</button>
    </div>}
  </details>;
}
