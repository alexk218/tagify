import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure } from "@/types/tagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { useTagDataArtistActions } from "../useTagDataArtistActions";
import { useTagDataPlaylistActions } from "../useTagDataPlaylistActions";
import { useTagDataTrackActions } from "../useTagDataTrackActions";

afterEach(() => { vi.restoreAllMocks(); });
it.each(["artist", "playlist", "track"] as const)("saves a %s rating from a click before optional Spotify details finish", async kind => {
  const uri = `spotify:${kind}:new`;
  const ref = { current: { ...defaultTagData, tracks: {}, artists: {}, playlists: {} } as TagDataStructure };
  vi.spyOn(spotifyApiService, "getArtistMetadata").mockImplementation(() => new Promise(() => {}));
  vi.spyOn(spotifyApiService, "getPlaylistMetadata").mockImplementation(() => new Promise(() => {}));
  vi.spyOn(spotifyApiService, "fetchAudioFeatures").mockImplementation(() => new Promise(() => {}));
  function Editor() {
    const options = { tagData: ref.current, latestTagDataRef: ref, setTagData: vi.fn() };
    const artist = useTagDataArtistActions(options), playlist = useTagDataPlaylistActions(options);
    const track = useTagDataTrackActions({ ...options, emitUserTrackAddedEvent: vi.fn(), onSyncTrack: undefined, onSyncMultipleTracks: undefined });
    return <button onClick={() => { void (kind === "artist" ? artist.setArtistRating(uri, 5) : kind === "playlist" ? playlist.setPlaylistRating(uri, 5) : track.setRating(uri, 5, { name: "Song", artists: "Artist" })); }}>Five stars</button>;
  }
  render(<Editor />);
  await act(async () => { fireEvent.click(screen.getByText("Five stars")); });
  const records = kind === "artist" ? ref.current.artists : kind === "playlist" ? ref.current.playlists : ref.current.tracks;
  expect(records[uri]?.rating).toBe(5);
});

it.each(["artist", "playlist"] as const)("keeps a new %s edit when metadata rejects during a cooldown", async kind => {
  const { renderHook } = await import("@testing-library/react");
  const uri = `spotify:${kind}:paused`;
  const ref = { current: { ...defaultTagData, artists: {}, playlists: {} } as TagDataStructure };
  const lookup = vi.spyOn(spotifyApiService, kind === "artist" ? "getArtistMetadata" : "getPlaylistMetadata").mockRejectedValue({ status: 429, spotifyRequestStopped: true });
  const { result } = renderHook(() => {
    const options = { tagData: ref.current, latestTagDataRef: ref, setTagData: vi.fn() };
    return { artist: useTagDataArtistActions(options), playlist: useTagDataPlaylistActions(options) };
  });
  await act(async () => { await (kind === "artist" ? result.current.artist.setArtistRating(uri, 4) : result.current.playlist.setPlaylistRating(uri, 4)); });
  expect((kind === "artist" ? ref.current.artists : ref.current.playlists)[uri].rating).toBe(4);
  expect(lookup).toHaveBeenCalledTimes(1);
});

it.each(["delete", "account", "manual-audio", "undo"])("ignores stale track enrichment after %s", async mode => {
  const { renderHook } = await import("@testing-library/react");
  const { trackEditHistory } = await import("@/services/TrackEditHistory");
  const uri = "spotify:track:new";
  const ref = { current: { ...defaultTagData, tracks: {} } as TagDataStructure };
  let finish!: (value: { bpm: number; camelotKey: string }) => void;
  vi.spyOn(spotifyApiService, "fetchAudioFeatures").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useTagDataTrackActions({ tagData: ref.current, latestTagDataRef: ref, setTagData: vi.fn(), emitUserTrackAddedEvent: vi.fn(), onSyncTrack: undefined, onSyncMultipleTracks: undefined }));
  await act(async () => { await result.current.setRating(uri, 5, { name: "Song", artists: "Artist" }); });
  const savedTime = ref.current.tracks[uri].dateModified;
  if (mode === "delete") ref.current = { ...ref.current, tracks: {} };
  if (mode === "account") localStorage.setItem("tagify:sync:account-id", "other");
  if (mode === "manual-audio") await act(async () => { await result.current.setBpm(uri, null); });
  if (mode === "undo") {
    const session = trackEditHistory.select("single", [uri]);
    trackEditHistory.record(session, {}, ref.current.tracks, "saved");
    const entry = trackEditHistory.begin("undo")!;
    trackEditHistory.finish(session, "undo", entry.entry.id, entry.entry);
  }
  const before = ref.current.tracks[uri];
  await act(async () => { finish({ bpm: 128, camelotKey: "8A" }); });
  if (mode === "delete") expect(ref.current.tracks[uri]).toBeUndefined();
  else { expect(ref.current.tracks[uri].bpm).toBeNull(); expect(ref.current.tracks[uri].rating).toBe(5); }
  if (mode !== "manual-audio" && before) expect(ref.current.tracks[uri].dateModified).toBe(savedTime);
  trackEditHistory.clear();
});

it("edits an existing song in a 50,000-song library without any metadata request", async () => {
  const { renderHook } = await import("@testing-library/react");
  const { spotifyService } = await import("@/services/SpotifyService");
  const tracks = Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`spotify:track:${i}`, { name: "Song", artists: "Artist", rating: 1, energy: 0, bpm: null, tagIds: [], dateModified: 10 }]));
  const ref = { current: { ...defaultTagData, tracks } as TagDataStructure };
  const details = vi.spyOn(spotifyService, "getTrack"), audio = vi.spyOn(spotifyApiService, "fetchAudioFeatures");
  const { result } = renderHook(() => useTagDataTrackActions({ tagData: ref.current, latestTagDataRef: ref, setTagData: vi.fn(), emitUserTrackAddedEvent: vi.fn(), onSyncTrack: undefined, onSyncMultipleTracks: undefined }));
  await act(async () => { await result.current.setRating("spotify:track:123", 5); });
  expect(ref.current.tracks["spotify:track:123"].rating).toBe(5);
  expect(ref.current.tracks["spotify:track:124"]).toBe(tracks["spotify:track:124"]);
  expect(details).not.toHaveBeenCalled(); expect(audio).not.toHaveBeenCalled();
});

it.each(["setBpm", "setCamelotKey"] as const)("preserves an explicit empty audio value when %s starts missing metadata lookup", async action => {
  const { renderHook } = await import("@testing-library/react");
  const { spotifyService } = await import("@/services/SpotifyService");
  vi.spyOn(spotifyService, "getTrack").mockResolvedValue({ name: "Song", artists: [{ name: "Artist" }] } as any);
  vi.spyOn(spotifyApiService, "fetchAudioFeatures").mockResolvedValue({ bpm: 128, camelotKey: "8A" });
  const uri = "spotify:track:empty-audio";
  const ref = { current: { ...defaultTagData, tracks: { [uri]: { tagIds: [], rating: 5, energy: 0, bpm: null, camelotKey: null, dateCreated: 1, dateModified: 1 } } } as TagDataStructure };
  const { result } = renderHook(() => useTagDataTrackActions({ tagData: ref.current, latestTagDataRef: ref, setTagData: vi.fn(), emitUserTrackAddedEvent: vi.fn(), onSyncTrack: undefined, onSyncMultipleTracks: undefined }));
  await act(async () => { await result.current[action](uri, null); });
  expect(ref.current.tracks[uri].bpm).toBeNull();
  expect(ref.current.tracks[uri].camelotKey).toBe(action === "setCamelotKey" ? undefined : null);
});
