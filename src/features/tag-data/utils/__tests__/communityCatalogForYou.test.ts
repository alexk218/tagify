import { describe, expect, it } from "vitest";
import type { TagTaxonomy } from "@/types/tagData";
import { buildOwnedTagIndex, describeYourSongs, findOwnedTag, rankTagsForYourSongs } from "../communityCatalogForYou";

const taxonomy = {
  categoryOrder: ["genre"],
  categoriesById: { genre: { id: "genre", name: "Genre & Style", subcategoryIds: ["primary"] } },
  foldersById: { primary: { id: "primary", name: "Primary Genres", parentId: "genre", categoryId: "genre", tagIds: ["rock", "vocal"] } },
  subcategoriesById: { primary: { id: "primary", name: "Primary Genres", parentId: "genre", categoryId: "genre", tagIds: ["rock", "vocal"] } },
  tagsById: {
    rock: { id: "rock", name: "Rock", parentId: "primary", subcategoryId: "primary" },
    vocal: { id: "vocal", name: "Female Vocal", parentId: "primary", subcategoryId: "primary" },
  },
  customAccentsById: {},
  colorThemesById: {},
  ungroupedColorIds: [],
} as unknown as TagTaxonomy;

describe("findOwnedTag", () => {
  const index = buildOwnedTagIndex(taxonomy);

  it("finds a tag you have whatever its case, with where it lives", () => {
    expect(findOwnedTag(index, "rock")).toEqual({
      kind: "same",
      tag: { tagId: "rock", name: "Rock", location: "Genre & Style / Primary Genres" },
    });
  });

  it("calls a near spelling similar rather than the same", () => {
    expect(findOwnedTag(index, "female vocals")).toMatchObject({ kind: "similar", tag: { name: "Female Vocal" } });
  });

  it("finds nothing for a tag you don't have", () => {
    expect(findOwnedTag(index, "dreamy")).toBeNull();
  });
});

describe("rankTagsForYourSongs", () => {
  it("ranks tags by how many of your songs carry them and counts a song once", () => {
    const ranked = rankTagsForYourSongs([
      { tags: [{ label: "dreamy", paths: ["Mood / Atmosphere / dreamy"], people: 2 }, { label: "Dreamy", paths: [], people: 1 }] },
      { tags: [{ label: "dreamy", paths: ["Mood / Atmosphere / dreamy"], people: 4 }, { label: "sad", paths: [], people: 9 }] },
      { tags: [{ label: "sad", paths: [], people: 1 }, { label: "dreamy", paths: [], people: 1 }] },
    ]);
    expect(ranked.map((tag) => [tag.name, tag.yourSongCount, tag.people, tag.usualPlace])).toEqual([
      ["dreamy", 3, 4, "Mood / Atmosphere"],
      ["sad", 2, 9, null],
    ]);
  });

  it("describes the count in plain words", () => {
    expect(describeYourSongs(1)).toBe("Others put this on 1 of your songs");
    expect(describeYourSongs(84)).toBe("Others put this on 84 of your songs");
  });
});
