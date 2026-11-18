// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TagTaxonomy } from "@/types/tagData";
import {
  getTopLevelSelectedFolderIds,
  isWithinAnyFolder,
  moveSubcategoriesToParent,
  moveTagsToParent,
  removeTags,
  setTagsAccent,
} from "../tagManager.taxonomy";

type FolderSpec = { id: string; name: string; tags?: Array<[string, string]>; folders?: FolderSpec[] };

/** Builds a taxonomy with readable ids and nested folders. */
function buildTaxonomy(categories: Array<{ id: string; name: string; folders: FolderSpec[] }>): TagTaxonomy {
  const taxonomy: TagTaxonomy = {
    categoryOrder: [],
    categoriesById: {},
    foldersById: {},
    childrenByParentId: {},
    subcategoriesById: {},
    tagsById: {},
    customAccentsById: {},
    colorThemesById: {},
    ungroupedColorIds: [],
  };
  const addFolder = (folder: FolderSpec, parentId: string, categoryId: string) => {
    const tagIds = (folder.tags ?? []).map(([id]) => id);
    const childFolderIds = (folder.folders ?? []).map((child) => child.id);
    taxonomy.subcategoriesById[folder.id] = {
      id: folder.id,
      name: folder.name,
      parentId,
      categoryId,
      tagIds,
      childIds: [...tagIds, ...childFolderIds],
    };
    taxonomy.foldersById![folder.id] = taxonomy.subcategoriesById[folder.id];
    taxonomy.childrenByParentId![folder.id] = [...tagIds, ...childFolderIds];
    (folder.tags ?? []).forEach(([id, name]) => {
      taxonomy.tagsById[id] = { id, name, parentId: folder.id, subcategoryId: folder.id };
    });
    (folder.folders ?? []).forEach((child) => addFolder(child, folder.id, categoryId));
  };
  categories.forEach((category) => {
    const folderIds = category.folders.map((folder) => folder.id);
    taxonomy.categoryOrder.push(category.id);
    taxonomy.categoriesById[category.id] = {
      id: category.id,
      name: category.name,
      subcategoryIds: folderIds,
      childIds: [...folderIds],
    };
    taxonomy.childrenByParentId![category.id] = [...folderIds];
    category.folders.forEach((folder) => addFolder(folder, category.id, category.id));
  });
  return taxonomy;
}

function createTaxonomy(): TagTaxonomy {
  return buildTaxonomy([
    {
      id: "genre",
      name: "Genre",
      folders: [
        {
          id: "electronic",
          name: "Electronic",
          tags: [["house", "House"], ["techno", "Techno"], ["trance", "Trance"], ["ambient", "Ambient"]],
          folders: [
            { id: "deep", name: "Deep", tags: [["deep-house", "House"]], folders: [{ id: "deeper", name: "Deeper" }] },
          ],
        },
        { id: "rock", name: "Rock", tags: [["punk", "Punk"]] },
      ],
    },
    { id: "mood", name: "Mood", folders: [{ id: "energy", name: "Energy" }] },
  ]);
}

const tagNames = (taxonomy: TagTaxonomy, parentId: string) =>
  (taxonomy.childrenByParentId?.[parentId] ?? [])
    .filter((id) => taxonomy.tagsById[id])
    .map((id) => taxonomy.tagsById[id].name);

describe("moveTagsToParent", () => {
  it("moves several tags into a folder, in order, at the end", () => {
    const result = moveTagsToParent(createTaxonomy(), ["trance", "techno"], "energy");

    expect(result.movedIds).toEqual(["trance", "techno"]);
    expect(result.blocked).toEqual([]);
    expect(tagNames(result.taxonomy, "energy")).toEqual(["Trance", "Techno"]);
    expect(tagNames(result.taxonomy, "electronic")).toEqual(["House", "Ambient"]);
    expect(result.taxonomy.tagsById.trance.parentId).toBe("energy");
    expect(result.taxonomy.subcategoriesById.energy.tagIds).toEqual(["trance", "techno"]);
  });

  it("moves the rest when one tag's name already exists in the destination", () => {
    const result = moveTagsToParent(createTaxonomy(), ["house", "techno"], "deep");

    expect(result.movedIds).toEqual(["techno"]);
    expect(result.blocked).toEqual([{ id: "house", reason: "duplicate-tag-name" }]);
    expect(tagNames(result.taxonomy, "deep")).toEqual(["House", "Techno"]);
    expect(result.taxonomy.tagsById.house.parentId).toBe("electronic");
  });

  it("reorders a group within its folder as one block", () => {
    const result = moveTagsToParent(createTaxonomy(), ["trance", "ambient"], "electronic", 0);

    expect(tagNames(result.taxonomy, "electronic")).toEqual(["Trance", "Ambient", "House", "Techno"]);
  });

  it("inserts a group after an earlier tag of the same folder", () => {
    const children = createTaxonomy().childrenByParentId!.electronic;
    const result = moveTagsToParent(createTaxonomy(), ["house", "techno"], "electronic", children.indexOf("ambient"));

    expect(tagNames(result.taxonomy, "electronic")).toEqual(["Trance", "House", "Techno", "Ambient"]);
  });

  it("reports tags already in place as unchanged", () => {
    const result = moveTagsToParent(createTaxonomy(), ["punk"], "rock");

    expect(result.movedIds).toEqual([]);
    expect(result.unchangedIds).toEqual(["punk"]);
  });
});

describe("moveSubcategoriesToParent", () => {
  it("moves several folders into another category", () => {
    const result = moveSubcategoriesToParent(createTaxonomy(), ["rock", "deep"], "mood");

    expect(result.movedIds).toEqual(["rock", "deep"]);
    expect(result.taxonomy.childrenByParentId?.mood).toEqual(["energy", "rock", "deep"]);
    expect(result.taxonomy.subcategoriesById.deep.categoryId).toBe("mood");
    expect(result.taxonomy.subcategoriesById.deeper.categoryId).toBe("mood");
  });

  it("moves a selected folder's selected subfolder along with it", () => {
    expect(getTopLevelSelectedFolderIds(createTaxonomy(), ["deeper", "electronic"])).toEqual(["electronic"]);

    const result = moveSubcategoriesToParent(createTaxonomy(), ["deeper", "electronic"], "mood");

    expect(result.movedIds).toEqual(["electronic"]);
    expect(result.taxonomy.subcategoriesById.deeper.parentId).toBe("deep");
  });

  it("won't put a folder inside itself", () => {
    const result = moveSubcategoriesToParent(createTaxonomy(), ["electronic", "rock"], "deep");

    expect(result.blocked).toEqual([{ id: "electronic", reason: "invalid-descendant" }]);
    expect(result.movedIds).toEqual(["rock"]);
    expect(result.taxonomy.subcategoriesById.rock.parentId).toBe("deep");
  });
});

describe("isWithinAnyFolder", () => {
  it("is true for a selected folder and anything nested inside one", () => {
    const taxonomy = createTaxonomy();
    expect(isWithinAnyFolder(taxonomy, "electronic", ["electronic", "rock"])).toBe(true);
    expect(isWithinAnyFolder(taxonomy, "deep", ["electronic", "rock"])).toBe(true);
    expect(isWithinAnyFolder(taxonomy, "deeper", ["electronic", "rock"])).toBe(true);
    expect(isWithinAnyFolder(taxonomy, "energy", ["electronic", "rock"])).toBe(false);
  });
});

describe("setTagsAccent and removeTags", () => {
  it("colors and clears several tags", () => {
    const colored = setTagsAccent(createTaxonomy(), ["house", "techno"], "teal");
    expect(colored.tagsById.house.accentId).toBe("teal");
    expect(colored.tagsById.techno.accentId).toBe("teal");
    expect(colored.tagsById.trance.accentId ?? null).toBeNull();

    const cleared = setTagsAccent(colored, ["house"], null);
    expect(cleared.tagsById.house.accentId).toBeNull();
    expect(cleared.tagsById.techno.accentId).toBe("teal");
  });

  it("returns the same taxonomy when nothing changes", () => {
    const taxonomy = createTaxonomy();
    expect(setTagsAccent(taxonomy, ["house"], null)).toBe(taxonomy);
    expect(removeTags(taxonomy, ["missing"])).toBe(taxonomy);
  });

  it("removes several tags from their folders", () => {
    const result = removeTags(createTaxonomy(), ["house", "punk"]);

    expect(result.tagsById.house).toBeUndefined();
    expect(result.tagsById.punk).toBeUndefined();
    expect(tagNames(result, "electronic")).toEqual(["Techno", "Trance", "Ambient"]);
    expect(result.subcategoriesById.rock.tagIds).toEqual([]);
    expect(result.subcategoriesById.electronic.tagIds).not.toContain("house");
  });
});
