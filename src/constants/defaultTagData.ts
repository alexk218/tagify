import {
  CURRENT_STARTER_TAG_VERSION,
  STARTER_TAG_VERSIONS,
  starterTagTree,
  type StarterTagVersion,
} from "@tagify/sync-contracts";
import { TagDataStructure, TagTaxonomy } from "@/types/tagData";
import {
  buildTaxonomyFromCategoryTree,
  TAG_DATA_SCHEMA_VERSION,
} from "@/utils/tagTaxonomy";
import { normalizeColorLibrary } from "@/features/tag-data/utils/tagColorThemes";

/**
 * The starter tags of one version, as a new library stores them. The tree and its IDs come from
 * the seed Tagify desktop and Community share (@tagify/sync-contracts starterTags.ts), so a
 * library started on either side has the same tags.
 */
export function buildStarterTaxonomy(version: StarterTagVersion, categoryIds?: readonly string[]): TagTaxonomy {
  const tree = starterTagTree(version);
  const taxonomy = buildTaxonomyFromCategoryTree(categoryIds ? tree.filter((category) => categoryIds.includes(category.id)) : tree);
  return {
    ...taxonomy,
    ...normalizeColorLibrary({
      ...taxonomy,
      colorThemesById: undefined,
      ungroupedColorIds: undefined,
    }),
  };
}

/**
 * "Moods and moments": the starter tags' Mood & Energy and Usage & Context, under the same IDs. A
 * new library that answers "What do you listen to?" starts from these plus the packs it picked,
 * like a new member on the Community website and on iPhone (Community's starter set `moods`).
 */
export const MOODS_STARTER_CATEGORY_IDS: readonly string[] = ["cat_4pcgqb", "cat_v7c060"];
export const buildMoodsStarterTaxonomy = (): TagTaxonomy => buildStarterTaxonomy(CURRENT_STARTER_TAG_VERSION, MOODS_STARTER_CATEGORY_IDS);

/**
 * Every starter tag set Tagify has given new libraries, oldest first, and "Moods and moments". A
 * library that still holds one of these exactly has never been changed, whichever it started with.
 */
export const KNOWN_STARTER_TAXONOMIES: readonly TagTaxonomy[] = [
  ...STARTER_TAG_VERSIONS.map((version) => buildStarterTaxonomy(version)),
  buildMoodsStarterTaxonomy(),
];

/** What a new library starts with: the current starter tags and nothing else. */
export const defaultTagData: TagDataStructure = {
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  taxonomy: buildStarterTaxonomy(CURRENT_STARTER_TAG_VERSION),
  tracks: {},
  playlists: {},
  artists: {},
  smartPlaylists: [],
};
