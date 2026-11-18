import { describe, expect, it } from "vitest";
import type { TagDataStructure } from "@/types/tagData";
import { TagsTriedHere, tagIsUnused } from "../tagsTriedHere";

const data = (parts: Partial<TagDataStructure>) => ({ tracks: {}, playlists: {}, artists: {}, smartPlaylists: [], ...parts }) as Pick<TagDataStructure, "tracks" | "playlists" | "artists" | "smartPlaylists">;

describe("tags tried on a song", () => {
  it("counts a tag in use on a song, playlist, artist, smart playlist or saved filter", () => {
    expect(tagIsUnused(data({}), "tag_1")).toBe(true);
    expect(tagIsUnused(data({ tracks: { a: { tagIds: ["tag_1"] } } as never }), "tag_1")).toBe(false);
    expect(tagIsUnused(data({ playlists: { p: { tagIds: ["tag_1"] } } as never }), "tag_1")).toBe(false);
    expect(tagIsUnused(data({ artists: { r: { tagIds: ["tag_1"] } } as never }), "tag_1")).toBe(false);
    expect(tagIsUnused(data({ smartPlaylists: [{ tagIds: ["tag_1"] }] as never }), "tag_1")).toBe(false);
    expect(tagIsUnused(data({}), "tag_1", ["tag_1"])).toBe(false);
    // A longer id containing it is a different tag.
    expect(tagIsUnused(data({ tracks: { a: { tagIds: ["tag_10"] } } as never }), "tag_1")).toBe(true);
  });

  it("gives back a song's created tags only once the member moved on, and only the unused ones", () => {
    const tried = new TagsTriedHere();
    tried.note("tag_a", "song:1");
    tried.note("tag_b", "song:1");
    tried.note("tag_c", "song:2");
    expect(tried.takeUnused("song:1", () => true)).toEqual(["tag_c"]);
    expect(tried.takeUnused("song:2", (id) => id === "tag_b")).toEqual(["tag_b"]);
    expect(tried.takeUnused(null, () => true)).toEqual([]);
  });
});
