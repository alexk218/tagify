import { useEffect, useMemo, useState } from "react";
import {
  PAGINATION_BATCH_SIZE,
  SORT_OPTIONS,
  SORT_ORDERS,
  SortOption,
  SortOrder,
} from "@/constants/trackList";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { normalizeCamelotKey, sortCamelotKeys } from "@/utils/camelotKey";

interface UseTrackListControlsOptions {
  includeTagClauses: {
    tagIds: string[];
    operator: "AND" | "OR";
  }[];
  clauseConnectors: ("AND" | "OR")[];
  activeTagFilters: string[];
  excludedTagFilters: string[];
  onClearTagFilters: () => void;
}

export function useTrackListControls({
  includeTagClauses,
  clauseConnectors,
  activeTagFilters,
  excludedTagFilters,
  onClearTagFilters,
}: UseTrackListControlsOptions) {
  const [searchTerm, setSearchTerm] = useLocalStorage<string>(
    "tagify:trackSearchTerm",
    "",
  );
  const [displayCount, setDisplayCount] = useState<number>(PAGINATION_BATCH_SIZE);

  const [ratingFilters, setRatingFilters] = useLocalStorage<number[]>(
    "tagify:ratingFilters",
    [],
  );
  const [energyMinFilter, setEnergyMinFilter] = useLocalStorage<number | null>(
    "tagify:energyMinFilter",
    null,
  );
  const [energyMaxFilter, setEnergyMaxFilter] = useLocalStorage<number | null>(
    "tagify:energyMaxFilter",
    null,
  );
  const [showFilterOptions, setShowFilterOptions] = useLocalStorage<boolean>(
    "tagify:showFilterOptions",
    false,
  );
  const [tagSearchTerm, setTagSearchTerm] = useLocalStorage<string>(
    "tagify:tagListSearchTerm",
    "",
  );
  const [bpmMinFilter, setBpmMinFilter] = useLocalStorage<number | null>(
    "tagify:bpmMinFilter",
    null,
  );
  const [bpmMaxFilter, setBpmMaxFilter] = useLocalStorage<number | null>(
    "tagify:bpmMaxFilter",
    null,
  );
  const [camelotKeyFilters, setCamelotKeyFilters] = useLocalStorage<string[]>(
    "tagify:camelotKeyFilters",
    [],
  );
  const [showAdvancedFilters, setShowAdvancedFilters] =
    useLocalStorage<boolean>("tagify:showAdvancedFilters", false);
  const [sortBy, setSortBy] = useLocalStorage<SortOption>(
    "tagify:trackListSortBy",
    SORT_OPTIONS.DATE_MODIFIED,
  );
  const [sortOrder, setSortOrder] = useLocalStorage<SortOrder>(
    "tagify:trackListSortOrder",
    SORT_ORDERS.DESC,
  );

  const normalizedCamelotKeyFilters = useMemo(
    () => sortCamelotKeys(camelotKeyFilters),
    [camelotKeyFilters],
  );

  const selectedCamelotKeySet = useMemo(
    () => new Set(normalizedCamelotKeyFilters),
    [normalizedCamelotKeyFilters],
  );

  useEffect(() => {
    setDisplayCount(PAGINATION_BATCH_SIZE);
  }, [
    includeTagClauses,
    clauseConnectors,
    searchTerm,
    ratingFilters,
    energyMinFilter,
    energyMaxFilter,
    bpmMinFilter,
    bpmMaxFilter,
    normalizedCamelotKeyFilters,
  ]);

  const toggleRatingFilter = (rating: number) => {
    setRatingFilters((previousValue) =>
      previousValue.includes(rating)
        ? previousValue.filter((existingRating) => existingRating !== rating)
        : [...previousValue, rating],
    );
  };

  const handleEnergyMinChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value);
    setEnergyMinFilter(value);

    if (value !== null && energyMaxFilter !== null && value > energyMaxFilter) {
      setEnergyMaxFilter(value);
    }
  };

  const handleEnergyMaxChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value);
    setEnergyMaxFilter(value);

    if (value !== null && energyMinFilter !== null && energyMinFilter > value) {
      setEnergyMinFilter(value);
    }
  };

  const handleBpmMinChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value);
    setBpmMinFilter(value);

    if (value !== null && bpmMaxFilter !== null && value > bpmMaxFilter) {
      setBpmMaxFilter(value);
    }
  };

  const handleBpmMaxChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value === "" ? null : parseInt(event.target.value);
    setBpmMaxFilter(value);

    if (value !== null && bpmMinFilter !== null && bpmMinFilter > value) {
      setBpmMinFilter(value);
    }
  };

  const toggleCamelotKeyFilter = (camelotKey: string) => {
    const normalizedCamelotKey = normalizeCamelotKey(camelotKey);
    if (!normalizedCamelotKey) {
      return;
    }

    setCamelotKeyFilters((previousFilters) => {
      const normalizedPreviousFilters = sortCamelotKeys(previousFilters);
      return normalizedPreviousFilters.includes(normalizedCamelotKey)
        ? normalizedPreviousFilters.filter((key) => key !== normalizedCamelotKey)
        : sortCamelotKeys([...normalizedPreviousFilters, normalizedCamelotKey]);
    });
  };

  const clearAllFilters = () => {
    setSearchTerm("");
    setTagSearchTerm("");
    onClearTagFilters();
    setRatingFilters([]);
    setEnergyMinFilter(null);
    setEnergyMaxFilter(null);
    setBpmMinFilter(null);
    setBpmMaxFilter(null);
    setCamelotKeyFilters([]);
  };

  const activeFilterCount =
    activeTagFilters.length +
    excludedTagFilters.length +
    (ratingFilters.length > 0 ? 1 : 0) +
    (energyMinFilter !== null || energyMaxFilter !== null ? 1 : 0) +
    (bpmMinFilter !== null || bpmMaxFilter !== null ? 1 : 0) +
    (normalizedCamelotKeyFilters.length > 0 ? 1 : 0) +
    (searchTerm.trim() !== "" ? 1 : 0);

  return {
    searchTerm,
    setSearchTerm,
    displayCount,
    setDisplayCount,
    ratingFilters,
    setRatingFilters,
    energyMinFilter,
    setEnergyMinFilter,
    energyMaxFilter,
    setEnergyMaxFilter,
    showFilterOptions,
    setShowFilterOptions,
    tagSearchTerm,
    setTagSearchTerm,
    bpmMinFilter,
    setBpmMinFilter,
    bpmMaxFilter,
    setBpmMaxFilter,
    camelotKeyFilters,
    setCamelotKeyFilters,
    showAdvancedFilters,
    setShowAdvancedFilters,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    normalizedCamelotKeyFilters,
    selectedCamelotKeySet,
    toggleRatingFilter,
    handleEnergyMinChange,
    handleEnergyMaxChange,
    handleBpmMinChange,
    handleBpmMaxChange,
    toggleCamelotKeyFilter,
    clearAllFilters,
    activeFilterCount,
  };
}
