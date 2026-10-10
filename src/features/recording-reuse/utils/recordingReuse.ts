import type { RecordingIdentity, TrackData } from "@/types/tagData";

export const recordingName = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
export function normalizeRecordingIdentity(value: unknown): RecordingIdentity | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Partial<RecordingIdentity>;
  if (typeof v.isrc !== "string" || !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(v.isrc) ||
    !Array.isArray(v.artistIds) || !v.artistIds.length || !v.artistIds.every(id => typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id)) ||
    typeof v.durationMs !== "number" || !Number.isFinite(v.durationMs) || v.durationMs <= 0 || typeof v.name !== "string" || !v.name.trim()) return;
  return { isrc: v.isrc, artistIds: [...new Set(v.artistIds)].sort(), durationMs: v.durationMs, name: v.name };
}
export function sameRecording(a?: RecordingIdentity, b?: RecordingIdentity): boolean {
  return !!a && !!b && a.isrc === b.isrc && JSON.stringify([...a.artistIds].sort()) === JSON.stringify([...b.artistIds].sort()) &&
    Math.abs(a.durationMs - b.durationMs) <= 1000 && recordingName(a.name) === recordingName(b.name);
}
const fields = ["rating", "energy", "tagIds"] as const;
const equalField = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
export const recordingAnnotations = (track: TrackData | undefined) => JSON.stringify([track?.rating || 0, track?.energy || 0, [...(track?.tagIds || [])].sort()]);
export function recordingConflict(a: TrackData | undefined, b: TrackData | undefined) {
  return !!a && !!b && fields.some(field => {
    const av = a[field], bv = b[field];
    return (Array.isArray(av) ? av.length > 0 : av > 0) && (Array.isArray(bv) ? bv.length > 0 : bv > 0) && !equalField(av, bv);
  });
}

/** A restored independent cloud copy must not inherit a conflicting local link. */
export function detachInconsistentRecordingGroups(tracks: Record<string, TrackData>) {
  const groups = new Map<string, TrackData[]>();
  Object.values(tracks).forEach(track => {
    if (track.recordingGroupId) {
      const members = groups.get(track.recordingGroupId) || [];
      members.push(track); groups.set(track.recordingGroupId, members);
    }
  });
  const invalid = new Set([...groups].filter(([, members]) => members.some(track => recordingAnnotations(track) !== recordingAnnotations(members[0]) || !sameRecording(track.recordingIdentity, members[0].recordingIdentity))).map(([id]) => id));
  return Object.fromEntries(Object.entries(tracks).map(([uri, track]) => [uri, track.recordingGroupId && invalid.has(track.recordingGroupId) ? { ...track, recordingGroupId: undefined } : track]));
}

/** Copy only changed annotation fields; each release retains its own metadata. */
export function expandRecordingEdits(current: Record<string, TrackData>, changes: Record<string, TrackData | null>) {
  const result = { ...changes };
  const updates = new Map<string, Partial<Pick<TrackData, "rating" | "energy" | "tagIds">>>();
  const membersByGroup = new Map<string, TrackData[]>();
  Object.values(current).forEach(track => {
    if (!track.recordingGroupId) return;
    const members = membersByGroup.get(track.recordingGroupId) || [];
    members.push(track); membersByGroup.set(track.recordingGroupId, members);
  });
  const validated = new Set<string>();
  const now = Date.now();
  for (const [uri, after] of Object.entries(changes)) {
    const before = current[uri];
    const group = before?.recordingGroupId;
    if (!group || !after || after.recordingGroupId !== group || after.recordingReuseDisabled) continue;
    if (!validated.has(group) && membersByGroup.get(group)?.some(member => !sameRecording(before.recordingIdentity, member.recordingIdentity))) throw new Error("These linked releases can no longer be confirmed. Unlink them before editing their tagging.");
    validated.add(group);
    const delta = updates.get(group) || {};
    for (const field of fields) {
      if (equalField(before[field], after[field])) continue;
      if (field in delta && !equalField(delta[field], after[field])) throw new Error("Linked releases have different changes. Unlink them before saving different tagging.");
      Object.assign(delta, { [field]: after[field] });
    }
    updates.set(group, delta);
  }
  for (const [uri, before] of Object.entries(current)) {
    const delta = before.recordingGroupId && updates.get(before.recordingGroupId);
    if (!delta || before.recordingReuseDisabled || !Object.keys(delta).length || result[uri] === null) continue;
    const after = result[uri] || before;
    if (after.recordingGroupId !== before.recordingGroupId) continue;
    if (fields.some(field => field in delta && !equalField(after[field], delta[field]))) result[uri] = { ...after, ...delta, dateModified: now };
  }
  return result;
}
