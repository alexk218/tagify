import { useRef, useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { defaultTagData } from "@/constants/defaultTagData";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import { useTagDataPersistence } from "@/features/tag-data/hooks/useTagDataPersistence";
import { useTagDataTrackActions } from "@/features/tag-data/hooks/useTagDataTrackActions";
import { useMultiTrackTagging } from "@/features/multi-track-tagging/hooks/useMultiTrackTagging";
import type { TagDataStructure } from "@/types/tagData";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { useTrackEditHistory } from "@/features/track-session/history/useTrackEditHistory";
import { trackEditHistory } from "../TrackEditHistory";
vi.mock("@/features/tag-data/utils/tagData.backup", () => ({ isAutomaticFileBackupDue: () => false, maybeDownloadAutomaticTagDataFileBackup: () => ({ status: "skipped" }) }));
vi.mock("@/features/tag-data/utils/tagData.backupContents", () => ({ readCompleteBackupContents: async () => ({}) }));
const a = `spotify:track:${"a".repeat(22)}`, b = `spotify:track:${"b".repeat(22)}`, c = `spotify:track:${"c".repeat(22)}`;
const song = { name: "Song", artists: "Artist", rating: 1, energy: 2, bpm: 100, camelotKey: "8A", tagIds: [], dateCreated: 10, dateModified: 20 };
const seed: TagDataStructure = { ...defaultTagData, tracks: { [a]: song, [b]: song, [c]: song }, taxonomy: buildTaxonomyFromCategoryTree([{ id: "genre", name: "Genre", subcategories: [{ id: "styles", name: "Styles", tags: [{ id: "house", name: "House" }] }] }]) };
const house = Object.keys(seed.taxonomy.tagsById)[0];
beforeEach(async () => { localStorage.clear(); trackEditHistory.clear(); indexedDBStorage.resetConnection(); vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init(); await indexedDBStorage.saveAll(seed); });
afterEach(async () => {
  await act(async () => { await flushLocalPersistence(); });
  cleanup();
  await indexedDBStorage.loadAllStrict();
  trackEditHistory.clear(); indexedDBStorage.resetConnection(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function useEditor(initial = seed) {
  const [data, setData] = useState<TagDataStructure>(initial);
  const [selected, select] = useState(a);
  const [, setLastSaved] = useState<Date | null>(null);
  const latestTagDataRef = useRef(data);
  const persistedDataRef = useRef<TagDataStructure | null>(initial);
  const { showSavedLibrary } = useTagDataPersistence({ tagData: data, isLoading: false, initRef: useRef(true), latestTagDataRef, setTagData: setData, setLastSaved, saveTimeoutRef: useRef<ReturnType<typeof setTimeout> | null>(null), pendingSaveRef: useRef<TagDataStructure | null>(null), skipNextAutoSaveRef: useRef(false), persistedDataRef });
  const refresh = async () => { const base = persistedDataRef.current!; showSavedLibrary(await indexedDBStorage.loadAllStrict(), base); };
  const actions = useTagDataTrackActions({ tagData: data, latestTagDataRef, setTagData: setData, refreshPersistedTagData: refresh, emitUserTrackAddedEvent: vi.fn(), onSyncTrack: undefined, onSyncMultipleTracks: undefined });
  const multi = useMultiTrackTagging({ tagData: data });
  const uris = multi.isMultiTagging ? multi.multiTagTracks.map(track => track.uri) : [selected];
  const history = useTrackEditHistory(multi.isMultiTagging ? "bulk" : "single", uris, { draft: multi.multiTrackDraftTags, replaceDraft: multi.replaceMultiTrackDraft, onSaved: refresh });
  const bulk = (uris: string[]) => { multi.setMultiTagTracks(uris.map(uri => ({ uri } as SpotifyTrack))); multi.setIsMultiTagging(true); };
  const save = async () => {
    const session = trackEditHistory.capture("bulk", uris);
    if (!trackEditHistory.hold(session)) throw new Error("Busy");
    try {
      await flushLocalPersistence();
      const before = (await indexedDBStorage.loadAllStrict()).tracks;
      await actions.applyBatchTagUpdates(multi.calculateBatchChanges(multi.multiTagTracks, Object.fromEntries(uris.map(uri => [uri, data.tracks[uri]])), multi.multiTrackDraftTags!));
      trackEditHistory.record(session, before, (await indexedDBStorage.loadAllStrict()).tracks, "saved");
    } finally { trackEditHistory.release(session); }
  };
  return { actions, history, data, select, multi, bulk, save };
}
it("undoes/ redoes successive single-song annotations and exact dates without affecting another song", async () => {
  const { result } = renderHook(useEditor);
  await act(async () => { await result.current.actions.setRating(a, 4); await result.current.actions.setEnergy(a, 7); await result.current.actions.toggleTagSingleTrack(a, house); });
  await act(async () => { result.current.history.undo(); });
  await waitFor(() => expect(result.current.data.tracks[a]).toMatchObject({ rating: 4, energy: 7, tagIds: [] }));
  await act(async () => { result.current.history.undo(); });
  await waitFor(() => expect(result.current.data.tracks[a].energy).toBe(2));
  await act(async () => { result.current.history.undo(); });
  await waitFor(() => expect(result.current.data.tracks[a]).toEqual(song));
  expect(result.current.data.tracks[b]).toEqual(song);
  await act(async () => { result.current.history.redo(); });
  await waitFor(() => expect(result.current.data.tracks[a].rating).toBe(4));
  await act(async () => { await result.current.actions.setBpm(a, 125); });
  expect(result.current.history.canRedo).toBe(false);
});
it("resets on selection changes and does not restore a previous song when revisited", async () => {
  const { result } = renderHook(useEditor);
  await act(async () => { await result.current.actions.setRating(a, 4); });
  act(() => result.current.select(b));
  expect(result.current.history.canUndo).toBe(false);
  await act(async () => { result.current.history.undo(); await flushLocalPersistence(); });
  expect((await indexedDBStorage.getTrack(a))!.rating).toBe(4);
  act(() => result.current.select(a));
  expect(result.current.history.canUndo).toBe(false);
});
it("undoes bulk drafts before Save, then the saved batch, and resets for a different selection", async () => {
  const { result } = renderHook(useEditor);
  act(() => result.current.bulk([a, b]));
  act(() => result.current.multi.toggleTagMultiTrackDraft(house));
  await act(async () => { result.current.history.undo(); });
  await waitFor(() => expect(result.current.multi.multiTrackDraftTags![a].tagIds).toEqual([]));
  expect((await indexedDBStorage.getTrack(a))!.tagIds).toEqual([]);
  await act(async () => { result.current.history.redo(); });
  await waitFor(() => expect(result.current.multi.multiTrackDraftTags![a].tagIds).toEqual([house]));
  await act(async () => { await result.current.save(); });
  expect(trackEditHistory.getSnapshot().undo.map(entry => entry.kind)).toEqual(["saved"]);
  await act(async () => { result.current.history.undo(); });
  await waitFor(() => expect(result.current.data.tracks[a]).toEqual(song));
  expect(result.current.multi.multiTrackDraftTags![a].tagIds).toEqual([]);
  await act(async () => { result.current.history.redo(); });
  await waitFor(() => expect(result.current.data.tracks[b].tagIds).toEqual([house]));
  act(() => result.current.bulk([b, c]));
  expect(result.current.history.canUndo).toBe(false);
  expect(result.current.history.canRedo).toBe(false);
});
it("rejects a pending undo inside the transaction if the selection changed", async () => {
  const { result } = renderHook(useEditor);
  await act(async () => { await result.current.actions.setRating(a, 4); await flushLocalPersistence(); });
  const entry = trackEditHistory.getSnapshot().undo.at(-1)!;
  const session = trackEditHistory.capture("single", [a])!;
  act(() => result.current.select(b));
  await expect(indexedDBStorage.restoreTrackEdit(entry, "undo", getTagifyDatabaseName(), () => trackEditHistory.isCurrent(session))).rejects.toThrow("selection changed");
  expect((await indexedDBStorage.getTrack(a))!.rating).toBe(4);
});
it("preserves a later external edit and never restores a deleted tag", async () => {
  const { result } = renderHook(useEditor);
  await act(async () => { await result.current.actions.setRating(a, 4); await result.current.actions.toggleTagSingleTrack(a, house); await flushLocalPersistence(); });
  await indexedDBStorage.saveTrack(a, { ...(await indexedDBStorage.getTrack(a))!, rating: 5 });
  await act(async () => { result.current.history.undo(); });
  await waitFor(() => expect(result.current.history.canRedo).toBe(true));
  await indexedDBStorage.saveTaxonomy(buildTaxonomyFromCategoryTree([]));
  await act(async () => { result.current.history.redo(); });
  await waitFor(() => expect(result.current.history.canRedo).toBe(false));
  expect((await indexedDBStorage.getTrack(a))!.rating).toBe(5);
  expect((await indexedDBStorage.getTrack(a))!.tagIds).toEqual([]);
});

it("does not add a delayed edit to a new visit of the same song", async () => {
  const d = `spotify:track:${"d".repeat(22)}`;
  const { spotifyApiService } = await import("@/services/SpotifyApiService");
  let finish!: (value: { bpm: number; camelotKey: string }) => void;
  vi.spyOn(spotifyApiService, "fetchAudioFeatures").mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(useEditor);
  act(() => result.current.select(d));
  let pending!: Promise<void>;
  act(() => { pending = result.current.actions.setRating(d, 4, { name: "Delayed", artists: "Artist" }); });
  act(() => result.current.select(a));
  act(() => result.current.select(d));
  await act(async () => { finish({ bpm: 100, camelotKey: "8A" }); await pending; await flushLocalPersistence(); });
  expect((await indexedDBStorage.getTrack(d))!.rating).toBe(4);
  expect(result.current.history.canUndo).toBe(false);
});

it("restores the linked releases actually changed by a single-song edit, preserving each release's dates", async () => {
  const recordingIdentity = { isrc: "USAAA2400001", artistIds: ["a".repeat(22)], durationMs: 210000, name: "Song" };
  const linked = { ...seed, tracks: { ...seed.tracks, [a]: { ...song, recordingIdentity, recordingGroupId: "same-recording" }, [b]: { ...song, recordingIdentity, recordingGroupId: "same-recording", dateModified: 30 } } };
  await indexedDBStorage.saveAll(linked);
  const { result } = renderHook(() => useEditor(linked));
  await act(async () => { await result.current.actions.setRating(a, 4); });
  expect(Object.keys(trackEditHistory.getSnapshot().undo[0].changes).sort()).toEqual([a, b]);
  await act(async () => { result.current.history.undo(); });
  await waitFor(() => expect(result.current.history.canRedo).toBe(true));
  expect(result.current.data.tracks[a]).toEqual(linked.tracks[a]);
  expect(result.current.data.tracks[b]).toEqual(linked.tracks[b]);
  expect(result.current.data.tracks[c]).toEqual(song);
});

it("uses keyboard history outside text fields while leaving native text undo alone", async () => {
  const { result } = renderHook(useEditor);
  await act(async () => { await result.current.actions.setRating(a, 4); });
  const input = document.createElement("textarea");
  document.body.append(input);
  act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true })); });
  expect(result.current.data.tracks[a].rating).toBe(4);
  const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog");
  const dialogButton = document.createElement("button"); dialog.append(dialogButton); document.body.append(dialog);
  act(() => { dialogButton.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true })); });
  expect(result.current.data.tracks[a].rating).toBe(4);
  dialog.remove();
  const undo = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true });
  await act(async () => { document.body.dispatchEvent(undo); });
  await waitFor(() => expect(result.current.history.canRedo).toBe(true));
  expect(undo.defaultPrevented).toBe(true);
  expect(result.current.data.tracks[a].rating).toBe(1);
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true })); });
  await waitFor(() => expect(result.current.data.tracks[a].rating).toBe(4));
  input.remove();
});
