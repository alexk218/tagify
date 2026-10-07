import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { useMultiTrackTagging } from "../useMultiTrackTagging";

const track = {
  uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
  name: "Test track",
  artists: [{ name: "Test artist" }],
  album: { name: "Test album" },
  duration_ms: 180_000,
} satisfies SpotifyTrack;

describe("bulk tagging while Community updates the library", () => {
  it("shows saved tags and ratings when the library finishes loading after the editor opens", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useMultiTrackTagging({ tagData: data }),
      { initialProps: { data: defaultTagData } },
    );

    act(() => {
      result.current.setMultiTagTracks([track]);
      result.current.setIsMultiTagging(true);
    });
    expect(result.current.multiTrackDraftTags?.[track.uri]).toEqual({ tagIds: [], rating: 0, energy: 0 });

    rerender({ data: {
      ...defaultTagData,
      tracks: { ...defaultTagData.tracks, [track.uri]: { tagIds: ["tag_saved"], rating: 4, energy: 7, bpm: null } },
    } });

    expect(result.current.multiTrackDraftTags?.[track.uri]).toEqual({
      tagIds: ["tag_saved"], rating: 4, energy: 7,
    });
    expect(result.current.calculateBatchChanges([track], {
      [track.uri]: { tagIds: ["tag_saved"], rating: 4, energy: 7 },
    }, result.current.multiTrackDraftTags!)).toEqual([]);
  });

  it("keeps an in-progress edit while incorporating newly loaded annotations", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useMultiTrackTagging({ tagData: data }),
      { initialProps: { data: defaultTagData } },
    );
    act(() => {
      result.current.setMultiTagTracks([track]);
      result.current.setIsMultiTagging(true);
    });
    act(() => result.current.toggleTagMultiTrackDraft("tag_new"));

    rerender({ data: {
      ...defaultTagData,
      tracks: { ...defaultTagData.tracks, [track.uri]: { tagIds: ["tag_saved"], rating: 4, energy: 7, bpm: null } },
    } });

    expect(result.current.multiTrackDraftTags?.[track.uri]).toEqual({
      tagIds: ["tag_saved", "tag_new"], rating: 4, energy: 7,
    });
    expect(result.current.calculateBatchChanges([track], {
      [track.uri]: { tagIds: ["tag_saved"], rating: 4, energy: 7 },
    }, result.current.multiTrackDraftTags!)).toEqual([{
      trackUri: track.uri, toAdd: ["tag_new"], toRemove: [],
    }]);
  });

  it("keeps an unsaved tag choice when stored track data refreshes in the background", () => {
    const { result, rerender } = renderHook(
      ({ data }) => useMultiTrackTagging({ tagData: data }),
      { initialProps: { data: defaultTagData } },
    );

    act(() => {
      result.current.setMultiTagTracks([track]);
      result.current.setIsMultiTagging(true);
    });
    act(() => result.current.toggleTagMultiTrackDraft("tag_quirky"));
    expect(result.current.multiTrackDraftTags?.[track.uri].tagIds).toEqual(["tag_quirky"]);

    rerender({ data: { ...defaultTagData, tracks: { ...defaultTagData.tracks } } });

    expect(result.current.multiTrackDraftTags?.[track.uri].tagIds).toEqual(["tag_quirky"]);
  });
});
