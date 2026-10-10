import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { emptyPrivateNote, mergeRemotePrivateNotes, notifyPrivateNotesChanged, savePrivateNote } from "@/services/sync/PrivateNotes";
import { usePrivateNotePreviews } from "../usePrivateNotePreviews";

const uri = `spotify:track:${"a".repeat(22)}`;
const other = `spotify:local:Artist:Album:Song:180`;
beforeEach(async () => {
  indexedDBStorage.resetConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  await indexedDBStorage.init();
});
afterEach(() => {
  vi.restoreAllMocks();
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("reads only visible notes, includes local songs, and refreshes saved/removed notes without touching track dates", async () => {
  await indexedDBStorage.saveTrack(uri, { rating: 4, energy: 6, bpm: null, tagIds: [], dateModified: 50 });
  await savePrivateNote(uri, "My note", "");
  await savePrivateNote(other, "Local song note", "");
  await savePrivateNote(`spotify:album:${"b".repeat(22)}`, "Private album note", "");
  const { result, rerender } = renderHook(({ uris }) => usePrivateNotePreviews(uris), { initialProps: { uris: [uri, uri] } });
  await waitFor(() => expect(result.current.texts).toEqual({ [uri]: "My note" }));
  await act(() => savePrivateNote(uri, "", "My note"));
  await waitFor(() => expect(result.current.texts[uri]).toBe(""));
  rerender({ uris: [other] });
  await waitFor(() => expect(result.current.texts).toEqual({ [other]: "Local song note" }));
  expect((await indexedDBStorage.getTrack(uri))!.dateModified).toBe(50);
});

it("refreshes remote changes but skips events that only change backup status", async () => {
  const read = vi.spyOn(indexedDBStorage, "getPrivateNotesForUris");
  const { result } = renderHook(() => usePrivateNotePreviews([uri]));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  await act(async () => { notifyPrivateNotesChanged(false, false); });
  expect(read).toHaveBeenCalledTimes(1);
  await act(() => mergeRemotePrivateNotes([{ uri, text: "From my other device", revision: 1, updatedAt: "2026-10-09T00:00:00Z" }]));
  await waitFor(() => expect(result.current.texts[uri]).toBe("From my other device"));
});

it("reports failed reads and retries instead of presenting them as an empty library", async () => {
  await savePrivateNote(uri, "Still saved", "");
  vi.spyOn(indexedDBStorage, "getPrivateNotesForUris").mockRejectedValueOnce(new Error("Unavailable"));
  const { result } = renderHook(() => usePrivateNotePreviews([uri]));
  await waitFor(() => expect(result.current.error).toBe(true));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.texts[uri]).toBe("Still saved"));
  expect(result.current.error).toBe(false);
});

it("clears the previous account's previews and ignores its delayed reads", async () => {
  await savePrivateNote(uri, "First owner's note", "");
  const { result } = renderHook(() => usePrivateNotePreviews([uri]));
  await waitFor(() => expect(result.current.texts[uri]).toBe("First owner's note"));
  let finish!: (notes: ReturnType<typeof emptyPrivateNote>[]) => void;
  vi.spyOn(indexedDBStorage, "getPrivateNotesForUris").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => result.current.retry());
  await act(async () => {
    localStorage.setItem("tagify:sync:account-id", "second-owner");
    window.dispatchEvent(new Event("tagify:syncStatus"));
  });
  expect(result.current.texts).toEqual({});
  await waitFor(() => expect(indexedDBStorage.getPrivateNotesForUris).toHaveBeenCalledTimes(2));
  await act(async () => { finish([{ ...emptyPrivateNote(uri), text: "Late first-owner note" }]); });
  expect(result.current.texts).toEqual({});
});

it("ignores an obsolete request when filtering changes the visible songs", async () => {
  await savePrivateNote(other, "Visible local note", "");
  let finish!: (notes: ReturnType<typeof emptyPrivateNote>[]) => void;
  vi.spyOn(indexedDBStorage, "getPrivateNotesForUris").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { result, rerender } = renderHook(({ uris }) => usePrivateNotePreviews(uris), { initialProps: { uris: [uri] } });
  rerender({ uris: [other] });
  await waitFor(() => expect(result.current.texts[other]).toBe("Visible local note"));
  await act(async () => { finish([{ ...emptyPrivateNote(uri), text: "Obsolete note" }]); });
  expect(result.current.texts).toEqual({ [other]: "Visible local note" });
});
