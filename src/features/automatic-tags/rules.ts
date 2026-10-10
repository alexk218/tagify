import type { BatchTagUpdate, TagDataStructure } from "@/types/tagData";

export interface TagCondition { field: "length" | "bpm"; min?: number; max?: number }
export interface AutomaticTagRule {
  id: string; name: string; enabled: boolean; scopes: string[];
  conditions: TagCondition[]; tagIds: string[]; otherwiseTagIds: string[];
}
export interface RuleFacts { durationMs?: number; albumUri?: string; artistUris?: string[]; name?: string; artists?: string }
export interface RuleContext {
  facts: Readonly<Record<string, RuleFacts>>;
  playlists: Readonly<Record<string, ReadonlySet<string> | undefined>>;
  albums?: Readonly<Record<string, ReadonlySet<string> | undefined>>;
}
export function normalizeRules(value: unknown): AutomaticTagRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 20).flatMap((item): AutomaticTagRule[] => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 100 || seen.has(item.id) ||
      typeof item.name !== "string" || !item.name.trim() || item.name.length > 60 ||
      !Array.isArray(item.scopes) || item.scopes.length > 5 || item.scopes.some((uri: unknown) => typeof uri !== "string" || !/^spotify:(playlist|album|artist):[A-Za-z0-9]+$/.test(uri)) ||
      !Array.isArray(item.conditions) || item.conditions.length > 5 ||
      item.conditions.some((c: TagCondition) => !c || !["length", "bpm"].includes(c.field) ||
        (c.min === undefined && c.max === undefined) ||
        [c.min, c.max].some(v => v !== undefined && (!Number.isFinite(v) || v < 0 || v > (c.field === "bpm" ? 1000 : 86400))) ||
        (c.min !== undefined && c.max !== undefined && c.min > c.max)) ||
      (!item.conditions.length && !item.scopes.length) ||
      !Array.isArray(item.tagIds) || !item.tagIds.length || item.tagIds.length > 20 ||
      !Array.isArray(item.otherwiseTagIds) || item.otherwiseTagIds.length > 20 ||
      [...item.tagIds, ...item.otherwiseTagIds].some(id => typeof id !== "string" || !id || id.length > 200)) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name.trim(), enabled: item.enabled === true,
      scopes: [...new Set<string>(item.scopes)], conditions: item.conditions,
      tagIds: [...new Set<string>(item.tagIds)], otherwiseTagIds: [...new Set<string>(item.otherwiseTagIds)] }];
  });
}

/** Missing details mean unknown, never the Otherwise branch. All scopes intersect. */
export function ruleMatch(rule: AutomaticTagRule, uri: string, data: TagDataStructure, context: RuleContext): boolean | null | "outside" {
  const track = data.tracks[uri];
  if (!track) return null;
  const facts = context.facts[uri];
  for (const scope of rule.scopes) {
    if (scope.startsWith("spotify:playlist:")) {
      const members = context.playlists[scope];
      if (!members) return null;
      if (!members.has(uri)) return "outside";
    } else if (scope.startsWith("spotify:album:")) {
      const members = context.albums?.[scope];
      if (members) { if (!members.has(uri)) return "outside"; continue; }
      const album = track.albumUri || facts?.albumUri;
      if (!album) return null;
      if (album !== scope) return "outside";
    } else {
      if (!facts?.artistUris) return null;
      if (!facts.artistUris.includes(scope)) return "outside";
    }
  }
  const values = rule.conditions.map(c => c.field === "bpm" ? track.bpm : (facts?.durationMs ?? track.recordingIdentity?.durationMs ?? 0) / 1000);
  if (values.some(v => typeof v !== "number" || !Number.isFinite(v) || v <= 0)) return null;
  return rule.conditions.every((c, i) => (c.min === undefined || values[i]! >= c.min) && (c.max === undefined || values[i]! <= c.max));
}

export function planRule(rule: AutomaticTagRule, data: TagDataStructure, context: RuleContext) {
  const savedUris = new Set(Object.keys(data.tracks));
  data = ruleCandidates(rule, data, context);
  const updates: BatchTagUpdate[] = [];
  let unknown = 0, matched = 0;
  for (const [uri, track] of Object.entries(data.tracks)) {
    const match = ruleMatch(rule, uri, data, context);
    if (match === "outside") continue;
    if (match === null) { unknown++; continue; }
    // A new annotation needs a recognizable song, even for membership-only rules.
    if (!savedUris.has(uri) && (!context.facts[uri]?.name || !context.facts[uri]?.artists)) { unknown++; continue; }
    if (match) matched++;
    const wanted = match ? rule.tagIds : rule.otherwiseTagIds;
    const toAdd = wanted.filter(id => data.taxonomy.tagsById[id] && !track.tagIds.includes(id));
    if (toAdd.length) updates.push({ trackUri: uri, toAdd, toRemove: [], automaticRuleIds: [rule.id],
      ...(context.facts[uri]?.name ? { trackDetails: { name: context.facts[uri].name, artists: context.facts[uri].artists } } : {}),
      ...(context.facts[uri]?.albumUri ? { albumDetails: { albumUri: context.facts[uri].albumUri } } : {}),
    });
  }
  return { updates, unknown, matched };
}

/** Chosen albums/playlists can include untagged songs; a full artist catalog is never scanned. */
export function ruleCandidates(rule: AutomaticTagRule, data: TagDataStructure, context: RuleContext): TagDataStructure {
  const tracks = { ...data.tracks };
  for (const scope of rule.scopes) {
    const members = scope.startsWith("spotify:playlist:") ? context.playlists[scope] : context.albums?.[scope];
    for (const uri of members || []) {
      if (!tracks[uri]) tracks[uri] = { rating: 0, energy: 0, bpm: null, tagIds: [],
        name: context.facts[uri]?.name, artists: context.facts[uri]?.artists, albumUri: context.facts[uri]?.albumUri };
    }
  }
  return { ...data, tracks };
}

export function spotifyScope(value: string): string | null {
  const uri = value.trim();
  if (/^spotify:(playlist|album|artist):[A-Za-z0-9]+$/.test(uri)) return uri;
  try {
    const url = new URL(uri);
    if (url.hostname !== "open.spotify.com") return null;
    const match = url.pathname.match(/\/(playlist|album|artist)\/([A-Za-z0-9]+)\/?$/);
    return match ? `spotify:${match[1]}:${match[2]}` : null;
  } catch { return null; }
}
