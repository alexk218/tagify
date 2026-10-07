import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { TagDataStructure } from "@/types/tagData";
import { useTagDataTrackActions } from "../useTagDataTrackActions";

// A bulk save must count distinct newly annotated songs and use the most recent
// snapshot even when two saves occur before React has rendered the first one.
describe("manual bulk additions", () => {
  it("emits new song identities once and preserves consecutive saves", () => {
    const latestTagDataRef = { current: { ...defaultTagData, tracks: {} } as TagDataStructure };
    const setTagData = vi.fn();
    const emitUserTrackAddedEvent = vi.fn();
    const { result } = renderHook(() => useTagDataTrackActions({
      tagData: latestTagDataRef.current, latestTagDataRef, setTagData,
      emitUserTrackAddedEvent, onSyncTrack: undefined, onSyncMultipleTracks: undefined,
    }));
    act(() => {
      result.current.applyBatchTagUpdates([{ trackUri: "spotify:track:first", toAdd: [], toRemove: [], newRating: 5 }]);
      result.current.applyBatchTagUpdates([
        { trackUri: "spotify:track:first", toAdd: [], toRemove: [], newRating: 4 },
        { trackUri: "spotify:track:second", toAdd: [], toRemove: [], newRating: 5 },
      ]);
    });
    expect(emitUserTrackAddedEvent.mock.calls).toEqual([[["spotify:track:first"]], [["spotify:track:second"]]]);
    expect(latestTagDataRef.current.tracks["spotify:track:first"].rating).toBe(4);
    expect(latestTagDataRef.current.tracks["spotify:track:second"].rating).toBe(5);
    act(() => { void result.current.applyBatchTagUpdates([{ trackUri: "spotify:track:empty", toAdd: [], toRemove: [], newRating: 0 }]); });
    expect(emitUserTrackAddedEvent).toHaveBeenCalledTimes(2);
  });
});

// Rating a new song waits for its audio features, so a second song rated in
// the meantime must not overwrite the first one when both finish.
describe("rating several new songs at once", () => {
  it("keeps every rating when new songs finish saving out of order", async () => {
    const { spotifyApiService } = await import("@/services/SpotifyApiService");
    const pendingFeatures = new Map<string, (value: { bpm: number; camelotKey: string }) => void>();
    const fetchAudioFeatures = vi
      .spyOn(spotifyApiService, "fetchAudioFeatures")
      .mockImplementation(
        (trackUri: string) =>
          new Promise((resolve) => {
            pendingFeatures.set(trackUri, resolve as never);
          }) as never,
      );
    const latestTagDataRef = { current: { ...defaultTagData, tracks: {} } as TagDataStructure };
    const { result } = renderHook(() => useTagDataTrackActions({
      tagData: latestTagDataRef.current, latestTagDataRef, setTagData: vi.fn(),
      emitUserTrackAddedEvent: vi.fn(), onSyncTrack: undefined, onSyncMultipleTracks: undefined,
    }));
    const metadata = (name: string) => ({
      name, artists: "Artist", albumName: "Album", albumUri: "spotify:album:one", albumImageUrl: null,
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.setRating("spotify:track:first", 4, metadata("First"));
      second = result.current.setRating("spotify:track:second", 3, metadata("Second"));
    });
    await act(async () => {
      pendingFeatures.get("spotify:track:second")?.({ bpm: 120, camelotKey: "8A" });
      await second;
      pendingFeatures.get("spotify:track:first")?.({ bpm: 90, camelotKey: "1B" });
      await first;
    });

    expect(latestTagDataRef.current.tracks["spotify:track:first"]).toMatchObject({ rating: 4, bpm: 90 });
    expect(latestTagDataRef.current.tracks["spotify:track:second"]).toMatchObject({ rating: 3, bpm: 120 });
    fetchAudioFeatures.mockRestore();
  });

  it("keeps the latest rating when a new song is rated twice while saving", async () => {
    const { spotifyApiService } = await import("@/services/SpotifyApiService");
    let finishFeatures!: (value: { bpm: number; camelotKey: string }) => void;
    const fetchAudioFeatures = vi
      .spyOn(spotifyApiService, "fetchAudioFeatures")
      .mockImplementation(() => new Promise((resolve) => { finishFeatures = resolve as never; }) as never);
    const latestTagDataRef = { current: { ...defaultTagData, tracks: {} } as TagDataStructure };
    const emitUserTrackAddedEvent = vi.fn();
    const { result } = renderHook(() => useTagDataTrackActions({
      tagData: latestTagDataRef.current, latestTagDataRef, setTagData: vi.fn(),
      emitUserTrackAddedEvent, onSyncTrack: undefined, onSyncMultipleTracks: undefined,
    }));
    const metadata = { name: "Song", artists: "Artist", albumUri: "spotify:album:one" };

    let ratings!: Promise<void[]>;
    act(() => {
      ratings = Promise.all([
        result.current.setRating("spotify:track:song", 4, metadata),
        result.current.setRating("spotify:track:song", 4.5, metadata),
      ]);
    });
    await act(async () => {
      finishFeatures({ bpm: 100, camelotKey: "5A" });
      await ratings;
    });

    expect(fetchAudioFeatures).toHaveBeenCalledTimes(1);
    expect(latestTagDataRef.current.tracks["spotify:track:song"].rating).toBe(4.5);
    expect(emitUserTrackAddedEvent.mock.calls).toEqual([[["spotify:track:song"]]]);
    fetchAudioFeatures.mockRestore();
  });
});
