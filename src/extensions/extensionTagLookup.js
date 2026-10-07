import { buildResolvedTagLookup } from "../utils/tagTaxonomy";

export function buildExtensionTagLookup(categories, taxonomy) {
  const lookup = new Map();

  (Array.isArray(categories) ? categories : []).forEach((category) => {
    (Array.isArray(category.subcategories) ? category.subcategories : []).forEach(
      (subcategory) => {
        (Array.isArray(subcategory.tags) ? subcategory.tags : []).forEach((tag) => {
          lookup.set(tag.id, {
            categoryId: category.id,
            categoryName: category.name,
            subcategoryId: subcategory.id,
            subcategoryName: subcategory.name,
            tagId: tag.id,
            name: tag.name,
            tag: tag.name,
            accentId: tag.accentId ?? null,
          });
        });
      },
    );
  });

  if (taxonomy?.tagsById && Object.keys(taxonomy.tagsById).length > 0) {
    const resolved = buildResolvedTagLookup(taxonomy);
    Object.entries(taxonomy.tagsById).forEach(([tagId, tag]) => {
      if (!tag || typeof tag.name !== "string" || !tag.name.trim()) return;
      const location = resolved.get(tagId);
      lookup.set(tagId, {
        categoryId: location?.category.id ?? "",
        categoryName: location?.categoryName ?? "Other",
        subcategoryId: location?.subcategory?.id ?? location?.parent.id ?? "",
        subcategoryName: location?.folderPath.join(" / ") || "Tags",
        tagId,
        name: tag.name,
        tag: tag.name,
        accentId: tag.accentId ?? null,
      });
    });
  }

  return lookup;
}

export function getExtensionTagForId(tagId, lookup) {
  const resolved = lookup.get(tagId);
  return resolved
    ? { ...resolved }
    : { tagId, name: "Tag unavailable", tag: "Tag unavailable" };
}

export function resolveExtensionTagFilterLabel(filter, lookup, categories) {
  if (typeof filter === "string") {
    return lookup.get(filter)?.name || "Tag unavailable";
  }
  if (!filter || typeof filter !== "object") {
    return "Tag unavailable";
  }

  const resolved = lookup.get(filter.tagId);
  if (resolved) return resolved.name;
  if (typeof filter.name === "string" && filter.name.trim()) return filter.name;
  if (typeof filter.tag === "string" && filter.tag.trim()) return filter.tag;

  const category = (Array.isArray(categories) ? categories : []).find(
    (candidate) => candidate.id === filter.categoryId,
  );
  const subcategory = category?.subcategories?.find(
    (candidate) => candidate.id === filter.subcategoryId,
  );
  return subcategory?.tags?.find((candidate) => candidate.id === filter.tagId)
    ?.name || "Tag unavailable";
}
