import type { TrackData } from "@/types/tagData";
import { normalizeRecordingIdentity, recordingAnnotations, recordingConflict, recordingName, sameRecording } from "./recordingReuse";

export type RecordingSet = { key: string; entries: [string, TrackData][] };
export type RecordingChoices = Pick<TrackData, "tagIds" | "rating" | "energy">;
export const isSpotifySong = (uri: string) => /^spotify:track:[A-Za-z0-9]{22}$/.test(uri);

/** Candidate titles are only a lookup optimization, never evidence for combining music. */
export function recordingCandidates(tracks: Record<string, TrackData>) {
  const titles = new Map<string, string[]>();
  for (const [uri, data] of Object.entries(tracks)) {
    if (!isSpotifySong(uri) || data.recordingReuseDisabled) continue;
    const title = recordingName(data.recordingIdentity?.name || data.name || "");
    if (!title) continue;
    const members = titles.get(title) || [];
    members.push(uri); titles.set(title, members);
  }
  return [...titles.values()].filter(members => members.length > 1).map(members => members.sort());
}

export function confirmedRecordingSets(tracks: Record<string, TrackData>): RecordingSet[] {
  const buckets = new Map<string, RecordingSet[]>();
  for (const [uri, data] of Object.entries(tracks).sort(([a], [b]) => a.localeCompare(b))) {
    const identity = normalizeRecordingIdentity(data.recordingIdentity);
    if (!isSpotifySong(uri) || data.recordingReuseDisabled || !identity) continue;
    const key = JSON.stringify([identity.isrc, identity.artistIds, recordingName(identity.name)]);
    const sets = buckets.get(key) || [];
    // Every pair must fit the duration tolerance; a chain of near matches is unsafe.
    let set = sets.find(candidate => candidate.entries.every(([, member]) => sameRecording(identity, member.recordingIdentity)));
    if (!set) { set = { key: uri, entries: [] }; sets.push(set); buckets.set(key, sets); }
    set.entries.push([uri, data]);
  }
  return [...buckets.values()].flat().filter(set => set.entries.length > 1);
}

export const hasRecordingConflict = (set: RecordingSet) => set.entries.some(([, a]) => set.entries.some(([, b]) => recordingConflict(a, b)));

/** Only confirmed, consistent links collapse. Unreviewed choices remain visible. */
export function recordingDisplayKeys(tracks: Record<string, TrackData>) {
  const keys = new Map<string, string>();
  const groups = new Map<string, [string, TrackData][]>();
  for (const entry of Object.entries(tracks)) {
    const group = entry[1].recordingGroupId;
    if (!group || entry[1].recordingReuseDisabled || !isSpotifySong(entry[0])) continue;
    const members = groups.get(group) || []; members.push(entry); groups.set(group, members);
  }
  for (const [group, members] of groups) {
    if (!members.every(([, a]) => members.every(([, b]) => sameRecording(a.recordingIdentity, b.recordingIdentity) && recordingAnnotations(a) === recordingAnnotations(b)))) continue;
    members.forEach(([uri]) => keys.set(uri, group));
  }
  return keys;
}

export function collapseRecordingEntries<T extends TrackData>(entries: [string, T][], keys: Map<string, string>) {
  const seen = new Set<string>();
  return entries.filter(([uri]) => { const key = keys.get(uri) || uri; if (seen.has(key)) return false; seen.add(key); return true; });
}
