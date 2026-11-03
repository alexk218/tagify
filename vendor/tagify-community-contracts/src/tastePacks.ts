import data from "../fixtures/taste-packs.json";
import { sameTagNameKey, tagSlug } from "./tagNames";

/**
 * Taste packs: a folder of tags a member adds by what they listen to ("Metal & Heavy"). Each pack
 * lives at the end of Genre & Style. Community (add_taste_packs_v1) and Tagify desktop install
 * them with the same rules, written once here as `planTastePackInstall` and checked against the
 * shared cases in fixtures/taste-pack-install-cases.json.
 */

/** Tagify's node IDs: a kind prefix and up to 13 base-36 characters. */
export const TAGIFY_NODE_ID_PATTERN = /^(cat|sub|tag)_[0-9a-z]{1,13}$/;

export interface TastePackTag {
  id: string;
  name: string;
  /** The tag's value in Community's Genre directory, where its name comes from; null for a name the directory doesn't have. */
  directorySlug: string | null;
}

export interface TastePack {
  key: string;
  /** The folder's name, also the pack's name on screen. */
  name: string;
  folderId: string;
  /** Most used first. */
  tags: readonly TastePackTag[];
}

/** The category every pack folder goes into, brought back when the member removed it. */
export interface TastePackHome {
  id: string;
  name: string;
}

export const TASTE_PACK_HOME: TastePackHome = data.home;
export const TASTE_PACKS: readonly TastePack[] = data.packs;
/** How many tags a pack shows before it's added. */
export const TASTE_PACK_SAMPLE_TAGS = 4;

/** Tagify's deterministic node ID (createDeterministicOpaqueId in Tagify's src/utils/tagTaxonomy.ts). */
export function tagifyNodeId(prefix: "cat" | "sub" | "tag", seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return `${prefix}_${hash.toString(36)}`;
}

export function tastePackFolderId(key: string): string {
  return tagifyNodeId("sub", `taste-pack:folder:${key}`);
}

/**
 * One ID per tag page, so a tag shared by two packs is one tag. The exceptions are tags version 1
 * of the starter tags had (Lo-fi, Blues, Country, Reggae): the fixture keeps their old IDs, so a
 * library that still has the old tag doesn't get a second one.
 */
export function tastePackTagId(name: string): string {
  return tagifyNodeId("tag", `taste-pack:tag:${tagSlug(name)}`);
}

export function findTastePack(key: string): TastePack | undefined {
  return TASTE_PACKS.find((pack) => pack.key === key);
}

/** A node of the member's tags as the planner reads it. A deleted one can come back under its ID. */
export interface TastePackLibraryNode {
  id: string;
  kind: "category" | "folder" | "subcategory" | "tag";
  parentId: string | null;
  name: string;
  position: number;
  deleted?: boolean;
}

/** One node to create, or bring back, in the order to send them: parents first. */
export interface TastePackUpsert {
  id: string;
  kind: "category" | "folder" | "tag";
  parentId: string | null;
  name: string;
  position: number;
}

export interface TastePackInstallResult {
  key: string;
  /** Where the pack's new tags go, or null when it adds none. */
  folderId: string | null;
  /** IDs of the tags this pack adds, in the pack's order. */
  added: string[];
  /** Tags the member has already: under the pack's ID anywhere, or a tag with the same name. */
  skipped: Array<{ id: string; name: string; reason: "has-id" | "same-name" }>;
}

export interface TastePackInstallPlan {
  upserts: TastePackUpsert[];
  packs: TastePackInstallResult[];
}

/**
 * What adding these packs changes, in Tagify's pack order whatever order `keys` has:
 * - A tag is skipped when a live node has its ID, wherever the member moved it, or when a live tag
 *   has the same name (`isSameTagName`), so "heavy-metal" keeps the member's own spelling.
 *   Otherwise it's added, and one the member deleted comes back under its old ID.
 * - New tags go at the end of the pack's folder. A live folder is reused wherever it is; a missing
 *   or deleted one goes at the end of Genre & Style, which comes back holding only pack folders
 *   when the member removed it.
 * - A pack with nothing new adds no folder, so adding packs again changes nothing.
 * - Nothing is renamed, moved or removed. New nodes get the pack's names.
 */
export function planTastePackInstall(nodes: readonly TastePackLibraryNode[], keys: readonly string[]): TastePackInstallPlan {
  const wanted = new Set(keys);
  for (const key of wanted) if (!findTastePack(key)) throw new Error(`Unknown taste pack: ${key}`);

  const live = new Set<string>();
  const takenNames = new Set<string>();
  const lastPosition = new Map<string, number>();
  const parentKey = (parentId: string | null) => parentId ?? "";
  for (const node of nodes) {
    if (node.deleted) continue;
    live.add(node.id);
    if (node.kind === "tag") takenNames.add(sameTagNameKey(node.name));
    const key = parentKey(node.parentId);
    lastPosition.set(key, Math.max(lastPosition.get(key) ?? -1, node.position));
  }
  takenNames.delete("");
  const place = (parentId: string | null) => {
    const position = (lastPosition.get(parentKey(parentId)) ?? -1) + 1;
    lastPosition.set(parentKey(parentId), position);
    return position;
  };

  const upserts: TastePackUpsert[] = [];
  const packs: TastePackInstallResult[] = [];
  for (const pack of TASTE_PACKS) {
    if (!wanted.has(pack.key)) continue;
    const result: TastePackInstallResult = { key: pack.key, folderId: null, added: [], skipped: [] };
    packs.push(result);
    const adding: TastePackTag[] = [];
    for (const tag of pack.tags) {
      const nameKey = sameTagNameKey(tag.name);
      if (live.has(tag.id)) result.skipped.push({ id: tag.id, name: tag.name, reason: "has-id" });
      else if (takenNames.has(nameKey)) result.skipped.push({ id: tag.id, name: tag.name, reason: "same-name" });
      else {
        adding.push(tag);
        live.add(tag.id);
        takenNames.add(nameKey);
      }
    }
    if (adding.length === 0) continue;

    if (!live.has(pack.folderId)) {
      if (!live.has(TASTE_PACK_HOME.id)) {
        upserts.push({ id: TASTE_PACK_HOME.id, kind: "category", parentId: null, name: TASTE_PACK_HOME.name, position: place(null) });
        live.add(TASTE_PACK_HOME.id);
      }
      upserts.push({ id: pack.folderId, kind: "folder", parentId: TASTE_PACK_HOME.id, name: pack.name, position: place(TASTE_PACK_HOME.id) });
      live.add(pack.folderId);
    }
    for (const tag of adding) {
      upserts.push({ id: tag.id, kind: "tag", parentId: pack.folderId, name: tag.name, position: place(pack.folderId) });
      result.added.push(tag.id);
    }
    result.folderId = pack.folderId;
  }
  return { upserts, packs };
}
