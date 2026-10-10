import { IDBFactory } from "fake-indexeddb";
import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRecordingLibrary } from "../useRecordingLibrary";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TrackData } from "@/types/tagData";
const uri = (index: number) => `spotify:track:${String(index).padStart(22, "0")}`;
const identity = { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 180000, name: "Song" };
const song = { name: "Song", rating: 3, energy: 4, bpm: 120, tagIds: [], dateModified: 20 };
beforeEach(async () => {
  trackEditHistory.clear();
  indexedDBStorage.resetConnection(); localStorage.clear(); localStorage.setItem("tagify:sync:account-id", "library-recordings-test");
  vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init();
});
afterEach(() => { trackEditHistory.clear(); indexedDBStorage.resetConnection(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function preview(initial: Record<string, TrackData>) {
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: initial });
  return renderHook(() => {
    const [tracks, setTracks] = useState(initial);
    const conflicts = useRecordingLibrary(tracks, true, async () => setTracks((await indexedDBStorage.loadAllStrict()).tracks));
    return { tracks, conflicts };
  });
}
it("checks the whole saved library without opening songs or limiting matching copies to eight", async () => {
  const tracks = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [uri(index), { ...song, rating: index ? 0 : 3, energy: index ? 0 : 4, dateModified: 20 + index, recordingIdentity: identity }]));
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity");
  const view = await preview(tracks);
  await waitFor(() => expect(Object.values(view.result.current.tracks).every(track => !!track.recordingGroupId)).toBe(true));
  expect(new Set(Object.values(view.result.current.tracks).map(track => track.recordingGroupId)).size).toBe(1);
  Object.values(view.result.current.tracks).forEach((track, index) => expect(track.dateModified).toBe(20 + index));
  expect(lookup).not.toHaveBeenCalled();
});
it("checkpoints identities, resumes after refresh, and exposes conflicts without overwriting either saved choice", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  const view = await preview({ [uri(1)]: song, [uri(2)]: { ...song, rating: 5, dateModified: 30 }, [uri(3)]: { ...song, name: "Unrelated song" } });
  await waitFor(() => expect(view.result.current.conflicts).toHaveLength(1));
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(view.result.current.tracks[uri(1)]).toMatchObject({ rating: 3, dateModified: 20 });
  expect(view.result.current.tracks[uri(2)]).toMatchObject({ rating: 5, dateModified: 30 });
  const saved = (await indexedDBStorage.loadAllStrict()).tracks;
  view.unmount(); lookup.mockClear();
  const reopened = await preview(saved);
  expect(reopened.result.current.conflicts).toHaveLength(1);
  expect(lookup).not.toHaveBeenCalled();
});
it("keeps remixes, opted-out songs and unavailable checks separate, and stops an outage from triggering more requests", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockRejectedValue(new Error("Unavailable"));
  const view = await preview({ [uri(1)]: song, [uri(2)]: song, [uri(3)]: { ...song, recordingReuseDisabled: true }, [uri(4)]: { ...song, name: "Song (Live)" } });
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
  expect(view.result.current.conflicts).toEqual([]);
  expect(Object.values(view.result.current.tracks).some(track => track.recordingGroupId)).toBe(false);
});
it("does not save results from an interrupted scan or a different account", async () => {
  let finish!: (value: typeof identity) => void;
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const remember = vi.spyOn(indexedDBStorage, "rememberRecordingIdentities");
  const view = await preview({ [uri(1)]: song, [uri(2)]: song });
  await waitFor(() => expect(lookup).toHaveBeenCalled());
  view.unmount();
  await act(async () => { finish(identity); await lookup.mock.results[0].value; });
  expect(remember).not.toHaveBeenCalled();
});

it("defers matching during reversible edits and resumes when the user starts another song session", async () => {
  const tracks = { [uri(1)]: { ...song, recordingIdentity: identity }, [uri(2)]: { ...song, recordingIdentity: identity } };
  const session = trackEditHistory.select("single", [uri(1)]);
  trackEditHistory.record(session, { [uri(1)]: { ...tracks[uri(1)], rating: 1 } }, tracks, "saved");
  const link = vi.spyOn(indexedDBStorage, "linkRecordings");
  const view = await preview(tracks);
  const load = vi.spyOn(indexedDBStorage, "loadAllStrict");
  await waitFor(() => expect(load).toHaveBeenCalled());
  await load.mock.results[0].value;
  expect(link).not.toHaveBeenCalled();
  await act(async () => { trackEditHistory.select("single", [uri(3)]); });
  await waitFor(() => expect(view.result.current.tracks[uri(1)].recordingGroupId).toBeTruthy());
  expect(view.result.current.tracks[uri(1)].recordingGroupId).toBe(view.result.current.tracks[uri(2)].recordingGroupId);
});

it("an edited song does not prevent matching other saved songs", async () => {
  const other = { ...song, name: "Another song", recordingIdentity: { ...identity, isrc: "USABC2400002", name: "Another song" } };
  const tracks = { [uri(1)]: { ...song, recordingIdentity: identity }, [uri(2)]: { ...song, recordingIdentity: identity }, [uri(3)]: other, [uri(4)]: other };
  const session = trackEditHistory.select("single", [uri(1)]);
  trackEditHistory.record(session, { [uri(1)]: { ...song, rating: 1 } }, { [uri(1)]: tracks[uri(1)] }, "saved");
  const view = await preview(tracks);
  await waitFor(() => expect(view.result.current.tracks[uri(3)].recordingGroupId).toBeTruthy());
  expect(view.result.current.tracks[uri(1)].recordingGroupId).toBeUndefined();
});
