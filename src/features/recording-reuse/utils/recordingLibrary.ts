import type { TrackData } from "@/types/tagData";
import { baseRecordingName, compatibleRecordingLinks, normalizeRecordingIdentity, recordingConflict, recordingName, sameRecording, visibleRecordingAnnotations } from "./recordingReuse";

export type RecordingSet = { key: string; entries: [string, TrackData][] };
export type RecordingChoices = Pick<TrackData, "tagIds" | "rating" | "energy">;
export const isSpotifySong = (uri: string) => /^spotify:track:[A-Za-z0-9]{22}$/.test(uri);

/**
 * Songs that might be copies of one recording: the same title once "(feat. …)" and
 * "[From …]" credits are removed, or the same ISRC when it is already known. Only a lookup
 * optimization, never evidence for combining music.
 */
export function recordingCandidates(tracks: Record<string, TrackData>) {
  const parent = new Map<string, string>();
  const root = (key: string): string => { const up = parent.get(key) ?? key; if (up === key) return key; const top = root(up); parent.set(key, top); return top; };
  const join = (a: string, b: string) => { parent.set(a, parent.get(a) ?? a); parent.set(b, parent.get(b) ?? b); parent.set(root(a), root(b)); };
  for (const [uri, data] of Object.entries(tracks)) {
    if (!isSpotifySong(uri) || data.recordingReuseDisabled) continue;
    const title = baseRecordingName(data.recordingIdentity?.name || data.name || "");
    if (title) join(uri, `title:${title}`);
    if (data.recordingIdentity?.isrc) join(uri, `isrc:${data.recordingIdentity.isrc}`);
  }
  const groups = new Map<string, string[]>();
  for (const key of parent.keys()) {
    if (!key.startsWith("spotify:")) continue;
    const members = groups.get(root(key)) || []; members.push(key); groups.set(root(key), members);
  }
  return [...groups.values()].filter(members => members.length > 1).map(members => members.sort());
}

export function confirmedRecordingSets(tracks: Record<string, TrackData>): RecordingSet[] {
  const buckets = new Map<string, RecordingSet[]>();
  const sets: RecordingSet[] = [];
  for (const [uri, data] of Object.entries(tracks).sort(([a], [b]) => a.localeCompare(b))) {
    const identity = normalizeRecordingIdentity(data.recordingIdentity);
    if (!isSpotifySong(uri) || data.recordingReuseDisabled || !identity) continue;
    // Copies share an ISRC, or (for reissues under a new ISRC) the same artists and title.
    const keys = [`isrc:${identity.isrc}`, JSON.stringify([identity.artistIds, recordingName(identity.name)])];
    // Every pair must match; a chain of near matches is unsafe.
    let set = keys.flatMap(key => buckets.get(key) || []).find(candidate => candidate.entries.every(([, member]) => sameRecording(identity, member.recordingIdentity)));
    if (!set) { set = { key: uri, entries: [] }; sets.push(set); }
    set.entries.push([uri, data]);
    for (const key of keys) { const bucket = buckets.get(key) || []; if (!bucket.includes(set)) bucket.push(set); buckets.set(key, bucket); }
  }
  return sets.filter(set => set.entries.length > 1);
}

export const hasRecordingConflict = (set: RecordingSet) => set.entries.some(([, a]) => set.entries.some(([, b]) => recordingConflict(a, b)));

/**
 * Only confirmed, consistent links collapse. Unreviewed choices remain visible.
 * Pass the tag list's IDs so a tag left over on one copy doesn't show the song twice.
 */
export function recordingDisplayKeys(tracks: Record<string, TrackData>, validTagIds?: ReadonlySet<string>) {
  const keys = new Map<string, string>();
  const groups = new Map<string, [string, TrackData][]>();
  for (const entry of Object.entries(tracks)) {
    const group = entry[1].recordingGroupId;
    if (!group || entry[1].recordingReuseDisabled || !isSpotifySong(entry[0])) continue;
    const members = groups.get(group) || []; members.push(entry); groups.set(group, members);
  }
  for (const [group, members] of groups) {
    if (!members.every(([, a]) => members.every(([, b]) => compatibleRecordingLinks(a, b) && visibleRecordingAnnotations(a, validTagIds) === visibleRecordingAnnotations(b, validTagIds)))) continue;
    members.forEach(([uri]) => keys.set(uri, group));
  }
  return keys;
}

export function collapseRecordingEntries<T extends TrackData>(entries: [string, T][], keys: Map<string, string>) {
  const seen = new Set<string>();
  return entries.filter(([uri]) => { const key = keys.get(uri) || uri; if (seen.has(key)) return false; seen.add(key); return true; });
}
