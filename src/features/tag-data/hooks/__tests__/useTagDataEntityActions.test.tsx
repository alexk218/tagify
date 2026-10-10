import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import type { TagDataStructure } from "@/types/tagData";
import { useTagDataArtistActions } from "../useTagDataArtistActions";
import { useTagDataPlaylistActions } from "../useTagDataPlaylistActions";

const track = `spotify:track:${"a".repeat(22)}`;
const tagIds = Object.keys(defaultTagData.taxonomy.tagsById).slice(0, 2);

function setup<T>(useActions: (options: { tagData: TagDataStructure; setTagData: () => void; latestTagDataRef: { current: TagDataStructure } }) => T) {
  const latestTagDataRef = { current: { ...defaultTagData, tracks: { [track]: { rating: 1, energy: 0, bpm: null, tagIds: [] } } } as TagDataStructure };
  const { result } = renderHook(() => useActions({ tagData: latestTagDataRef.current, setTagData: vi.fn(), latestTagDataRef }));
  return { result, latestTagDataRef };
}

function slowLookup<T>(value: T) {
  const pending: Array<() => void> = [];
  const lookup = () => new Promise<T>((resolve) => pending.push(() => resolve(value)));
  return { lookup, finish: () => pending.splice(0).forEach((resolve) => resolve()) };
}

afterEach(() => { vi.restoreAllMocks(); });

// Looking up a new playlist or artist can take a moment. Edits made in the
// meantime, including a second tag on the same item, must all be kept.
it("keeps edits made while a new playlist's details load", async () => {
  const { lookup, finish } = slowLookup({ name: "Mix", ownerName: "Me", imageUrl: null, description: null, trackCount: 3, snapshotId: "s" });
  vi.spyOn(spotifyApiService, "getPlaylistMetadata").mockImplementation(lookup as never);
  const { result, latestTagDataRef } = setup(useTagDataPlaylistActions);
  const playlist = "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M";

  let first!: Promise<void>, second!: Promise<void>;
  act(() => {
    first = result.current.toggleTagPlaylist(playlist, tagIds[0]);
    second = result.current.toggleTagPlaylist(playlist, tagIds[1]);
  });
  latestTagDataRef.current = { ...latestTagDataRef.current, tracks: { [track]: { ...latestTagDataRef.current.tracks[track], rating: 5 } } };
  await act(async () => { finish(); await Promise.all([first, second]); });

  expect(latestTagDataRef.current.tracks[track].rating).toBe(5);
  expect([...latestTagDataRef.current.playlists[playlist].tagIds].sort()).toEqual([...tagIds].sort());
});

it("keeps edits made while a new artist's details load", async () => {
  const { lookup, finish } = slowLookup({ name: "Low", imageUrl: null, followerCount: 1, genres: [] });
  vi.spyOn(spotifyApiService, "getArtistMetadata").mockImplementation(lookup as never);
  const { result, latestTagDataRef } = setup(useTagDataArtistActions);
  const artist = "spotify:artist:0Mz5XE0kb1GBnbLQm2VbcO";

  let first!: Promise<void>, second!: Promise<void>;
  act(() => {
    first = result.current.toggleTagArtist(artist, tagIds[0]);
    second = result.current.setArtistRating(artist, 4);
  });
  latestTagDataRef.current = { ...latestTagDataRef.current, tracks: { [track]: { ...latestTagDataRef.current.tracks[track], rating: 5 } } };
  await act(async () => { finish(); await Promise.all([first, second]); });

  expect(latestTagDataRef.current.tracks[track].rating).toBe(5);
  expect(latestTagDataRef.current.artists[artist]).toMatchObject({ tagIds: [tagIds[0]], rating: 4 });
});
