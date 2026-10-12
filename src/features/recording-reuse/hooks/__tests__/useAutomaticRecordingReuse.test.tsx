import { IDBFactory } from "fake-indexeddb";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useAutomaticRecordingReuse } from "../useAutomaticRecordingReuse";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { recordingAnnotations } from "../../utils/recordingReuse";
import { defaultTagData } from "@/constants/defaultTagData";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
const a = `spotify:track:${"x".repeat(22)}`, b = `spotify:track:${"y".repeat(22)}`;
const identity = { isrc: "USABC2400001", artistIds: ["a".repeat(22)], durationMs: 180000, name: "Song" };
const original = { rating: 3, energy: 4, bpm: 120, tagIds: [], name: "Song", dateModified: 20, recordingIdentity: identity };
const blank = { ...original, rating: 0, energy: 0, dateModified: 30 };
const track = { uri: a, name: "Song", duration_ms: 180000, artists: [{ name: "Artist" }], album: { name: "Album", uri: "spotify:album:example", images: [] } } as SpotifyTrack;
beforeEach(async () => {
  delete window.__tagifyRecordingChecks;
  indexedDBStorage.resetConnection(); localStorage.clear(); localStorage.setItem("tagify:sync:account-id", "recording-automatic");
  vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init();
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { [a]: blank, [b]: original } });
});
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("quietly reuses confirmed compatible tagging without changing existing dates or checking unrelated songs", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity");
  const changed = vi.fn();
  renderHook(() => useAutomaticRecordingReuse(track, { [a]: blank, [b]: original }, changed));
  await waitFor(async () => expect((await indexedDBStorage.getTrack(a))?.rating).toBe(3));
  const first = (await indexedDBStorage.getTrack(a))!;
  const second = (await indexedDBStorage.getTrack(b))!;
  expect(first).toMatchObject({ rating: 3, energy: 4, dateModified: 30 });
  expect(second).toMatchObject({ rating: 3, energy: 4, dateModified: 20 });
  expect(first.recordingGroupId).toBe(second.recordingGroupId);
  expect(lookup).not.toHaveBeenCalled();
});
it("rejects a changed account at the automatic link transaction boundary", async () => {
  const account = getTagifyDatabaseName();
  localStorage.setItem("tagify:sync:account-id", "another-account");
  await expect(indexedDBStorage.linkRecordings({ [a]: { identity, annotations: recordingAnnotations(blank) }, [b]: { identity, annotations: recordingAnnotations(original) } }, b, false, { automatic: true, expectedDatabaseName: account })).rejects.toThrow("account changed");
});
it("leaves conflicting saved choices separate", async () => {
  const different = { ...blank, rating: 5 };
  await indexedDBStorage.saveTrack(a, different);
  const link = vi.spyOn(indexedDBStorage, "linkRecordings");
  const load = vi.spyOn(indexedDBStorage, "getRecordingTracks");
  renderHook(() => useAutomaticRecordingReuse(track, { [a]: different, [b]: original }, vi.fn()));
  await waitFor(() => expect(load).toHaveBeenCalled());
  // Wait for the real database read, then drain the cached identity checks.
  await load.mock.results[0].value;
  await Promise.resolve(); await Promise.resolve();
  expect(link).not.toHaveBeenCalled();
  expect((await indexedDBStorage.getTrack(a))!.rating).toBe(5);
});
it("makes no background checks for an opted-out release or a different title", async () => {
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity");
  renderHook(() => useAutomaticRecordingReuse(track, { [a]: { ...blank, recordingReuseDisabled: true }, [b]: original }, vi.fn()));
  renderHook(() => useAutomaticRecordingReuse(track, { [a]: blank, [b]: { ...original, name: "Song (Live)" } }, vi.fn()));
  expect(lookup).not.toHaveBeenCalled();
});

it("does not link after navigating away while a Spotify identity check is in flight", async () => {
  const current = `spotify:track:${"q".repeat(22)}`;
  let finish!: (value: typeof identity) => void;
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const link = vi.spyOn(indexedDBStorage, "linkRecordings");
  const view = renderHook(() => useAutomaticRecordingReuse({ ...track, uri: current }, { [b]: original }, vi.fn()));
  await waitFor(() => expect(lookup).toHaveBeenCalled());
  view.unmount(); finish(identity);
  await lookup.mock.results[0].value; await Promise.resolve(); await Promise.resolve();
  expect(link).not.toHaveBeenCalled();
  expect(await indexedDBStorage.getTrack(current)).toBeNull();
});

it("reuses a confirmed new release with its own metadata and fresh dates, keeping the saved release's date", async () => {
  const current = `spotify:track:${"r".repeat(22)}`;
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue(identity);
  const changed = vi.fn();
  renderHook(() => useAutomaticRecordingReuse({ ...track, uri: current, album: { ...track.album, name: "New release" } }, { [b]: original }, changed));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(await indexedDBStorage.getTrack(current)).toMatchObject({ rating: 3, energy: 4, bpm: null, albumName: "New release" });
  expect((await indexedDBStorage.getTrack(current))!.dateModified).toBeGreaterThan(30);
  expect((await indexedDBStorage.getTrack(b))!.dateModified).toBe(20);
});

it("retries a still-visible song after its outage cooldown, without repeated requests in the meantime", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const current = `spotify:track:${"s".repeat(22)}`;
  const lookup = vi.spyOn(spotifyApiService, "getRecordingIdentity").mockRejectedValueOnce(new Error("Spotify unavailable")).mockResolvedValue(identity);
  const changed = vi.fn(async () => undefined);
  const view = renderHook(() => useAutomaticRecordingReuse({ ...track, uri: current }, { [b]: original }, changed));
  try {
    await vi.waitFor(() => expect(view.result.current).toBe("unavailable"));
    expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(await indexedDBStorage.getTrack(current)).toMatchObject({ rating: 3, energy: 4 });
  } finally { view.unmount(); vi.useRealTimers(); }
});
