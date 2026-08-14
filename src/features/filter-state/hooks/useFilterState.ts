import { useEffect, useMemo, useState } from "react";
import { normalizeFilterState } from "@/features/tag-data";
import { TagTaxonomy } from "@/types/tagData";
import {
  addTagFilterClause,
  findTagFilterLocation,
  flattenExcludedTagFilterFormula,
  flattenTagFilterFormula,
  normalizeTagFilterFormula,
  pruneTagFilterFormula,
  removeTagFilterClause,
  TAG_FILTER_OPERATORS,
  TagFilterFormula,
  TagFilterOperator,
  updateTagFilterClauseOperator,
  updateTagFilterConnector,
  withTagInFilterClause,
  withoutTagInFilterFormula,
} from "@/utils/tagFilterGroups";
import { findDisplayTagName } from "@/utils/tagTaxonomy";

const LEGACY_FILTER_STATE_STORAGE_KEY = "tagify:filterState";
const FILTER_STATE_STORAGE_KEY_PREFIX = "tagify:filterState";
export const TAG_FILTER_LANES = {
  INCLUDE: "include",
  EXCLUDE: "exclude",
} as const;

export type FilterStateScope = "tracks" | "albums" | "playlists" | "artists";
export type TagFilterLane =
  (typeof TAG_FILTER_LANES)[keyof typeof TAG_FILTER_LANES];

function getNextSelectedClauseIndex(
  currentIndex: number | null,
  clauseCount: number,
): number | null {
  if (clauseCount === 0) {
    return null;
  }

  if (currentIndex === null) {
    return 0;
  }

  if (currentIndex >= clauseCount) {
    return clauseCount - 1;
  }

  return currentIndex;
}

function getDefaultFormula(): TagFilterFormula {
  return {
    clauses: [],
    connectors: [],
  };
}

function normalizeReplacementFormula(
  formula: TagFilterFormula,
): TagFilterFormula {
  return normalizeTagFilterFormula(formula);
}

function getFilterStateStorageKey(scope: FilterStateScope): string {
  return `${FILTER_STATE_STORAGE_KEY_PREFIX}:${scope}`;
}

function readStoredFilterFormula(
  storageKey: string,
  scope: FilterStateScope,
): TagFilterFormula {
  try {
    const savedFilters =
      localStorage.getItem(storageKey) ||
      (scope === "tracks"
        ? localStorage.getItem(LEGACY_FILTER_STATE_STORAGE_KEY)
        : null);

    if (!savedFilters) {
      return getDefaultFormula();
    }

    const filters = normalizeFilterState(JSON.parse(savedFilters));
    return {
      clauses: filters.includeTagClauses,
      connectors: filters.clauseConnectors,
    };
  } catch (error) {
    console.error(`Error loading tag filters from localStorage:`, error);
    return getDefaultFormula();
  }
}

export function useFilterState(scope: FilterStateScope = "tracks") {
  const storageKey = getFilterStateStorageKey(scope);
  const [tagFilterFormula, setTagFilterFormula] = useState<TagFilterFormula>(() =>
    readStoredFilterFormula(storageKey, scope),
  );
  const [selectedClauseIndex, setSelectedClauseIndex] = useState<number | null>(() =>
    tagFilterFormula.clauses.length > 0 ? 0 : null,
  );
  const [selectedClauseLane, setSelectedClauseLane] = useState<TagFilterLane>(
    TAG_FILTER_LANES.INCLUDE,
  );

  const activeTagFilters = useMemo(
    () => flattenTagFilterFormula(tagFilterFormula),
    [tagFilterFormula],
  );
  const excludedTagFilters = useMemo(
    () => flattenExcludedTagFilterFormula(tagFilterFormula),
    [tagFilterFormula],
  );

  useEffect(() => {
    try {
      const normalizedFormula = normalizeTagFilterFormula(tagFilterFormula);
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          includeTagClauses: normalizedFormula.clauses,
          clauseConnectors: normalizedFormula.connectors,
        }),
      );
      if (scope === "tracks") {
        localStorage.removeItem(LEGACY_FILTER_STATE_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Error saving filter state:", error);
    }
  }, [scope, storageKey, tagFilterFormula]);

  useEffect(() => {
    setSelectedClauseIndex((previousIndex) =>
      getNextSelectedClauseIndex(previousIndex, tagFilterFormula.clauses.length),
    );
  }, [tagFilterFormula.clauses.length]);

  const ensureSelectedClause = (): number => {
    if (
      selectedClauseIndex !== null &&
      selectedClauseIndex >= 0 &&
      selectedClauseIndex < tagFilterFormula.clauses.length
    ) {
      return selectedClauseIndex;
    }

    return tagFilterFormula.clauses.length > 0 ? 0 : -1;
  };

  const addIncludeClause = (
    operator: TagFilterOperator = TAG_FILTER_OPERATORS.OR,
    connector: TagFilterOperator = TAG_FILTER_OPERATORS.AND,
  ) => {
    const lastClauseIndex = tagFilterFormula.clauses.length - 1;
    const lastClause =
      lastClauseIndex >= 0 ? tagFilterFormula.clauses[lastClauseIndex] : null;

    if (
      lastClause &&
      lastClause.tagIds.length === 0 &&
      lastClause.excludedTagIds.length === 0
    ) {
      setSelectedClauseIndex(lastClauseIndex);
      setSelectedClauseLane(TAG_FILTER_LANES.INCLUDE);
      return;
    }

    setTagFilterFormula((prev) =>
      addTagFilterClause(
        prev,
        {
          tagIds: [],
          excludedTagIds: [],
          operator,
        },
        connector,
      ),
    );
    setSelectedClauseIndex(tagFilterFormula.clauses.length);
    setSelectedClauseLane(TAG_FILTER_LANES.INCLUDE);
  };

  const moveTagToClauseLane = (
    tagId: string,
    lane: TagFilterLane,
    targetClauseIndex?: number,
  ) => {
    setTagFilterFormula((prev) => {
      const resolvedClauseIndex =
        targetClauseIndex ??
        (selectedClauseIndex !== null && selectedClauseIndex >= 0
          ? selectedClauseIndex
          : prev.clauses.length > 0
            ? 0
            : -1);

        const nextFormula =
        resolvedClauseIndex === -1
          ? addTagFilterClause(prev, {
              tagIds: lane === TAG_FILTER_LANES.INCLUDE ? [tagId] : [],
              excludedTagIds: lane === TAG_FILTER_LANES.EXCLUDE ? [tagId] : [],
              operator: TAG_FILTER_OPERATORS.OR,
            })
          : withTagInFilterClause(prev, tagId, resolvedClauseIndex, {
              clauseOperator:
                prev.clauses[resolvedClauseIndex]?.operator ??
                TAG_FILTER_OPERATORS.OR,
              connector: TAG_FILTER_OPERATORS.AND,
              lane,
            });

      return nextFormula;
    });
    setSelectedClauseIndex((prev) => {
      if (targetClauseIndex !== undefined) {
        return targetClauseIndex;
      }

      if (prev !== null && prev < tagFilterFormula.clauses.length) {
        return prev;
      }

      return tagFilterFormula.clauses.length > 0 ? 0 : 0;
    });
    setSelectedClauseLane(lane);
  };

  const removeTagFromFormula = (tagId: string) => {
    setTagFilterFormula((prev) => withoutTagInFilterFormula(prev, tagId));
  };

  const removeTagFilter = (tagId: string) => {
    const location = findTagFilterLocation(tagFilterFormula, tagId);

    if (location) {
      removeTagFromFormula(tagId);
    }
  };

  const toggleTagInSelectedClauseLane = (tagId: string) => {
    const location = findTagFilterLocation(tagFilterFormula, tagId);
    const resolvedSelectedClauseIndex = ensureSelectedClause();
    const targetLane = selectedClauseLane;

    if (location) {
      if (
        resolvedSelectedClauseIndex !== -1 &&
        (location.clauseIndex !== resolvedSelectedClauseIndex ||
          location.lane !== targetLane)
      ) {
        moveTagToClauseLane(tagId, targetLane, resolvedSelectedClauseIndex);
        return;
      }

      removeTagFromFormula(tagId);
      return;
    }

    moveTagToClauseLane(tagId, targetLane);
  };

  const toggleTagIncludeOff = (tagId: string) => {
    const location = findTagFilterLocation(tagFilterFormula, tagId);

    if (location?.lane === TAG_FILTER_LANES.INCLUDE) {
      removeTagFromFormula(tagId);
      return;
    }

    moveTagToClauseLane(tagId, TAG_FILTER_LANES.INCLUDE);
  };

  const cycleTagIncludeExcludeOff = (
    tagId: string,
    operator: TagFilterOperator = TAG_FILTER_OPERATORS.OR,
  ) => {
    setTagFilterFormula((prev) => {
      const location = findTagFilterLocation(prev, tagId);

      if (location?.lane === TAG_FILTER_LANES.INCLUDE) {
        return withTagInFilterClause(prev, tagId, location.clauseIndex, {
          clauseOperator: prev.clauses[location.clauseIndex]?.operator ?? operator,
          connector: TAG_FILTER_OPERATORS.AND,
          lane: TAG_FILTER_LANES.EXCLUDE,
        });
      }

      if (location?.lane === TAG_FILTER_LANES.EXCLUDE) {
        return withoutTagInFilterFormula(prev, tagId);
      }

      if (prev.clauses.length === 0) {
        return addTagFilterClause(prev, {
          tagIds: [tagId],
          excludedTagIds: [],
          operator,
        });
      }

      return withTagInFilterClause(prev, tagId, 0, {
        clauseOperator: prev.clauses[0]?.operator ?? operator,
        connector: TAG_FILTER_OPERATORS.AND,
        lane: TAG_FILTER_LANES.INCLUDE,
      });
    });
    setSelectedClauseIndex(0);
    setSelectedClauseLane(TAG_FILTER_LANES.INCLUDE);
  };

  const moveTagToClauseOppositeLane = (tagId: string, clauseIndex: number) => {
    const location = findTagFilterLocation(tagFilterFormula, tagId);
    const targetLane =
      location?.lane === TAG_FILTER_LANES.EXCLUDE
        ? TAG_FILTER_LANES.INCLUDE
        : TAG_FILTER_LANES.EXCLUDE;

    moveTagToClauseLane(tagId, targetLane, clauseIndex);
  };

  const removeIncludeClause = (clauseIndex: number) => {
    setTagFilterFormula((prev) => removeTagFilterClause(prev, clauseIndex));
    setSelectedClauseIndex((prev) => {
      if (prev === null) {
        return null;
      }

      if (prev === clauseIndex) {
        return clauseIndex > 0 ? clauseIndex - 1 : null;
      }

      if (prev > clauseIndex) {
        return prev - 1;
      }

      return prev;
    });
  };

  const setIncludeClauseOperator = (
    clauseIndex: number,
    operator: TagFilterOperator,
  ) => {
    setTagFilterFormula((prev) =>
      updateTagFilterClauseOperator(prev, clauseIndex, operator),
    );
  };

  const setClauseConnector = (
    connectorIndex: number,
    operator: TagFilterOperator,
  ) => {
    setTagFilterFormula((prev) =>
      updateTagFilterConnector(prev, connectorIndex, operator),
    );
  };

  const getTagDisplayName = (
    tagId: string,
    taxonomy: TagTaxonomy,
  ): string => findDisplayTagName(taxonomy, tagId, { disambiguate: true });

  const clearTagFilters = () => {
    setTagFilterFormula(getDefaultFormula());
    setSelectedClauseIndex(null);
    setSelectedClauseLane(TAG_FILTER_LANES.INCLUDE);
  };

  const pruneInvalidTagFilters = (validTagIds: Set<string>) => {
    setTagFilterFormula((prev) => pruneTagFilterFormula(prev, validTagIds));
  };

  const replaceTagFilterFormula = (
    nextFormula: TagFilterFormula,
    options: {
      selectedClauseIndex?: number | null;
      selectedClauseLane?: TagFilterLane;
    } = {},
  ) => {
    const normalizedFormula = normalizeReplacementFormula(nextFormula);
    setTagFilterFormula(normalizedFormula);
    setSelectedClauseIndex(
      options.selectedClauseIndex ??
        (normalizedFormula.clauses.length > 0 ? 0 : null),
    );
    setSelectedClauseLane(
      options.selectedClauseLane ?? TAG_FILTER_LANES.INCLUDE,
    );
  };

  return {
    includeTagClauses: tagFilterFormula.clauses,
    clauseConnectors: tagFilterFormula.connectors,
    activeTagFilters,
    excludedTagFilters,
    selectedClauseIndex,
    selectedClauseLane,
    setSelectedClauseIndex,
    setSelectedClauseLane,
    addIncludeClause,
    removeIncludeClause,
    setIncludeClauseOperator,
    setClauseConnector,
    removeTagFilter,
    toggleTagInSelectedClauseLane,
    toggleTagIncludeOff,
    cycleTagIncludeExcludeOff,
    moveTagToClauseLane,
    moveTagToClauseOppositeLane,
    clearTagFilters,
    pruneInvalidTagFilters,
    replaceTagFilterFormula,
    createTagId: (tagId: string) => tagId,
    parseTagId: (tagId: string) => (tagId ? { tagId } : null),
    getTagDisplayName,
  };
}
