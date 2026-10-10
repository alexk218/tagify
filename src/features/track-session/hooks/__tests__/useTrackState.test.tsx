import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spotifyService, type TrackInfo } from "@/services/SpotifyService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { useTrackEditHistory } from "../../history/useTrackEditHistory";
import { useTrackState } from "../useTrackState";

const a = `spotify:track:${"a".repeat(22)}`;
const b = `spotify:track:${"b".repeat(22)}`;
const playing = `spotify:track:${"p".repeat(22)}`;
const track = { name: "Song A", artists: "Artist", albumName: "Album", rating: 1, energy: 0, bpm: null, tagIds: [], dateModified: 20 };
const saved = { [a]: track, [b]: { ...track, name: "Song B" } };
const details: TrackInfo = { name: "Loaded song", artists: "Artist", artistsData: [{ name: "Artist", uri: `spotify:artist:${"a".repeat(22)}` }], albumName: "Album", albumUri: null, albumImageUrl: null, duration_ms: 210000, release_date: "2024-01-01" };
beforeEach(() => {
  localStorage.clear(); trackEditHistory.clear();
  vi.stubGlobal("Spicetify", { ...Spicetify, Player: { ...Spicetify.Player, data: { item: { uri: playing, name: "Playing", artists: [{ name: "Artist" }] } } } });
});
afterEach(() => { cleanup(); trackEditHistory.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("switches songs and resets history before details arrive, ignores older responses, and keeps history during enrichment", async () => {
  const resolve = new Map<string, (data: TrackInfo) => void>();
  vi.spyOn(spotifyService, "getTrack").mockImplementation(uri => new Promise(done => resolve.set(uri, done)));
  const { result } = renderHook(() => {
    const editor = useTrackState(saved);
    const history = useTrackEditHistory(editor.activeTrack ? "single" : null, editor.activeTrack ? [editor.activeTrack.uri] : [], { draft: null, replaceDraft: vi.fn(), onSaved: vi.fn() });
    return { ...editor, history };
  });
  let first!: Promise<void>;
  act(() => { first = result.current.handleSelectTrackForTagging(a); });
  expect(result.current.activeTrack?.name).toBe("Song A");
  act(() => trackEditHistory.record(trackEditHistory.capture("single", [a]), { [a]: track }, { [a]: { ...track, rating: 4 } }, "saved"));
  expect(result.current.history.canUndo).toBe(true);
  let second!: Promise<void>;
  act(() => { second = result.current.handleSelectTrackForTagging(b); });
  expect(result.current.activeTrack?.uri).toBe(b);
  expect(result.current.history.canUndo).toBe(false);
  await act(async () => { resolve.get(a)!(details); await first; });
  expect(result.current.activeTrack?.uri).toBe(b);
  act(() => trackEditHistory.record(trackEditHistory.capture("single", [b]), { [b]: saved[b] }, { [b]: { ...saved[b], rating: 4 } }, "saved"));
  await act(async () => { resolve.get(b)!(details); await second; });
  expect(result.current.activeTrack?.name).toBe("Loaded song");
  expect(result.current.history.canUndo).toBe(true);
});

it("does not revive a selection after unlocking or an external lock change", async () => {
  let finish!: (data: TrackInfo) => void;
  vi.spyOn(spotifyService, "getTrack").mockImplementation(() => new Promise(done => { finish = done; }));
  const { result } = renderHook(() => useTrackState(saved));
  let pending!: Promise<void>;
  act(() => { pending = result.current.handleSelectTrackForTagging(a); });
  act(() => result.current.toggleLock());
  await act(async () => { finish(details); await pending; });
  expect(result.current.activeTrack?.uri).toBe(playing);
  act(() => { pending = result.current.handleSelectTrackForTagging(a); });
  act(() => result.current.setLockedTrack({ uri: b, name: "External selection", artists: [], album: { name: "" }, duration_ms: 0 }));
  await act(async () => { finish(details); await pending; });
  expect(result.current.activeTrack?.uri).toBe(b);
});

it("clears the previous editor while an unknown song loads, and keeps saved metadata on a failed read", async () => {
  const getTrack = vi.spyOn(spotifyService, "getTrack").mockResolvedValue(null);
  const { result } = renderHook(() => useTrackState(saved));
  await act(async () => { await result.current.handleSelectTrackForTagging(a); });
  expect(result.current.activeTrack?.name).toBe("Song A");
  let finish!: (data: TrackInfo) => void;
  getTrack.mockImplementation(() => new Promise(done => { finish = done; }));
  let pending!: Promise<void>;
  const unknown = `spotify:track:${"u".repeat(22)}`;
  act(() => { pending = result.current.handleSelectTrackForTagging(unknown); });
  expect(result.current.activeTrack).toBeNull();
  await act(async () => { finish(details); await pending; });
  expect(result.current.activeTrack?.uri).toBe(unknown);
});
