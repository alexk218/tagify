import type { DraftTagState, BulkUndoEntry } from "@/features/multi-track-tagging";
import type { TrackData } from "@/types/tagData";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";

export const draftTracks = (draft: DraftTagState | null): Record<string, TrackData> => Object.fromEntries(Object.entries(draft || {}).map(([uri, data]) => [uri, { ...data, bpm: null }]));
export type EditMode = "single" | "bulk" | null;
export type EditSession = { id: string; key: string; account: string; mode: EditMode; uris: string[] };
export type TrackEditEntry = BulkUndoEntry & { kind: "saved" | "draft" };
const annotation = (track?: TrackData | null) => JSON.stringify([track?.rating || 0, track?.energy || 0, track?.bpm ?? null, track?.camelotKey ?? null, [...(track?.tagIds || [])].sort()]);
export const editSelectionKey = (mode: EditMode, uris: string[], account = getTagifyDatabaseName()) => JSON.stringify([account, mode, [...new Set(uris)].sort()]);
/**
 * The songs whose annotations differ. With `uris`, only those songs are compared, so a
 * single-song edit doesn't compare the whole library; records that are the same object
 * on both sides are unchanged and skipped either way.
 */
export function editChanges(before: Record<string, TrackData | null>, after: Record<string, TrackData | null>, uris?: Iterable<string>) {
  const changes: BulkUndoEntry["changes"] = {};
  const compare = (uri: string) => {
    if (before[uri] === after[uri] || Object.hasOwn(changes, uri) || annotation(before[uri]) === annotation(after[uri])) return;
    changes[uri] = { before: structuredClone(before[uri] || null), after: structuredClone(after[uri] || null) };
  };
  if (uris) { for (const uri of uris) compare(uri); return changes; }
  for (const uri of Object.keys(after)) if (before[uri] !== after[uri]) compare(uri);
  for (const uri of Object.keys(before)) if (after[uri] === undefined) compare(uri);
  return changes;
}

/** Only the current visit to a song/selection is reversible. Saved music is never reset. */
export class TrackEditHistory {
  private listeners = new Set<() => void>();
  private state: { session: EditSession | null; undo: TrackEditEntry[]; redo: TrackEditEntry[]; busy: boolean } = { session: null, undo: [], redo: [], busy: false };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(state: typeof this.state) { this.state = state; this.listeners.forEach(listener => listener()); }
  select(mode: EditMode, uris: string[]) {
    const key = editSelectionKey(mode, uris);
    if (this.state.session?.key === key) return this.state.session;
    const session = { id: crypto.randomUUID(), key, account: getTagifyDatabaseName(), mode, uris: [...new Set(uris)].sort() };
    this.update({ session, undo: [], redo: [], busy: false });
    return session;
  }
  clear() { this.update({ session: null, undo: [], redo: [], busy: false }); }
  hasEditsFor(uris: string[]) {
    const affected = new Set(uris);
    return this.state.busy || [...this.state.undo, ...this.state.redo].some(entry => Object.keys(entry.changes).some(uri => affected.has(uri)));
  }
  resetForTracks(uris: string[]) {
    if (!this.state.session?.uris.some(uri => uris.includes(uri))) return;
    this.update({ session: { ...this.state.session, id: crypto.randomUUID() }, undo: [], redo: [], busy: false });
  }
  capture(mode: EditMode, uris: string[]) {
    const session = this.state.session;
    return session?.mode && session.key === editSelectionKey(mode, uris) ? session : null;
  }
  isCurrent(session: EditSession | null) { return !!session && this.state.session?.id === session.id && session.account === getTagifyDatabaseName(); }
  /** `uris` limits the comparison to the songs an edit touched; the session's own songs are always included. */
  record(session: EditSession | null, before: Record<string, TrackData | null>, after: Record<string, TrackData | null>, kind: TrackEditEntry["kind"], uris?: Iterable<string>) {
    if (!this.isCurrent(session)) return;
    const changes = editChanges(before, after, uris && new Set([...session!.uris, ...uris]));
    const undo = kind === "saved" && session?.mode === "bulk" ? this.state.undo.filter(entry => entry.kind !== "draft") : this.state.undo;
    if (!Object.keys(changes).length) { if (undo !== this.state.undo) this.update({ ...this.state, undo, redo: [] }); return; }
    const entry = { id: crypto.randomUUID(), createdAt: Date.now(), changes, kind };
    this.update({ ...this.state, undo: [...undo, entry].slice(-100), redo: [] });
  }
  discardDraft() { this.update({ ...this.state, undo: this.state.undo.filter(entry => entry.kind !== "draft"), redo: this.state.redo.filter(entry => entry.kind !== "draft") }); }
  hold(session: EditSession | null) { if (!this.isCurrent(session) || this.state.busy) return false; this.update({ ...this.state, busy: true }); return true; }
  release(session: EditSession | null) { if (this.isCurrent(session)) this.update({ ...this.state, busy: false }); }
  begin(direction: "undo" | "redo") {
    const entry = this.state[direction].at(-1);
    const session = this.state.session;
    if (!entry || this.state.busy || !this.isCurrent(session)) return null;
    this.update({ ...this.state, busy: true });
    return { session: session!, entry };
  }
  isPending(session: EditSession, direction: "undo" | "redo", id: string) { return this.isCurrent(session) && this.state[direction].at(-1)?.id === id; }
  finish(session: EditSession, direction: "undo" | "redo", id: string, opposite?: TrackEditEntry) {
    if (!this.isCurrent(session)) return;
    if (!this.isPending(session, direction, id)) { this.update({ ...this.state, busy: false }); return; }
    if (!opposite) { this.update({ ...this.state, busy: false }); return; }
    const other = direction === "undo" ? "redo" : "undo";
    this.update({ ...this.state, busy: false, [direction]: this.state[direction].slice(0, -1), [other]: Object.keys(opposite.changes).length ? [...this.state[other], opposite].slice(-100) : this.state[other] });
  }
}
export const trackEditHistory = new TrackEditHistory();
