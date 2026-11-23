import { isNearDuplicateTagName, tagMatchKey } from "@tagify/community-contracts";
import type { TagTaxonomy, TaxonomyFolder } from "@/types/tagData";

/** One of your own tags, with where it lives ("Genre & Style / Primary Genres"). */
export interface OwnedTag {
  tagId: string;
  name: string;
  location: string;
}

/** How a Community tag relates to your own tags. */
export type OwnedMatch =
  | { kind: "same"; tag: OwnedTag }
  | { kind: "similar"; tag: OwnedTag }
  | null;

export interface OwnedTagIndex {
  byKey: Map<string, OwnedTag>;
  all: OwnedTag[];
}

/** The folders and category a tag sits in, outermost first. */
function tagLocation(taxonomy: TagTaxonomy, tagId: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  const tag = taxonomy.tagsById[tagId];
  let parentId: string | undefined = tag?.parentId ?? tag?.subcategoryId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const category = taxonomy.categoriesById[parentId];
    if (category) {
      names.unshift(category.name);
      break;
    }
    const folder: TaxonomyFolder | undefined = taxonomy.foldersById?.[parentId] ?? taxonomy.subcategoriesById[parentId];
    if (!folder) break;
    names.unshift(folder.name);
    parentId = folder.parentId ?? folder.categoryId;
  }
  return names.join(" / ");
}

export function buildOwnedTagIndex(taxonomy: TagTaxonomy): OwnedTagIndex {
  const byKey = new Map<string, OwnedTag>();
  const all: OwnedTag[] = [];
  for (const [tagId, tag] of Object.entries(taxonomy.tagsById)) {
    const key = tagMatchKey(tag.name);
    if (!key) continue;
    const owned = { tagId, name: tag.name, location: tagLocation(taxonomy, tagId) };
    all.push(owned);
    if (!byKey.has(key)) byKey.set(key, owned);
  }
  return { byKey, all };
}

/** Whether you already have this tag, or one spelled almost the same way. */
export function findOwnedTag(index: OwnedTagIndex, name: string): OwnedMatch {
  const key = tagMatchKey(name);
  const same = key ? index.byKey.get(key) : undefined;
  if (same) return { kind: "same", tag: same };
  const similar = index.all.find((owned) => isNearDuplicateTagName(owned.name, name));
  return similar ? { kind: "similar", tag: similar } : null;
}

/** A song of yours with the tags other people put on it (the "Tagged by others" check). */
export interface SongTaggedByOthers {
  tags: ReadonlyArray<{ label: string; paths: readonly string[]; people: number }>;
}

/** A Community tag ranked by how many of your songs other people gave it. */
export interface TagForYourSongs {
  key: string;
  name: string;
  /** Your songs other people gave this tag. */
  yourSongCount: number;
  /** The most people on any one of those songs. */
  people: number;
  /** Where people usually keep it, "Category / Folder", without the tag itself. */
  usualPlace: string | null;
}

/** Tags others put on your songs, most of your songs first. */
export function rankTagsForYourSongs(songs: readonly SongTaggedByOthers[]): TagForYourSongs[] {
  const byKey = new Map<string, TagForYourSongs & { names: Map<string, number>; places: Map<string, number> }>();
  for (const song of songs) {
    const counted = new Set<string>();
    for (const tag of song.tags) {
      const key = tagMatchKey(tag.label);
      if (!key || counted.has(key)) continue;
      counted.add(key);
      let entry = byKey.get(key);
      if (!entry) {
        entry = { key, name: tag.label, yourSongCount: 0, people: 0, usualPlace: null, names: new Map(), places: new Map() };
        byKey.set(key, entry);
      }
      entry.yourSongCount += 1;
      entry.people = Math.max(entry.people, tag.people);
      entry.names.set(tag.label, (entry.names.get(tag.label) ?? 0) + 1);
      const place = tag.paths[0]?.split(" / ").slice(0, -1).join(" / ");
      if (place) entry.places.set(place, (entry.places.get(place) ?? 0) + 1);
    }
  }
  const mostCommon = (counts: Map<string, number>) =>
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return [...byKey.values()]
    .map(({ names, places, ...entry }) => ({ ...entry, name: mostCommon(names) ?? entry.name, usualPlace: mostCommon(places) }))
    .sort((a, b) => b.yourSongCount - a.yourSongCount || b.people - a.people || a.name.localeCompare(b.name));
}

export function describeYourSongs(count: number): string {
  return count === 1 ? "Others put this on 1 of your songs" : `Others put this on ${count.toLocaleString()} of your songs`;
}
