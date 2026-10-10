import type { TrackData } from "@/types/tagData";
import { isTrackEmpty } from "@/features/tag-data";

export interface BulkUndoEntry {
  automaticRuleIds?: string[];
  id: string;
  createdAt: number;
  changes: Record<string, { before: TrackData | null; after: TrackData | null }>;
}
const fields = ["rating", "energy", "bpm", "camelotKey", "tagIds"] as const;
const empty: TrackData = { rating: 0, energy: 0, bpm: null, tagIds: [] };
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Restore only fields whose value still matches the completed bulk save. */
export function restoreBulkTrack(current: TrackData | null, before: TrackData | null, after: TrackData | null, validTagIds?: Set<string>) {
  const previous = before || empty;
  const saved = after || empty;
  const live = current || empty;
  const next = { ...(current || before || empty) };
  let restored = 0;
  let skipped = 0;
  fields.forEach((field) => {
    if (equal(previous[field], saved[field])) return;
    if (field === "tagIds" && validTagIds && previous.tagIds.some((id) => !validTagIds.has(id))) { skipped++; return; }
    if (!equal(live[field], saved[field])) { skipped++; return; }
    Object.assign(next, { [field]: previous[field] });
    restored++;
  });
  if (!restored) return { track: current, restored, skipped };
  if (fields.every((field) => equal(next[field], previous[field]))) {
    next.dateCreated = before?.dateCreated;
    next.dateModified = before?.dateModified;
  }
  return { track: isTrackEmpty(next) ? null : next, restored, skipped };
}
