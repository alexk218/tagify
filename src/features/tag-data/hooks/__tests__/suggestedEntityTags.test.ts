import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TagDataStructure } from "@/types/tagData";
import { buildTaxonomyFromCategoryTree, TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { useTagDataArtistActions } from "../useTagDataArtistActions";
import { useTagDataPlaylistActions } from "../useTagDataPlaylistActions";

const taxonomy = buildTaxonomyFromCategoryTree([{ id: "cat_genre", name: "Genre", subcategories: [
  { id: "sub_style", name: "Style", tags: [{ id: "tag_house", name: "House" }, { id: "tag_ambient", name: "Ambient" }] },
] }]);
for (const kind of ["artist", "album", "playlist"] as const) {
  it(`adds ${kind} suggestions once without Spotify calls or changing tracks and existing choices`, () => {
    const getMetadata = vi.spyOn(spotifyApiService, kind === "artist" ? "getArtistMetadata" : "getPlaylistMetadata");
    const uri = `spotify:${kind}:example`;
    const data: TagDataStructure = { schemaVersion: TAG_DATA_SCHEMA_VERSION, taxonomy,
      tracks: { "spotify:track:1": { rating: 5, energy: 7, bpm: null, tagIds: ["tag_house"], dateModified: 123 } },
      artists: {}, playlists: {},
    };
    const ref = { current: data };
    const setTagData = vi.fn();
    const { result } = renderHook(() => ({
      artist: useTagDataArtistActions({ tagData: data, latestTagDataRef: ref, setTagData }),
      playlist: useTagDataPlaylistActions({ tagData: data, latestTagDataRef: ref, setTagData }),
    }));
    const add = (id: string) => kind === "artist"
      ? result.current.artist.addTagArtist(uri, id, { name: "Example", imageUrl: null, followerCount: null, genres: [] })
      : result.current.playlist.addTagPlaylist(uri, id, { name: "Example", imageUrl: null, ownerName: null, description: null, snapshotId: null, trackCount: 10 });
    act(() => { add("tag_house"); add("tag_ambient"); add("tag_house"); add("unknown"); });
    const entities = kind === "artist" ? ref.current.artists : ref.current.playlists;
    expect(entities[uri]).toMatchObject({ name: "Example", tagIds: ["tag_house", "tag_ambient"], rating: 0, energy: 0 });
    expect(setTagData).toHaveBeenCalledTimes(2);
    expect(ref.current.tracks).toBe(data.tracks);
    expect(ref.current.tracks["spotify:track:1"].dateModified).toBe(123);
    expect(getMetadata).not.toHaveBeenCalled();
    getMetadata.mockRestore();

    // The saved choice remains even when the underlying track tagging changes.
    ref.current = { ...ref.current, tracks: {} };
    const saved = entities[uri];
    act(() => add("tag_house"));
    expect((kind === "artist" ? ref.current.artists : ref.current.playlists)[uri]).toBe(saved);
  });
}
