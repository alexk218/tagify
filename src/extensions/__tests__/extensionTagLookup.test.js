import { describe, expect, it } from "vitest";
import {
  buildExtensionTagLookup,
  getExtensionTagForId,
  resolveExtensionTagFilterLabel,
} from "../extensionTagLookup";

describe("Spotify extension tag labels", () => {
  it("uses names from the current taxonomy for direct and nested tags", () => {
    const taxonomy = {
      categoryOrder: ["cat_mood"],
      categoriesById: {
        cat_mood: { id: "cat_mood", name: "Mood", subcategoryIds: ["sub_sound"], childIds: ["tag_dreamy", "sub_sound"] },
      },
      subcategoriesById: {
        sub_sound: { id: "sub_sound", name: "Sound", categoryId: "cat_mood", tagIds: [], childIds: ["sub_vocals"] },
        sub_vocals: { id: "sub_vocals", name: "Vocals", parentId: "sub_sound", categoryId: "cat_mood", tagIds: ["tag_1j9u3xh"], childIds: ["tag_1j9u3xh"] },
      },
      tagsById: {
        tag_dreamy: { id: "tag_dreamy", name: "Dreamy", parentId: "cat_mood", subcategoryId: "cat_mood" },
        tag_1j9u3xh: { id: "tag_1j9u3xh", name: "Airy vocals", parentId: "sub_vocals", subcategoryId: "sub_vocals" },
      },
      childrenByParentId: {
        cat_mood: ["tag_dreamy", "sub_sound"],
        sub_sound: ["sub_vocals"],
        sub_vocals: ["tag_1j9u3xh"],
      },
      customAccentsById: {},
      colorThemesById: {},
      ungroupedColorIds: [],
    };
    const staleLegacyCategories = [{
      id: "cat_mood",
      name: "Mood",
      subcategories: [{ id: "sub_sound", name: "Sound", tags: [] }],
    }];

    const lookup = buildExtensionTagLookup(staleLegacyCategories, taxonomy);

    expect(lookup.get("tag_dreamy")?.name).toBe("Dreamy");
    expect(lookup.get("tag_1j9u3xh")?.name).toBe("Airy vocals");
    expect(resolveExtensionTagFilterLabel("tag_1j9u3xh", lookup, staleLegacyCategories))
      .toBe("Airy vocals");
  });

  it("never displays an internal ID when its tag definition is unavailable", () => {
    expect(getExtensionTagForId("tag_1j9u3xh", new Map()).name).toBe("Tag unavailable");
    expect(resolveExtensionTagFilterLabel("tag_1j9u3xh", new Map(), []))
      .toBe("Tag unavailable");
  });

  it("keeps legacy tag names available when the taxonomy has not loaded", () => {
    const categories = [{
      id: "cat_mood",
      name: "Mood",
      subcategories: [{
        id: "sub_sound",
        name: "Sound",
        tags: [{ id: "tag_1j9u3xh", name: "Airy vocals" }],
      }],
    }];
    const lookup = buildExtensionTagLookup(categories, null);

    expect(resolveExtensionTagFilterLabel("tag_1j9u3xh", lookup, categories))
      .toBe("Airy vocals");
    expect(resolveExtensionTagFilterLabel({ tagId: "tag_1j9u3xh" }, lookup, categories))
      .toBe("Airy vocals");
  });
});
