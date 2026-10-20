import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { TrackData } from "@/types/tagData";
import { restoreBulkTrack, type DraftTagState } from "@/features/multi-track-tagging";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { buildValidTagIdSet } from "@/utils/tagTaxonomy";
import { isTypingOrDialogTarget } from "@/utils/keyboardTargets";
import { draftTracks, editSelectionKey, trackEditHistory, type EditMode, type TrackEditEntry } from "@/services/TrackEditHistory";

export function useTrackEditHistory(mode: EditMode, uris: string[], options: {
  draft: DraftTagState | null;
  replaceDraft: (draft: DraftTagState) => void;
  onSaved: (changes: Record<string, TrackData | null>) => Promise<void>;
}) {
  const key = editSelectionKey(mode, uris);
  const latest = useRef(options); latest.current = options;
  const state = useSyncExternalStore(trackEditHistory.subscribe, trackEditHistory.getSnapshot);
  // The canonical key ignores array identity/order but includes mode, membership, and account.
  useLayoutEffect(() => { trackEditHistory.select(mode, uris); }, [key]);
  useEffect(() => () => trackEditHistory.clear(), []);
  useEffect(() => {
    const imported = (event: Event) => {
      if ((event as CustomEvent<{ type?: string }>).detail?.type !== "import") return;
      trackEditHistory.clear(); trackEditHistory.select(mode, uris);
    };
    window.addEventListener("tagify:dataUpdated", imported);
    return () => window.removeEventListener("tagify:dataUpdated", imported);
  }, [key]);
  const restore = async (direction: "undo" | "redo") => {
    const operation = trackEditHistory.begin(direction);
    if (!operation) return;
    const { session, entry } = operation;
    const current = () => trackEditHistory.isPending(session, direction, entry.id);
    try {
      await flushLocalPersistence();
      if (!current()) return;
      let result: { changes: Record<string, TrackData | null>; previous: Record<string, TrackData | null>; skippedFields: number };
      if (entry.kind === "draft") {
        const snapshot = await indexedDBStorage.loadAllStrict();
        if (!current()) return;
        const validTags = buildValidTagIdSet(snapshot.taxonomy);
        const previous = draftTracks(latest.current.draft);
        const changes: Record<string, TrackData | null> = {};
        let skippedFields = 0;
        Object.entries(entry.changes).forEach(([uri, change]) => {
          const restored = restoreBulkTrack(previous[uri] || null, direction === "undo" ? change.before : change.after, direction === "undo" ? change.after : change.before, validTags);
          if (restored.restored) changes[uri] = restored.track;
          skippedFields += restored.skipped;
        });
        const draft = { ...latest.current.draft };
        Object.entries(changes).forEach(([uri, data]) => { draft[uri] = { tagIds: data?.tagIds || [], rating: data?.rating || 0, energy: data?.energy || 0 }; });
        latest.current.replaceDraft(draft);
        result = { changes, previous, skippedFields };
      } else {
        result = await indexedDBStorage.restoreTrackEdit(entry, direction, session.account, current);
        if (session.account === getTagifyDatabaseName()) await latest.current.onSaved(result.changes);
      }
      if (!current()) return;
      const opposite: TrackEditEntry = { id: crypto.randomUUID(), createdAt: Date.now(), kind: entry.kind, changes: Object.fromEntries(Object.entries(result.changes).map(([uri, after]) => [uri, direction === "undo" ? { before: after, after: result.previous[uri] || null } : { before: result.previous[uri] || null, after }])) };
      trackEditHistory.finish(session, direction, entry.id, opposite);
      if (result.skippedFields) Spicetify.showNotification("Kept values changed since that edit.");
    } catch (error) {
      if (current()) Spicetify.showNotification(error instanceof Error ? error.message : "That edit couldn't be restored. Please try again.", true);
    } finally { trackEditHistory.finish(session, direction, entry.id); }
  };
  const restoreRef = useRef(restore); restoreRef.current = restore;
  useEffect(() => {
    if (!mode) return;
    const keyboard = (event: KeyboardEvent) => {
      if (isTypingOrDialogTarget(event.target) || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const direction = key === "z" ? event.shiftKey ? "redo" : "undo" : key === "y" && event.ctrlKey ? "redo" : null;
      if (!direction || trackEditHistory.getSnapshot().busy || !trackEditHistory.getSnapshot()[direction].length) return;
      event.preventDefault(); void restoreRef.current(direction);
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [mode]);
  const active = state.session?.key === key;
  return { canUndo: active && state.undo.length > 0, canRedo: active && state.redo.length > 0, busy: active && state.busy, undo: () => void restore("undo"), redo: () => void restore("redo") };
}
