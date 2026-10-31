/**
 * Website edits to a member's own private library. Community commits each
 * request as one ordinary sync batch from the sign-in's web device, so Tagify
 * desktop receives website edits through its normal pull.
 */

export const WEB_EDIT_LIMITS = {
  creates: 200,
  items: 100,
  tagsPerItem: 50,
  operations: 500,
  /** A category is depth 1; folders may nest until depth 8. */
  maxDepth: 8,
  lookupItems: 100,
  nameLength: 80,
} as const;

export const PRESET_ACCENT_IDS = ["blue", "teal", "green", "amber", "rose", "slate"] as const;

export type WebNodeKind = "category" | "folder" | "tag";

export interface WebTaxonomyCreateV1 {
  id: string;
  kind: WebNodeKind;
  /** An existing node, a node created earlier in the same request, or null for a category. */
  parentId: string | null;
  name: string;
  accentId?: string | null;
}

export interface WebItemTagEditV1 {
  catalogEntityId: string;
  add?: string[];
  remove?: string[];
}

export interface WebLibraryEditsV1 {
  create?: WebTaxonomyCreateV1[];
  items?: WebItemTagEditV1[];
}

export interface MyItemTagsV1 {
  catalogEntityId: string;
  tagIds: string[];
}

export interface WebLibraryEditResultV1 {
  status: "applied" | "unchanged";
  duplicate: boolean;
  /** Requested node ID → the node that now holds it (itself, or a same-named node it merged into). */
  idMap: Record<string, string>;
  headCursor: number;
  taxonomyRevision: number;
  items: MyItemTagsV1[];
}

export interface MyTaxonomyNodeV1 {
  id: string;
  kind: "category" | "folder" | "subcategory" | "tag";
  parentId: string | null;
  name: string;
  accentId: string | null;
  position: number;
}

export interface MyCustomColorV1 {
  id: string;
  name: string;
  color: string;
}

export interface MyLibraryTaxonomyV1 {
  hasLibrary: boolean;
  libraryId?: string;
  connected: boolean;
  /** Tagify's first backup is still running; website edits wait for it. */
  settingUp?: boolean;
  /** The member has linked Tagify desktop at some point, so they can keep tags private. */
  desktopMember?: boolean;
  /** Whether the member's account can tag from the website at all. */
  profileState?: "ready" | "needs-handle" | "suspended";
  headCursor: number;
  taxonomyRevision: number;
  nodes: MyTaxonomyNodeV1[];
  colors: MyCustomColorV1[];
}

export interface MyLibraryTagsV1 {
  hasLibrary: boolean;
  libraryId?: string;
  connected: boolean;
  settingUp?: boolean;
  headCursor: number;
  taxonomyRevision: number;
  items: MyItemTagsV1[];
}

/** Website error codes raised by the edit function, besides 22023 (invalid request) and 28000 (sign-in). */
export const WEB_EDIT_ERROR_CODES = {
  notConnected: "TWC01",
  rateLimited: "TWR01",
  staleTaxonomy: "TWT01",
  settingUp: "TWU01",
} as const;

const ID_PREFIX: Record<WebNodeKind, string> = { category: "cat", folder: "sub", tag: "tag" };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NODE_ID = new RegExp(`^(cat|sub|tag)_${UUID}$`);
const CATALOG_ID = new RegExp(`^${UUID}$`);

/** A new node ID in the form Tagify desktop creates (`cat_`, `sub_` or `tag_` + UUID). */
export function createWebNodeId(kind: WebNodeKind): string {
  return `${ID_PREFIX[kind]}_${crypto.randomUUID()}`;
}

// The spaces Community collapses and trims, identical to the database's class.
const SPACES = "\\t\\n\\u000b\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200b\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const SPACE_RUN = new RegExp(`[${SPACES}]+`, "g");
const EDGE_SPACES = new RegExp(`^[${SPACES}]+|[${SPACES}]+$`, "g");

/** A name as Community stores it: with surrounding spaces of any kind removed. */
export function trimWebNodeName(name: string): string {
  return name.replace(EDGE_SPACES, "");
}

/**
 * Same-name matching for tag structure: compatible Unicode forms first, then
 * every kind of space collapsed and trimmed, then case-insensitive. Mirrors
 * `tagify_sync.taxonomy_name_key`, which is authoritative.
 */
export function taxonomyNameKey(name: string): string {
  return name.normalize("NFKC").replace(SPACE_RUN, " ").replace(/^ | $/g, "").toLowerCase();
}

// Characters that show nothing yet change how a name reads or which names match: soft
// hyphens, text-direction marks and overrides, invisible operators, fillers and blank
// patterns. Zero-width spaces and byte order marks only count inside a name; at its edges
// they are trimmed. `tagify_sync.web_node_name_hidden` uses the identical lists.
const HIDDEN = "\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u200b\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\u2800\\u3164\\ufeff\\uffa0\\ufff9-\\ufffb\\u{1bca0}-\\u{1bca3}\\u{1d173}-\\u{1d17a}\\u{e0001}";
// Joiners shape emoji and many scripts, so they may only sit between two non-ASCII characters.
const JOINERS = "\\u200c\\u200d";
// What draws nothing on its own: combining marks (the tag slug's ranges), variation selectors and emoji tag letters.
const MARKS = "\\u0300-\\u036f\\u1ab0-\\u1aff\\u1dc0-\\u1dff\\u20d0-\\u20ff\\ufe00-\\ufe0f\\ufe20-\\ufe2f\\u{e0020}-\\u{e007f}\\u{e0100}-\\u{e01ef}";
const HIDDEN_CHARACTER = new RegExp(`[${HIDDEN}]|(?:^|[\\u0001-\\u007f${SPACES}${JOINERS}])[${JOINERS}]|[${JOINERS}](?:$|[\\u0001-\\u007f${SPACES}])`, "u");
const HIDDEN_CHARACTERS = new RegExp(`[${HIDDEN}]`, "gu");
const STRAY_JOINERS = new RegExp(`(^|[\\u0001-\\u007f${SPACES}${JOINERS}])[${JOINERS}]|[${JOINERS}](?=$|[\\u0001-\\u007f${SPACES}])`, "gu");
const NOTHING_VISIBLE = new RegExp(`^[${SPACES}${JOINERS}${MARKS}]*$`, "u");
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Whether a name has characters people can't see (or only those), so it would look like
 * another name without matching it.
 */
function hasHiddenCharacters(trimmed: string): boolean {
  return HIDDEN_CHARACTER.test(trimmed) || NOTHING_VISIBLE.test(trimmed);
}

/**
 * A name as Community stores it: trimmed, 1–80 characters, no angle brackets, control
 * characters or characters people can't see.
 */
export function isValidWebNodeName(name: string): boolean {
  const trimmed = trimWebNodeName(name);
  return [...trimmed].length >= 1 && [...trimmed].length <= WEB_EDIT_LIMITS.nameLength && !/[<>]/.test(trimmed)
    && !CONTROL.test(trimmed) && !hasHiddenCharacters(trimmed);
}

/** Why a typed name can't be used, in the member's words, or null when it can. */
export function webNodeNameProblem(name: string): string | null {
  const trimmed = trimWebNodeName(name);
  if (!trimmed) return null;
  if (/[<>]/.test(trimmed)) return "Names can't use < or >.";
  if ([...trimmed].length > WEB_EDIT_LIMITS.nameLength) return "Names can be up to 80 characters.";
  if (CONTROL.test(trimmed)) return "Names can't include line breaks or tabs.";
  if (NOTHING_VISIBLE.test(trimmed)) return "Names need at least one letter, number or symbol.";
  if (HIDDEN_CHARACTER.test(trimmed)) return "Names can't include hidden characters. Try typing the name instead of pasting it.";
  return null;
}

/**
 * Someone else's name, ready to be saved as the member's own: without the hidden characters
 * Community refuses, so copying a tag never fails because of something nobody can see.
 */
export function withoutHiddenCharacters(name: string): string {
  let result = trimWebNodeName(name.replace(HIDDEN_CHARACTERS, ""));
  // Removing a joiner can leave the next one at an edge, so repeat until nothing changes.
  for (let previous = ""; previous !== result; ) {
    previous = result;
    result = trimWebNodeName(result.replace(STRAY_JOINERS, "$1"));
  }
  return result;
}

function fail(message: string): never {
  throw new TypeError(message);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) fail(`${label} must be a list of tag IDs`);
  if (value.length > WEB_EDIT_LIMITS.tagsPerItem) fail(`${label} has too many tags`);
}

/** Checks the request shape and limits the database enforces, so the website can fail early. */
export function assertWebLibraryEdits(value: unknown): asserts value is WebLibraryEditsV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Edits must be an object");
  const { create = [], items = [] } = value as WebLibraryEditsV1;
  if (!Array.isArray(create) || !Array.isArray(items)) fail("Edits must list creates and items");
  if (create.length === 0 && items.length === 0) fail("There are no changes");
  if (create.length > WEB_EDIT_LIMITS.creates || items.length > WEB_EDIT_LIMITS.items) fail("Too many changes at once");

  const created = new Set<string>();
  for (const node of create) {
    if (!node || typeof node !== "object") fail("Invalid tag change");
    const prefix = ID_PREFIX[node.kind as WebNodeKind];
    if (!prefix || typeof node.id !== "string" || !NODE_ID.test(node.id) || !node.id.startsWith(`${prefix}_`)) fail("Invalid tag change");
    if (created.has(node.id)) fail("Invalid tag change");
    if (typeof node.name !== "string" || !isValidWebNodeName(node.name)) fail("Names need 1 to 80 characters without < or >");
    if (node.kind === "category" ? node.parentId !== null : typeof node.parentId !== "string") fail("Invalid tag change");
    if (node.accentId != null && typeof node.accentId !== "string") fail("Invalid tag color");
    created.add(node.id);
  }

  const seen = new Set<string>();
  let operations = create.length;
  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.catalogEntityId !== "string" || !CATALOG_ID.test(item.catalogEntityId)) fail("Invalid tag change");
    if (seen.has(item.catalogEntityId)) fail("Invalid tag change");
    seen.add(item.catalogEntityId);
    assertStringArray(item.add, "Added tags");
    assertStringArray(item.remove, "Removed tags");
    const removed = new Set(item.remove ?? []);
    if ((item.add ?? []).some((tagId) => removed.has(tagId))) fail("A tag cannot be added and removed together");
    operations += (item.add?.length ?? 0) + (item.remove?.length ?? 0);
  }
  if (operations > WEB_EDIT_LIMITS.operations) fail("Too many changes at once");
}
