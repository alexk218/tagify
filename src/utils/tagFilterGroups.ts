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
  trackTagIdSet: Set<string>,
  clause: TagFilterClause,
): boolean {
  const matchesPositiveTags =
    clause.tagIds.length === 0
      ? true
      : clause.operator === TAG_FILTER_OPERATORS.AND
        ? clause.tagIds.every((tagId) => trackTagIdSet.has(tagId))
        : clause.tagIds.some((tagId) => trackTagIdSet.has(tagId));
  const matchesExcludedTags = clause.excludedTagIds.every(
    (tagId) => !trackTagIdSet.has(tagId),
  );

  return matchesPositiveTags && matchesExcludedTags;
}

export function evaluateTagFilterFormula(
  trackTagIds: string[],
  formula: TagFilterFormula,
): boolean {
  const normalizedFormula = normalizeTagFilterFormula(formula);

  if (normalizedFormula.clauses.length === 0) {
    return true;
  }

  const trackTagIdSet = new Set(trackTagIds);
  const clauseResults = normalizedFormula.clauses.map((clause) =>
    evaluateClause(trackTagIdSet, clause),
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
  resolveTagName: (tagId: string) => string,
): {
  text: string;
  needsGroupingWhenOrSeparated: boolean;
} {
  const operatorLabel = clause.operator;
  const positiveText =
    clause.tagIds.length === 0
      ? ""
      : clause.tagIds.length > 1
        ? `(${clause.tagIds.map((tagId) => resolveTagName(tagId)).join(` ${operatorLabel} `)})`
        : resolveTagName(clause.tagIds[0]);
  const negativeTerms = clause.excludedTagIds.map(
    (tagId) => `NOT ${resolveTagName(tagId)}`,
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

export function formatTagFilterFormula(
  formula: TagFilterFormula,
  resolveTagName: (tagId: string) => string = (tagId) => tagId,
): string {
  const normalizedFormula = normalizeTagFilterFormula(formula);

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
