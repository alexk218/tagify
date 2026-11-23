import type { TagTaxonomy } from "@/types/tagData";
import { collectTagIdsForParent, normalizeTaxonomyTree } from "@/utils/tagTaxonomy";

export const TAG_FILTER_OPERATORS = {
  AND: "AND",
  OR: "OR",
} as const;

export type TagFilterOperator =
  (typeof TAG_FILTER_OPERATORS)[keyof typeof TAG_FILTER_OPERATORS];

export interface TagFilterClause {
  tagIds: string[];
  excludedTagIds: string[];
  operator: TagFilterOperator;
}

export interface TagFilterFormula {
  clauses: TagFilterClause[];
  connectors: TagFilterOperator[];
}

/**
 * A filter term can name a whole category or folder instead of one tag:
 * `group:<id>` in a clause's tag lanes. As a match it means "any tag in it",
 * as a NOT it means "no tag in it". It is resolved against the taxonomy each
 * time the filter runs, so tags added to the category later count too.
 */
export const TAG_GROUP_FILTER_PREFIX = "group:";

export function toTagGroupFilterId(groupId: string): string {
  return `${TAG_GROUP_FILTER_PREFIX}${groupId}`;
}

export function getTagGroupFilterGroupId(termId: string): string | null {
  return termId.startsWith(TAG_GROUP_FILTER_PREFIX) &&
    termId.length > TAG_GROUP_FILTER_PREFIX.length
    ? termId.slice(TAG_GROUP_FILTER_PREFIX.length)
    : null;
}

export function getTagGroupName(
  taxonomy: TagTaxonomy | null | undefined,
  groupId: string,
): string | null {
  if (!taxonomy) return null;
  return (
    taxonomy.categoriesById[groupId]?.name ??
    taxonomy.foldersById?.[groupId]?.name ??
    taxonomy.subcategoriesById[groupId]?.name ??
    null
  );
}

/** Every category and folder that can be used as a filter term, as `group:<id>`. */
export function buildTagGroupFilterIdSet(taxonomy: TagTaxonomy): Set<string> {
  return new Set(
    [
      ...Object.keys(taxonomy.categoriesById),
      ...Object.keys(taxonomy.foldersById ?? {}),
      ...Object.keys(taxonomy.subcategoriesById),
    ].map(toTagGroupFilterId),
  );
}

export interface TagGroupFilterOption {
  /** `group:<id>`, the term stored in a filter. */
  termId: string;
  groupId: string;
  name: string;
  /** Category first, then folders, ending with this group's own name. */
  path: string[];
  /** 0 for a category, 1 for a folder directly inside it, and so on. */
  depth: number;
  /** Every tag inside, folders included. */
  tagIds: string[];
}

/**
 * Categories and their folders in library order, for choosing a category
 * term. Groups without any tags are left out.
 */
export function buildTagGroupFilterOptions(taxonomy: TagTaxonomy): TagGroupFilterOption[] {
  const tree = normalizeTaxonomyTree(taxonomy);
  const children = tree.childrenByParentId ?? {};
  const options: TagGroupFilterOption[] = [];
  const visit = (groupId: string, name: string, path: string[], seen: Set<string>): string[] => {
    const index = options.length;
    const tagIds: string[] = [];
    options.push({ termId: toTagGroupFilterId(groupId), groupId, name, path, depth: path.length - 1, tagIds });
    for (const childId of children[groupId] ?? []) {
      if (tree.tagsById[childId]) tagIds.push(childId);
      else if (!seen.has(childId) && tree.subcategoriesById[childId]) {
        tagIds.push(...visit(childId, tree.subcategoriesById[childId].name, [...path, tree.subcategoriesById[childId].name], new Set([...seen, childId])));
      }
    }
    if (tagIds.length === 0) options.splice(index, 1);
    return tagIds;
  };
  tree.categoryOrder.forEach((categoryId) => {
    const category = tree.categoriesById[categoryId];
    if (category) visit(categoryId, category.name, [category.name], new Set([categoryId]));
  });
  return options;
}

/** A tag that exists, or a category term whose category or folder exists. */
export function isKnownTagFilterTerm(taxonomy: TagTaxonomy, termId: string): boolean {
  const groupId = getTagGroupFilterGroupId(termId);
  return groupId === null ? Boolean(taxonomy.tagsById[termId]) : getTagGroupName(taxonomy, groupId) !== null;
}

/** Each category term replaced by the tags it covers right now. */
export function expandTagGroupTerms(taxonomy: TagTaxonomy | null, termIds: string[]): string[] {
  return [...new Set(termIds.flatMap((termId) => {
    const groupId = getTagGroupFilterGroupId(termId);
    return groupId === null ? [termId] : resolveTagGroupTagIds(taxonomy, groupId);
  }))];
}

/** True when any clause names a whole category or folder. */
export function tagFilterFormulaUsesGroups(formula: Partial<TagFilterFormula> | null | undefined): boolean {
  return (formula?.clauses ?? []).some((clause) =>
    [...(clause?.tagIds ?? []), ...(clause?.excludedTagIds ?? [])].some(
      (termId) => getTagGroupFilterGroupId(termId) !== null,
    ),
  );
}

/** The tags a category term covers right now, or [] for a category that no longer exists. */
export function resolveTagGroupTagIds(
  taxonomy: TagTaxonomy | null | undefined,
  groupId: string,
): string[] {
  return [...(getTagGroupResolver(taxonomy)(groupId) ?? [])];
}

type TagGroupResolver = (groupId: string) => ReadonlySet<string> | null;
const groupResolverCache = new WeakMap<TagTaxonomy, TagGroupResolver>();

function getTagGroupResolver(taxonomy: TagTaxonomy | null | undefined): TagGroupResolver {
  if (!taxonomy) return () => null;
  const cached = groupResolverCache.get(taxonomy);
  if (cached) return cached;
  const groups = new Map<string, ReadonlySet<string> | null>();
  const resolver: TagGroupResolver = (groupId) => {
    if (!groups.has(groupId)) {
      groups.set(
        groupId,
        getTagGroupName(taxonomy, groupId) === null
          ? null
          : new Set(collectTagIdsForParent(taxonomy, groupId)),
      );
    }
    return groups.get(groupId)!;
  };
  groupResolverCache.set(taxonomy, resolver);
  return resolver;
}

function dedupeTagIds(tagIds: string[]): string[] {
  return Array.from(
    new Set(
      tagIds.filter(
        (tagId) => typeof tagId === "string" && tagId.trim().length > 0,
      ),
    ),
  );
}

function normalizeOperator(value: unknown): TagFilterOperator {
  return value === TAG_FILTER_OPERATORS.AND
    ? TAG_FILTER_OPERATORS.AND
    : TAG_FILTER_OPERATORS.OR;
}

function normalizeClause(
  clause: Partial<TagFilterClause> | null | undefined,
  seenTagIds: Set<string>,
): TagFilterClause | null {
  const normalizeTagIdsForLane = (tagIds: unknown): string[] =>
    dedupeTagIds(Array.isArray(tagIds) ? tagIds : []).filter((tagId) => {
      if (seenTagIds.has(tagId)) {
        return false;
      }

      seenTagIds.add(tagId);
      return true;
    });

  const nextTagIds = normalizeTagIdsForLane(clause?.tagIds);
  const nextExcludedTagIds = normalizeTagIdsForLane(clause?.excludedTagIds);

  if (nextTagIds.length === 0 && nextExcludedTagIds.length === 0) {
    return null;
  }

  return {
    tagIds: nextTagIds,
    excludedTagIds: nextExcludedTagIds,
    operator: normalizeOperator(clause?.operator),
  };
}

export function normalizeTagFilterFormula(
  formula: Partial<TagFilterFormula> | null | undefined,
): TagFilterFormula {
  const clauses = Array.isArray(formula?.clauses) ? formula.clauses : [];
  const connectors = Array.isArray(formula?.connectors) ? formula.connectors : [];
  const seenTagIds = new Set<string>();
  const normalizedClauses: TagFilterClause[] = [];
  const normalizedConnectors: TagFilterOperator[] = [];
  let hasPreviousClause = false;

  clauses.forEach((clause, clauseIndex) => {
    const normalizedClause = normalizeClause(clause, seenTagIds);

    if (!normalizedClause) {
      return;
    }

    if (hasPreviousClause) {
      normalizedConnectors.push(
        normalizeOperator(connectors[clauseIndex - 1]),
      );
    }

    normalizedClauses.push(normalizedClause);
    hasPreviousClause = true;
  });

  return {
    clauses: normalizedClauses,
    connectors: normalizedConnectors.slice(0, Math.max(0, normalizedClauses.length - 1)),
  };
}

export function buildTagFilterFormulaFromLegacyFilters(
  activeTagFilters: string[],
  isOrFilterMode: boolean,
  excludedTagFilters: string[] = [],
): TagFilterFormula {
  const normalizedTagIds = dedupeTagIds(activeTagFilters);
  const normalizedExcludedTagIds = dedupeTagIds(excludedTagFilters);
  const clauses: TagFilterClause[] = [];
  const connectors: TagFilterOperator[] = [];

  if (normalizedTagIds.length > 0) {
    clauses.push({
      tagIds: normalizedTagIds,
      excludedTagIds: [],
      operator: isOrFilterMode
        ? TAG_FILTER_OPERATORS.OR
        : TAG_FILTER_OPERATORS.AND,
    });
  }

  if (normalizedExcludedTagIds.length > 0) {
    if (clauses.length > 0) {
      connectors.push(TAG_FILTER_OPERATORS.AND);
    }

    clauses.push({
      tagIds: [],
      excludedTagIds: normalizedExcludedTagIds,
      operator: TAG_FILTER_OPERATORS.OR,
    });
  }

  return { clauses, connectors };
}

export function buildTagFilterFormulaFromIncludeTagGroups(
  includeTagGroups: string[][],
  excludedTagFilters: string[] = [],
): TagFilterFormula {
  const clauses: TagFilterClause[] = includeTagGroups.map((group) => ({
    tagIds: group,
    excludedTagIds: [],
    operator: TAG_FILTER_OPERATORS.OR,
  }));
  const connectors = Array(Math.max(0, includeTagGroups.length - 1)).fill(
    TAG_FILTER_OPERATORS.AND,
  ) as TagFilterOperator[];

  if (excludedTagFilters.length > 0) {
    if (clauses.length > 0) {
      connectors.push(TAG_FILTER_OPERATORS.AND);
    }

    clauses.push({
      tagIds: [],
      excludedTagIds: excludedTagFilters,
      operator: TAG_FILTER_OPERATORS.OR,
    });
  }

  return normalizeTagFilterFormula({ clauses, connectors });
}

export function flattenTagFilterFormula(formula: TagFilterFormula): string[] {
  return normalizeTagFilterFormula(formula).clauses.flatMap((clause) => clause.tagIds);
}

export function flattenExcludedTagFilterFormula(formula: TagFilterFormula): string[] {
  return normalizeTagFilterFormula(formula).clauses.flatMap(
    (clause) => clause.excludedTagIds,
  );
}

function evaluateClause(
  trackTagIds: string[],
  trackTagIdSet: Set<string>,
  clause: TagFilterClause,
  resolveGroup: TagGroupResolver,
): boolean {
  const hasTerm = (termId: string) => {
    const groupId = getTagGroupFilterGroupId(termId);
    if (groupId === null) return trackTagIdSet.has(termId);
    const groupTagIds = resolveGroup(groupId);
    return !!groupTagIds && trackTagIds.some((tagId) => groupTagIds.has(tagId));
  };
  const matchesPositiveTags =
    clause.tagIds.length === 0
      ? true
      : clause.operator === TAG_FILTER_OPERATORS.AND
        ? clause.tagIds.every(hasTerm)
        : clause.tagIds.some(hasTerm);
  const matchesExcludedTags = clause.excludedTagIds.every(
    (tagId) => !hasTerm(tagId),
  );

  return matchesPositiveTags && matchesExcludedTags;
}

/**
 * The taxonomy resolves category terms (`group:<id>`). Pass null only where a
 * formula can't hold them; there a category matches no tags.
 */
export function evaluateTagFilterFormula(
  trackTagIds: string[],
  formula: TagFilterFormula,
  taxonomy: TagTaxonomy | null,
): boolean {
  return compileTagFilterFormula(formula, taxonomy)(trackTagIds);
}

/** Prepares a formula once so it can be checked against many songs quickly. */
export function compileTagFilterFormula(
  formula: TagFilterFormula,
  taxonomy: TagTaxonomy | null,
): (trackTagIds: string[]) => boolean {
  const normalizedFormula = normalizeTagFilterFormula(formula);

  if (normalizedFormula.clauses.length === 0) {
    return () => true;
  }

  const resolveGroup = getTagGroupResolver(taxonomy);

  return (trackTagIds) => {
    const trackTagIdSet = new Set(trackTagIds);
    const clauseResults = normalizedFormula.clauses.map((clause) =>
      evaluateClause(trackTagIds, trackTagIdSet, clause, resolveGroup),
    );

    const andGroups: boolean[] = [clauseResults[0]];

    normalizedFormula.connectors.forEach((connector, connectorIndex) => {
      const nextResult = clauseResults[connectorIndex + 1];

      if (connector === TAG_FILTER_OPERATORS.AND) {
        andGroups[andGroups.length - 1] =
          andGroups[andGroups.length - 1] && nextResult;
        return;
      }

      andGroups.push(nextResult);
    });

    return andGroups.some(Boolean);
  };
}

export interface TagFilterLocation {
  clauseIndex: number;
  lane: "include" | "exclude";
}

export function findTagFilterLocation(
  formula: TagFilterFormula,
  tagId: string,
): TagFilterLocation | null {
  for (let clauseIndex = 0; clauseIndex < formula.clauses.length; clauseIndex += 1) {
    if (formula.clauses[clauseIndex].tagIds.includes(tagId)) {
      return { clauseIndex, lane: "include" };
    }

    if (formula.clauses[clauseIndex].excludedTagIds.includes(tagId)) {
      return { clauseIndex, lane: "exclude" };
    }
  }

  return null;
}

export function updateTagFilterClauseOperator(
  formula: TagFilterFormula,
  clauseIndex: number,
  operator: TagFilterOperator,
): TagFilterFormula {
  return {
    ...formula,
    clauses: formula.clauses.map((clause, index) =>
      index === clauseIndex ? { ...clause, operator } : clause,
    ),
  };
}

export function updateTagFilterConnector(
  formula: TagFilterFormula,
  connectorIndex: number,
  operator: TagFilterOperator,
): TagFilterFormula {
  return {
    ...formula,
    connectors: formula.connectors.map((connector, index) =>
      index === connectorIndex ? operator : connector,
    ),
  };
}

export function addTagFilterClause(
  formula: TagFilterFormula,
  clause: TagFilterClause,
  connector: TagFilterOperator = TAG_FILTER_OPERATORS.AND,
): TagFilterFormula {
  return {
    clauses: [...formula.clauses, clause],
    connectors:
      formula.clauses.length === 0
        ? []
        : [...formula.connectors, connector],
  };
}

export function removeTagFilterClause(
  formula: TagFilterFormula,
  clauseIndex: number,
): TagFilterFormula {
  const nextClauses = formula.clauses.filter((_, index) => index !== clauseIndex);

  if (nextClauses.length === 0) {
    return { clauses: [], connectors: [] };
  }

  if (clauseIndex === 0) {
    return {
      clauses: nextClauses,
      connectors: formula.connectors.slice(1),
    };
  }

  return {
    clauses: nextClauses,
    connectors: formula.connectors.filter((_, index) => index !== clauseIndex - 1),
  };
}

export function withoutTagInFilterFormula(
  formula: TagFilterFormula,
  tagId: string,
): TagFilterFormula {
  let nextFormula: TagFilterFormula = {
    clauses: formula.clauses.map((clause) => ({
      ...clause,
      tagIds: clause.tagIds.filter((candidateTagId) => candidateTagId !== tagId),
      excludedTagIds: clause.excludedTagIds.filter(
        (candidateTagId) => candidateTagId !== tagId,
      ),
    })),
    connectors: [...formula.connectors],
  };

  for (let clauseIndex = nextFormula.clauses.length - 1; clauseIndex >= 0; clauseIndex -= 1) {
    if (
      nextFormula.clauses[clauseIndex].tagIds.length === 0 &&
      nextFormula.clauses[clauseIndex].excludedTagIds.length === 0
    ) {
      nextFormula = removeTagFilterClause(nextFormula, clauseIndex);
    }
  }

  return nextFormula;
}

export function withTagInFilterClause(
  formula: TagFilterFormula,
  tagId: string,
  targetClauseIndex: number,
  options: {
    clauseOperator?: TagFilterOperator;
    connector?: TagFilterOperator;
    lane?: "include" | "exclude";
  } = {},
): TagFilterFormula {
  const baseFormula = withoutTagInFilterFormula(formula, tagId);
  const targetLane = options.lane ?? "include";

  if (targetClauseIndex < 0 || targetClauseIndex >= baseFormula.clauses.length) {
    return addTagFilterClause(
      baseFormula,
      {
        tagIds: targetLane === "include" ? [tagId] : [],
        excludedTagIds: targetLane === "exclude" ? [tagId] : [],
        operator: options.clauseOperator ?? TAG_FILTER_OPERATORS.OR,
      },
      options.connector ?? TAG_FILTER_OPERATORS.AND,
    );
  }

  return {
    ...baseFormula,
    clauses: baseFormula.clauses.map((clause, clauseIndex) =>
      clauseIndex === targetClauseIndex
        ? {
            ...clause,
            tagIds:
              targetLane === "include" ? [...clause.tagIds, tagId] : clause.tagIds,
            excludedTagIds:
              targetLane === "exclude"
                ? [...clause.excludedTagIds, tagId]
                : clause.excludedTagIds,
          }
        : clause,
    ),
  };
}

export function pruneTagFilterFormula(
  formula: TagFilterFormula,
  validTagIds: Set<string>,
): TagFilterFormula {
  return normalizeTagFilterFormula({
    clauses: formula.clauses.map((clause) => ({
      ...clause,
      tagIds: (Array.isArray(clause.tagIds) ? clause.tagIds : []).filter((tagId) =>
        validTagIds.has(tagId),
      ),
      excludedTagIds: (
        Array.isArray(clause.excludedTagIds) ? clause.excludedTagIds : []
      ).filter((tagId) => validTagIds.has(tagId)),
    })),
    connectors: formula.connectors,
  });
}

export function countTagFilterFormulaReferences(
  formula: TagFilterFormula,
  tagIds: string[],
): number {
  const targetIds = new Set(tagIds);
  return [
    ...flattenTagFilterFormula(formula),
    ...flattenExcludedTagFilterFormula(formula),
  ].filter((tagId) => targetIds.has(tagId)).length;
}

function formatClause(
  clause: TagFilterClause,
  resolveName: (tagId: string) => string,
): {
  text: string;
  needsGroupingWhenOrSeparated: boolean;
} {
  const operatorLabel = clause.operator;
  const resolveTagName = (termId: string) =>
    getTagGroupFilterGroupId(termId) === null
      ? resolveName(termId)
      : `Any ${resolveName(termId)}`;
  const positiveText =
    clause.tagIds.length === 0
      ? ""
      : clause.tagIds.length > 1
        ? `(${clause.tagIds.map((tagId) => resolveTagName(tagId)).join(` ${operatorLabel} `)})`
        : resolveTagName(clause.tagIds[0]);
  const negativeTerms = clause.excludedTagIds.map((tagId) =>
    getTagGroupFilterGroupId(tagId) === null
      ? `NOT ${resolveName(tagId)}`
      : `No ${resolveName(tagId)}`,
  );
  const terms = [
    ...(positiveText ? [positiveText] : []),
    ...negativeTerms,
  ];

  return {
    text: terms.join(" AND "),
    needsGroupingWhenOrSeparated: terms.length > 1,
  };
}

/**
 * Writes a formula out in words. Category terms read "Any Genre" and
 * "No Mood"; their names come from the taxonomy when it is given.
 */
export function formatTagFilterFormula(
  formula: TagFilterFormula,
  resolveName: (tagId: string) => string = (tagId) => tagId,
  taxonomy?: TagTaxonomy | null,
): string {
  const normalizedFormula = normalizeTagFilterFormula(formula);
  const resolveTagName = (termId: string) => {
    const groupId = getTagGroupFilterGroupId(termId);
    if (groupId === null) return resolveName(termId);
    return getTagGroupName(taxonomy, groupId) ?? resolveName(termId);
  };

  if (normalizedFormula.clauses.length === 0) {
    return "";
  }

  const orSeparatedSegments: Array<{
    clauseCount: number;
    hasInternalAnd: boolean;
    text: string;
  }> = [];
  const firstClause = formatClause(normalizedFormula.clauses[0], resolveTagName);
  let currentSegment = firstClause.text;
  let currentSegmentClauseCount = 1;
  let currentSegmentHasInternalAnd = firstClause.needsGroupingWhenOrSeparated;

  normalizedFormula.connectors.forEach((connector, connectorIndex) => {
    const nextClause = formatClause(
      normalizedFormula.clauses[connectorIndex + 1],
      resolveTagName,
    );

    if (connector === TAG_FILTER_OPERATORS.AND) {
      currentSegment = `${currentSegment} AND ${nextClause.text}`;
      currentSegmentClauseCount += 1;
      currentSegmentHasInternalAnd = true;
      return;
    }

    orSeparatedSegments.push({
      clauseCount: currentSegmentClauseCount,
      hasInternalAnd: currentSegmentHasInternalAnd,
      text: currentSegment,
    });
    currentSegment = nextClause.text;
    currentSegmentClauseCount = 1;
    currentSegmentHasInternalAnd = nextClause.needsGroupingWhenOrSeparated;
  });

  orSeparatedSegments.push({
    clauseCount: currentSegmentClauseCount,
    hasInternalAnd: currentSegmentHasInternalAnd,
    text: currentSegment,
  });

  const shouldWrapAndSegments = orSeparatedSegments.length > 1;

  return orSeparatedSegments
    .map((segment) =>
      shouldWrapAndSegments && (segment.clauseCount > 1 || segment.hasInternalAnd)
        ? `(${segment.text})`
        : segment.text,
    )
    .join(" OR ");
}
