import type { TagTaxonomy } from "@/types/tagData";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";

type NodeKind = "category" | "folder" | "tag";
interface TreeNode {
  kind: NodeKind;
  parentId: string | null;
  data: Record<string, unknown>;
}
interface Tree {
  nodes: Map<string, TreeNode>;
  order: Map<string, string[]>;
}

const ROOT = "\u0000root";
// Structure is rebuilt from parents and child order, so these lists are not compared.
const DERIVED_KEYS = new Set(["subcategoryIds", "childIds", "tagIds", "parentId", "categoryId", "subcategoryId", "themeId"]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function same(left: unknown, right: unknown): boolean {
  return left === right || stableJson(left) === stableJson(right);
}

function withoutDerived(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !DERIVED_KEYS.has(key)));
}

function readTree(taxonomy: TagTaxonomy): Tree {
  const tree = normalizeTaxonomyTree(taxonomy);
  const nodes = new Map<string, TreeNode>();
  for (const [id, category] of Object.entries(tree.categoriesById)) nodes.set(id, { kind: "category", parentId: null, data: withoutDerived(category) });
  for (const [id, folder] of Object.entries(tree.foldersById ?? {})) nodes.set(id, { kind: "folder", parentId: folder.parentId ?? folder.categoryId ?? null, data: withoutDerived(folder) });
  for (const [id, tag] of Object.entries(tree.tagsById)) nodes.set(id, { kind: "tag", parentId: tag.parentId ?? tag.subcategoryId ?? null, data: withoutDerived(tag) });
  const order = new Map<string, string[]>(Object.entries(tree.childrenByParentId ?? {}));
  order.set(ROOT, [...tree.categoryOrder, ...Object.keys(tree.categoriesById).filter((id) => !tree.categoryOrder.includes(id))]);
  return { nodes, order };
}

/** Takes the edited version of anything the edit changed, otherwise the current one. */
function pick<T>(before: T | undefined, edited: T | undefined, current: T | undefined): T | undefined {
  return same(before, edited) ? current : edited;
}

function mergeOrder(before: string[] = [], edited: string[] = [], current: string[] = [], members: Set<string>): string[] {
  const [primary, secondary] = same(before, edited) ? [current, edited] : [edited, current];
  return [...new Set([...primary, ...secondary, ...members])].filter((id) => members.has(id));
}

function mergeRecords<T>(before: Record<string, T> = {}, edited: Record<string, T> = {}, current: Record<string, T> = {}, compare: (value: T) => unknown = (value) => value): Record<string, T> {
  const result: Record<string, T> = {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(edited), ...Object.keys(current)])) {
    const value = same(before[id] === undefined ? undefined : compare(before[id]), edited[id] === undefined ? undefined : compare(edited[id]))
      ? current[id]
      : edited[id];
    if (value !== undefined) result[id] = value;
  }
  return result;
}

/**
 * Applies the tag, folder, category, color, and collection changes made in
 * `edited` (relative to `before`) to `current`. Anything the edit did not
 * touch keeps its current version, so tags created elsewhere meanwhile are
 * never lost. A folder the edit removed is kept when something new was put
 * in it elsewhere.
 */
export function mergeTaxonomy(before: TagTaxonomy, edited: TagTaxonomy, current: TagTaxonomy): TagTaxonomy {
  if (edited === before || same(before, edited)) return current;
  if (current === before || same(before, current)) return edited;

  const base = readTree(before), mine = readTree(edited), theirs = readTree(current);
  const nodes = new Map<string, TreeNode>();
  for (const id of new Set([...base.nodes.keys(), ...mine.nodes.keys(), ...theirs.nodes.keys()])) {
    const node = pick(base.nodes.get(id), mine.nodes.get(id), theirs.nodes.get(id));
    if (node) nodes.set(id, node);
  }
  // Keep the parents of anything that survived, and never create a loop.
  for (const [id, node] of [...nodes]) {
    let parentId = node.parentId;
    const seen = new Set([id]);
    while (parentId && !nodes.has(parentId)) {
      const parent = theirs.nodes.get(parentId) ?? mine.nodes.get(parentId) ?? base.nodes.get(parentId);
      if (!parent) break;
      nodes.set(parentId, parent);
      parentId = parent.parentId;
    }
    for (let cursor = node.parentId; cursor; cursor = nodes.get(cursor)?.parentId ?? null) {
      if (seen.has(cursor)) {
        nodes.set(id, { ...node, parentId: theirs.nodes.get(id)?.parentId ?? base.nodes.get(id)?.parentId ?? null });
        break;
      }
      seen.add(cursor);
    }
  }

  const membersOf = (parentId: string) => new Set([...nodes].filter(([, node]) =>
    parentId === ROOT ? node.kind === "category" : node.kind !== "category" && node.parentId === parentId).map(([id]) => id));
  const orderOf = (parentId: string) => mergeOrder(base.order.get(parentId), mine.order.get(parentId), theirs.order.get(parentId), membersOf(parentId));
  const rootCategory = (id: string): string | undefined => {
    for (let cursor: string | null = id, steps = 0; cursor && steps <= nodes.size; steps++) {
      const node = nodes.get(cursor);
      if (!node) return undefined;
      if (node.kind === "category") return cursor;
      cursor = node.parentId;
    }
    return undefined;
  };

  const merged: TagTaxonomy = {
    ...current,
    categoryOrder: orderOf(ROOT),
    categoriesById: {},
    foldersById: {},
    subcategoriesById: {},
    childrenByParentId: {},
    tagsById: {},
  };
  const isKind = (kind: NodeKind) => (id: string) => nodes.get(id)?.kind === kind;
  for (const [id, node] of nodes) {
    if (node.kind === "tag") {
      merged.tagsById[id] = { ...node.data, id, parentId: node.parentId ?? undefined, subcategoryId: node.parentId ?? "" } as TagTaxonomy["tagsById"][string];
      continue;
    }
    const children = orderOf(id);
    merged.childrenByParentId![id] = children;
    if (node.kind === "category") {
      merged.categoriesById[id] = { ...node.data, id, subcategoryIds: children.filter(isKind("folder")), childIds: children } as TagTaxonomy["categoriesById"][string];
    } else {
      const folder = {
        ...node.data, id, parentId: node.parentId ?? undefined, categoryId: rootCategory(id) ?? node.parentId ?? undefined,
        tagIds: children.filter(isKind("tag")), childIds: children,
      } as TagTaxonomy["subcategoriesById"][string];
      merged.foldersById![id] = folder;
      merged.subcategoriesById[id] = folder;
    }
  }

  const collections = mergeRecords(before.colorThemesById, edited.colorThemesById, current.colorThemesById);
  const colors = mergeRecords(before.customAccentsById, edited.customAccentsById, current.customAccentsById, withoutDerived);
  const grouped = new Set<string>();
  for (const [id, collection] of Object.entries(collections)) {
    const colorIds = collection.colorIds.filter((colorId) => colors[colorId] && !grouped.has(colorId));
    colorIds.forEach((colorId) => grouped.add(colorId));
    collections[id] = { ...collection, colorIds };
  }
  merged.colorThemesById = collections;
  merged.colorThemeOrder = mergeOrder(before.colorThemeOrder, edited.colorThemeOrder, current.colorThemeOrder, new Set(Object.keys(collections)));
  merged.ungroupedColorIds = mergeOrder(before.ungroupedColorIds, edited.ungroupedColorIds, current.ungroupedColorIds,
    new Set(Object.keys(colors).filter((id) => !grouped.has(id)))) as TagTaxonomy["ungroupedColorIds"];
  const themeOf = new Map<string, string>(Object.entries(collections).flatMap(([themeId, collection]) => collection.colorIds.map((colorId): [string, string] => [colorId, themeId])));
  merged.customAccentsById = Object.fromEntries(Object.entries(colors).map(([id, color]) => [id, { ...color, themeId: themeOf.get(id) ?? null }]));
  return merged;
}

/** Whether two tag setups contain the same tags, folders, and colors in the same places. */
export function sameTaxonomy(left: TagTaxonomy, right: TagTaxonomy): boolean {
  return left === right || same(left, right);
}
