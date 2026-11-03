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
export function buildStarterTaxonomy(version: StarterTagVersion): TagTaxonomy {
  const taxonomy = buildTaxonomyFromCategoryTree(starterTagTree(version));
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
 * Every starter tag set Tagify has given new libraries, oldest first. A library that still holds
 * one of these exactly has never been changed, whichever version it started with.
 */
export const KNOWN_STARTER_TAXONOMIES: readonly TagTaxonomy[] = STARTER_TAG_VERSIONS.map(buildStarterTaxonomy);

/** What a new library starts with: the current starter tags and nothing else. */
export const defaultTagData: TagDataStructure = {
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  taxonomy: buildStarterTaxonomy(CURRENT_STARTER_TAG_VERSION),
  tracks: {},
  playlists: {},
  artists: {},
  smartPlaylists: [],
};
