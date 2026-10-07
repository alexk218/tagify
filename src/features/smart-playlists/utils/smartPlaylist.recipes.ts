import type {
  SmartPlaylistCriteria,
  SmartPlaylistFilterCriteria,
  SmartPlaylistRecipe,
  SmartPlaylistRecipeBundle,
  SmartPlaylistRecipeTagReference,
} from "@/features/smart-playlists/model/smartPlaylist.types";
import type { TagTaxonomy } from "@/types/tagData";
import {
  buildResolvedTagLookup,
  createEntityId,
  normalizeTaxonomyTree,
} from "@/utils/tagTaxonomy";
import { normalizeCamelotKey } from "@/utils/camelotKey";

export interface InstalledSmartPlaylistRecipes {
  playlists: SmartPlaylistCriteria[];
  taxonomy: TagTaxonomy;
  createdTagCount: number;
  importedCount: number;
  skippedCount: number;
}

export interface SmartPlaylistRecipeSelection {
  recipeId: string;
  mode: "add" | "copy" | "skip";
  name: string;
  tagMappings: Record<string, string>;
}

export const SMART_PLAYLIST_SHARE_MAX_BYTES = 2 * 1024 * 1024;
export const CREATE_SHARED_TAG = "__create_shared_tag__";

export class SmartPlaylistShareError extends Error {}

function cloneCriteria(criteria: SmartPlaylistFilterCriteria): SmartPlaylistFilterCriteria {
  return {
    includeTagClauses: criteria.includeTagClauses.map((clause) => ({
      tagIds: [...clause.tagIds], excludedTagIds: [...clause.excludedTagIds], operator: clause.operator,
    })),
    clauseConnectors: [...criteria.clauseConnectors], ratingFilters: [...criteria.ratingFilters],
    energyMinFilter: criteria.energyMinFilter, energyMaxFilter: criteria.energyMaxFilter,
    bpmMinFilter: criteria.bpmMinFilter, bpmMaxFilter: criteria.bpmMaxFilter,
    camelotKeyFilters: [...(criteria.camelotKeyFilters ?? [])],
    camelotMinFilter: criteria.camelotMinFilter ?? null, camelotMaxFilter: criteria.camelotMaxFilter ?? null,
  };
}

function referencedTagIds(criteria: SmartPlaylistFilterCriteria): string[] {
  return Array.from(
    new Set(
      criteria.includeTagClauses.flatMap((clause) => [
        ...clause.tagIds,
        ...clause.excludedTagIds,
      ]),
    ),
  );
}

function replaceCriteriaTagIds(
  criteria: SmartPlaylistFilterCriteria,
  replacements: Map<string, string>,
): SmartPlaylistFilterCriteria {
  const replace = (tagId: string) => replacements.get(tagId) ?? tagId;
  return {
    ...cloneCriteria(criteria),
    includeTagClauses: criteria.includeTagClauses.map((clause) => ({
      operator: clause.operator,
      tagIds: [...new Set(clause.tagIds.map(replace))],
      excludedTagIds: [...new Set(clause.excludedTagIds.map(replace))],
    })),
  };
}

function normalizedPath(reference: SmartPlaylistRecipeTagReference): string {
  return [reference.categoryName, ...reference.folderPath, reference.name]
    .map((part) => part.trim().toLocaleLowerCase())
    .join("\u0000");
}

export async function createSmartPlaylistRecipeBundle(
  playlists: SmartPlaylistCriteria[],
  taxonomy: TagTaxonomy,
  now = new Date(),
): Promise<SmartPlaylistRecipeBundle> {
  if (playlists.length > 100) throw new SmartPlaylistShareError("Choose up to 100 setups to share at a time.");
  const resolved = buildResolvedTagLookup(taxonomy);
  const recipes: SmartPlaylistRecipe[] = await Promise.all(playlists.map(async (playlist) => {
    const recipeKeys = new Map<string, string>();
    const references = referencedTagIds(playlist.criteria).flatMap((tagId, index) => {
      const tag = resolved.get(tagId);
      if (!tag) throw new SmartPlaylistShareError("A tag used by this setup is missing. Edit its filters before sharing it.");
      const key = `tag-${index + 1}`;
      recipeKeys.set(tagId, key);
      return [{
        key,
        ...(tag.tag.source?.publicTagKey
          ? { originId: tag.tag.source.publicTagKey }
          : {}),
        name: tag.name,
        categoryName: tag.categoryName,
        folderPath: tag.folderPath,
      } as SmartPlaylistRecipeTagReference];
    });
    const originalId = playlist.id ?? (playlist.playlistId ? `playlist:${playlist.playlistId}` : playlist.source?.recipeId ?? `recipe:${playlist.createdAt}:${playlist.playlistName}:${criteriaSignature(playlist.criteria)}`);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(originalId));
    const id = /^recipe:[a-f0-9]{64}$/.test(originalId) ? originalId
      : `recipe:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    return {
      id,
      name: playlist.playlistName,
      ...(playlist.description ? { description: playlist.description } : {}),
      criteria: replaceCriteriaTagIds(playlist.criteria, recipeKeys),
      tagReferences: references,
      source: {
        recipeId: id,
        revision: playlist.source?.revision ?? playlist.updatedAt ?? playlist.createdAt,
      },
    };
  }));

  const bundle: SmartPlaylistRecipeBundle = {
    format: "tagify-smart-playlist-recipes",
    version: 1,
    exportedAt: now.toISOString(),
    recipes,
  };
  if (!isSmartPlaylistRecipeBundle(bundle)) throw new SmartPlaylistShareError("These setups could not be shared. Choose up to 100 setups and check their filters first.");
  if (new TextEncoder().encode(JSON.stringify(bundle, null, 2)).length > SMART_PLAYLIST_SHARE_MAX_BYTES) throw new SmartPlaylistShareError("This share is too large. Choose fewer setups to share at a time.");
  return bundle;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const textValue = (value: unknown, max = 200): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && ![...value].some((character) => character.charCodeAt(0) < 32);
const uniqueStrings = (value: unknown, max = 500): value is string[] => Array.isArray(value) && value.length <= max && value.every((item) => textValue(item, 128)) && new Set(value).size === value.length;
const nullableNumber = (value: unknown, min: number, max: number) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);

export function isSmartPlaylistRecipeBundle(value: unknown): value is SmartPlaylistRecipeBundle {
  if (!record(value) || value.format !== "tagify-smart-playlist-recipes" || value.version !== 1 ||
      !Array.isArray(value.recipes) || value.recipes.length === 0 || value.recipes.length > 100) return false;
  const ids = new Set<string>();
  return value.recipes.every((recipe: unknown) => {
    if (!record(recipe) || !textValue(recipe.id, 128) || ids.has(recipe.id) || !textValue(recipe.name) ||
        (recipe.description !== undefined && (typeof recipe.description !== "string" || recipe.description.length > 2000)) ||
        !Array.isArray(recipe.tagReferences) || recipe.tagReferences.length > 2000 || !record(recipe.criteria)) return false;
    ids.add(recipe.id);
    if (recipe.source !== undefined && (!record(recipe.source) || recipe.source.recipeId !== recipe.id ||
        typeof recipe.source.revision !== "number" || !Number.isFinite(recipe.source.revision) || recipe.source.revision < 0)) return false;
    const keys = new Set<string>();
    if (!recipe.tagReferences.every((reference: unknown) => {
      if (!record(reference) || !textValue(reference.key, 128) || keys.has(reference.key) ||
          !textValue(reference.name, 80) || !textValue(reference.categoryName, 80) ||
          !Array.isArray(reference.folderPath) || reference.folderPath.length > 20 ||
          !reference.folderPath.every((part) => textValue(part, 80)) ||
          (reference.originId !== undefined && !textValue(reference.originId, 128))) return false;
      keys.add(reference.key); return true;
    })) return false;
    const c = recipe.criteria;
    if (!Array.isArray(c.includeTagClauses) || c.includeTagClauses.length > 100 ||
        !Array.isArray(c.clauseConnectors) || c.clauseConnectors.length !== Math.max(0, c.includeTagClauses.length - 1) ||
        !c.clauseConnectors.every((op) => op === "AND" || op === "OR") ||
        !c.includeTagClauses.every((clause: unknown) => record(clause) && (clause.operator === "AND" || clause.operator === "OR") &&
          uniqueStrings(clause.tagIds) && uniqueStrings(clause.excludedTagIds) &&
          [...clause.tagIds, ...clause.excludedTagIds].every((key) => keys.has(key)) &&
          !clause.tagIds.some((key) => (clause.excludedTagIds as string[]).includes(key))) ||
        !Array.isArray(c.ratingFilters) || c.ratingFilters.length > 10 ||
        !c.ratingFilters.every((rating) => typeof rating === "number" && rating >= 0.5 && rating <= 5 && Number.isInteger(rating * 2)) ||
        !nullableNumber(c.energyMinFilter, 0, 10) || !nullableNumber(c.energyMaxFilter, 0, 10) ||
        !nullableNumber(c.bpmMinFilter, 20, 400) || !nullableNumber(c.bpmMaxFilter, 20, 400)) return false;
    for (const [min, max] of [[c.energyMinFilter, c.energyMaxFilter], [c.bpmMinFilter, c.bpmMaxFilter]]) {
      if (typeof min === "number" && typeof max === "number" && min > max) return false;
    }
    const usedKeys = new Set(c.includeTagClauses.flatMap((clause) => [...clause.tagIds, ...clause.excludedTagIds]));
    if (usedKeys.size !== keys.size) return false;
    if (c.camelotKeyFilters !== undefined && (!Array.isArray(c.camelotKeyFilters) || c.camelotKeyFilters.length > 24 ||
        !c.camelotKeyFilters.every((key) => typeof key === "string" && normalizeCamelotKey(key)))) return false;
    return [c.camelotMinFilter, c.camelotMaxFilter].every((key) => key == null || (typeof key === "string" && normalizeCamelotKey(key)));
  });
}

export function parseSmartPlaylistShare(content: string): SmartPlaylistRecipeBundle {
  if (new TextEncoder().encode(content).length > SMART_PLAYLIST_SHARE_MAX_BYTES) throw new Error("This file is too large. Ask the sender to share fewer setups at a time.");
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("This file could not be read. Choose the original file saved by Tagify’s Share button."); }
  if (Array.isArray(value)) throw new Error("This is an older playlist backup. Ask the sender to share their setups again with the latest Tagify.");
  if (record(value) && value.format === "tagify-smart-playlist-recipes" && value.version !== 1) throw new Error("This share needs a newer Tagify. Update Tagify, then try again.");
  if (!isSmartPlaylistRecipeBundle(value)) throw new Error("This file does not contain complete smart playlist setups. Ask the sender to share them again from Tagify.");
  return value;
}

function sharedTagMatcher(taxonomy: TagTaxonomy): (reference: SmartPlaylistRecipeTagReference) => string | undefined {
  const origins = new Map<string, string[]>();
  const paths = new Map<string, string[]>();
  for (const tag of buildResolvedTagLookup(taxonomy).values()) {
    const path = normalizedPath({ key: "", name: tag.name, categoryName: tag.categoryName, folderPath: tag.folderPath });
    paths.set(path, [...(paths.get(path) ?? []), tag.id]);
    const origin = tag.tag.source?.publicTagKey;
    if (origin) origins.set(origin, [...(origins.get(origin) ?? []), tag.id]);
  }
  return (reference) => {
    const origin = reference.originId ? origins.get(reference.originId) : undefined;
    if (origin?.length) return origin.length === 1 ? origin[0] : undefined;
    const path = paths.get(normalizedPath(reference));
    return path?.length === 1 ? path[0] : undefined;
  };
}

export function findSharedTagMatch(taxonomy: TagTaxonomy, reference: SmartPlaylistRecipeTagReference): string | undefined {
  return sharedTagMatcher(taxonomy)(reference);
}

function criteriaSignature(criteria: SmartPlaylistFilterCriteria): string {
  return JSON.stringify({ ...cloneCriteria(criteria),
    includeTagClauses: criteria.includeTagClauses.map((clause) => ({ tagIds: [...new Set(clause.tagIds)].sort(), excludedTagIds: [...new Set(clause.excludedTagIds)].sort(), operator: clause.operator })),
    ratingFilters: [...new Set(criteria.ratingFilters)].sort((a, b) => a - b),
    camelotKeyFilters: [...new Set(criteria.camelotKeyFilters ?? [])].sort(),
  });
}

export function getRecipeSelections(bundle: SmartPlaylistRecipeBundle, taxonomy: TagTaxonomy, playlists: SmartPlaylistCriteria[]): SmartPlaylistRecipeSelection[] {
  const match = sharedTagMatcher(taxonomy);
  return bundle.recipes.map((recipe) => {
    const tagMappings = Object.fromEntries(recipe.tagReferences.map((ref) => [ref.key, match(ref) ?? ""]));
    const equivalent = Object.values(tagMappings).every(Boolean) && playlists.some((p) =>
      p.playlistName.trim() === recipe.name.trim() && criteriaSignature(p.criteria) === criteriaSignature(replaceCriteriaTagIds(recipe.criteria, new Map(Object.entries(tagMappings)))),
    );
    return { recipeId: recipe.id, name: recipe.name, mode: equivalent || playlists.some((p) => p.source?.recipeId === recipe.id) ? "skip" : "add", tagMappings };
  });
}

export function resolveSharedRecipeCriteria(recipe: SmartPlaylistRecipe, selection: SmartPlaylistRecipeSelection, taxonomy: TagTaxonomy): SmartPlaylistFilterCriteria {
  const replacements = new Map<string, string>();
  for (const ref of recipe.tagReferences) {
    const chosen = selection.tagMappings[ref.key];
    if (chosen === CREATE_SHARED_TAG) replacements.set(ref.key, ensureTagReference(taxonomy, ref).tagId);
    else if (chosen && taxonomy.tagsById[chosen]) replacements.set(ref.key, chosen);
    else throw new Error("Choose how to match every shared tag before adding this setup.");
  }
  const criteria = replaceCriteriaTagIds(recipe.criteria, replacements);
  if (criteria.includeTagClauses.some((clause) => clause.tagIds.some((id) => clause.excludedTagIds.includes(id)))) {
    throw new Error("A tag cannot be both included and excluded in the same group. Choose a different tag.");
  }
  return criteria;
}

function ensureTagReference(
  taxonomy: TagTaxonomy,
  reference: SmartPlaylistRecipeTagReference,
): { tagId: string; created: boolean } {
  const match = findSharedTagMatch(taxonomy, reference);
  if (match) return { tagId: match, created: false };

  const category = Object.values(taxonomy.categoriesById).find(
    (candidate) =>
      candidate.name.trim().toLocaleLowerCase() ===
      reference.categoryName.trim().toLocaleLowerCase(),
  );
  const categoryId = category?.id ?? createEntityId("cat");
  if (!category) {
    taxonomy.categoryOrder.push(categoryId);
    taxonomy.categoriesById[categoryId] = {
      id: categoryId,
      name: reference.categoryName,
      subcategoryIds: [],
      childIds: [],
    };
    taxonomy.childrenByParentId![categoryId] = [];
  }

  let parentId = categoryId;
  for (const folderName of reference.folderPath) {
    const childIds = taxonomy.childrenByParentId?.[parentId] ?? [];
    const existingFolder = childIds
      .map((id) => taxonomy.subcategoriesById[id])
      .find(
        (folder) =>
          folder?.name.trim().toLocaleLowerCase() ===
          folderName.trim().toLocaleLowerCase(),
      );
    if (existingFolder) {
      parentId = existingFolder.id;
      continue;
    }
    const folderId = createEntityId("sub");
    const folder = {
      id: folderId,
      name: folderName,
      parentId,
      categoryId,
      tagIds: [],
      childIds: [],
    };
    taxonomy.subcategoriesById[folderId] = folder;
    taxonomy.foldersById![folderId] = folder;
    taxonomy.childrenByParentId![folderId] = [];
    taxonomy.childrenByParentId![parentId] = [
      ...(taxonomy.childrenByParentId![parentId] ?? []),
      folderId,
    ];
    if (parentId === categoryId) {
      taxonomy.categoriesById[categoryId].subcategoryIds.push(folderId);
      taxonomy.categoriesById[categoryId].childIds = [
        ...(taxonomy.categoriesById[categoryId].childIds ?? []),
        folderId,
      ];
    } else {
      taxonomy.subcategoriesById[parentId].childIds = [
        ...(taxonomy.subcategoriesById[parentId].childIds ?? []),
        folderId,
      ];
    }
    parentId = folderId;
  }

  const tagId = createEntityId("tag");
  taxonomy.tagsById[tagId] = {
    id: tagId,
    name: reference.name,
    parentId,
    subcategoryId: parentId,
  };
  taxonomy.childrenByParentId![parentId] = [
    ...(taxonomy.childrenByParentId![parentId] ?? []),
    tagId,
  ];
  if (parentId === categoryId) {
    taxonomy.categoriesById[categoryId].childIds = [
      ...(taxonomy.categoriesById[categoryId].childIds ?? []),
      tagId,
    ];
  } else {
    taxonomy.subcategoriesById[parentId].tagIds.push(tagId);
    taxonomy.subcategoriesById[parentId].childIds = [
      ...(taxonomy.subcategoriesById[parentId].childIds ?? []),
      tagId,
    ];
  }
  return { tagId, created: true };
}

export function installSmartPlaylistRecipeBundle(
  bundle: SmartPlaylistRecipeBundle,
  taxonomy: TagTaxonomy,
  existingPlaylists: SmartPlaylistCriteria[],
  now = Date.now(),
  selections?: SmartPlaylistRecipeSelection[],
): InstalledSmartPlaylistRecipes {
  if (!isSmartPlaylistRecipeBundle(bundle)) throw new Error("This share is incomplete. Ask the sender to share it again.");
  const nextTaxonomy = normalizeTaxonomyTree(JSON.parse(JSON.stringify(taxonomy)) as TagTaxonomy);
  const playlists = [...existingPlaylists];
  const choices = selections ?? getRecipeSelections(bundle, taxonomy, existingPlaylists).map((choice) => ({
    ...choice, tagMappings: Object.fromEntries(Object.entries(choice.tagMappings).map(([key, value]) => [key, value || CREATE_SHARED_TAG])),
  }));
  if (new Set(choices.map((choice) => choice.recipeId)).size !== choices.length || choices.some((choice) => !bundle.recipes.some((r) => r.id === choice.recipeId))) {
    throw new Error("Your selection could not be read. Open the share again.");
  }
  let importedCount = 0;
  let skippedCount = 0;
  for (const recipe of bundle.recipes) {
    const choice = choices.find((candidate) => candidate.recipeId === recipe.id);
    if (!choice || choice.mode === "skip" || (choice.mode !== "copy" && existingPlaylists.some((p) => p.source?.recipeId === recipe.id))) { skippedCount++; continue; }
    if (!textValue(choice.name)) throw new Error("Give each selected setup a name of 200 characters or fewer.");
    const criteria = resolveSharedRecipeCriteria(recipe, choice, nextTaxonomy);
    if (choice.mode !== "copy" && playlists.some((p) => p.playlistName.trim() === choice.name.trim() && criteriaSignature(p.criteria) === criteriaSignature(criteria))) { skippedCount++; continue; }
    let name = choice.name.trim();
    const names = new Set(playlists.map((p) => p.playlistName.trim().toLocaleLowerCase()));
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${choice.name.trim().slice(0, 180)} (${suffix++})`;
    playlists.push({
      id: `smart-playlist:${crypto.randomUUID()}`, playlistId: "", playlistName: name,
      ...(recipe.description ? { description: recipe.description } : {}), criteria,
      isActive: false, createdAt: now, updatedAt: now, lastSyncAt: 0, smartPlaylistTrackUris: [],
      source: { recipeId: recipe.id, revision: recipe.source?.revision ?? 1 },
    });
    importedCount++;
  }
  return { taxonomy: nextTaxonomy, playlists, importedCount, skippedCount,
    createdTagCount: Object.keys(nextTaxonomy.tagsById).length - Object.keys(taxonomy.tagsById).length };
}

export function downloadSmartPlaylistRecipeBundle(
  bundle: SmartPlaylistRecipeBundle,
): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tagify-smart-playlist-recipes-${
    new Date().toISOString().split("T")[0]
  }.json`;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
