import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PAGINATION_BATCH_SIZE,
  SORT_OPTIONS,
  SORT_ORDERS,
  SortOption,
  SortOrder,
} from "@/constants/trackList";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import { normalizeCamelotKey, sortCamelotKeys } from "@/utils/camelotKey";
import type { SongDetailFilterCriteria } from "@/utils/songDetails";

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
  const [lengthMinFilter, setLengthMinFilter] = useLocalStorage<number | null>("tagify:lengthMinFilter", null);
  const [lengthMaxFilter, setLengthMaxFilter] = useLocalStorage<number | null>("tagify:lengthMaxFilter", null);
  const [releaseYearMinFilter, setReleaseYearMinFilter] = useLocalStorage<number | null>("tagify:releaseYearMinFilter", null);
  const [releaseYearMaxFilter, setReleaseYearMaxFilter] = useLocalStorage<number | null>("tagify:releaseYearMaxFilter", null);
  const songDetailFilters = useMemo<Required<SongDetailFilterCriteria>>(
    () => ({ lengthMinFilter, lengthMaxFilter, releaseYearMinFilter, releaseYearMaxFilter }),
    [lengthMinFilter, lengthMaxFilter, releaseYearMinFilter, releaseYearMaxFilter],
  );
  const setSongDetailFilters = useCallback((filters: SongDetailFilterCriteria) => {
    setLengthMinFilter(filters.lengthMinFilter ?? null);
    setLengthMaxFilter(filters.lengthMaxFilter ?? null);
    setReleaseYearMinFilter(filters.releaseYearMinFilter ?? null);
    setReleaseYearMaxFilter(filters.releaseYearMaxFilter ?? null);
  }, [setLengthMaxFilter, setLengthMinFilter, setReleaseYearMaxFilter, setReleaseYearMinFilter]);
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
    songDetailFilters,
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

  /** Keeps From at or below To, like the BPM range. */
  const handleRangeChange = (
    value: number | null,
    edge: "min" | "max",
    other: number | null,
    setValue: (next: number | null) => void,
    setOther: (next: number | null) => void,
  ) => {
    setValue(value);
    if (value !== null && other !== null && (edge === "min" ? value > other : other > value)) setOther(value);
  };
  const selectValue = (event: React.ChangeEvent<HTMLSelectElement>) =>
    event.target.value === "" ? null : parseInt(event.target.value, 10);
  const handleLengthMinChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    handleRangeChange(selectValue(event), "min", lengthMaxFilter, setLengthMinFilter, setLengthMaxFilter);
  const handleLengthMaxChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    handleRangeChange(selectValue(event), "max", lengthMinFilter, setLengthMaxFilter, setLengthMinFilter);
  const handleReleaseYearMinChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    handleRangeChange(selectValue(event), "min", releaseYearMaxFilter, setReleaseYearMinFilter, setReleaseYearMaxFilter);
  const handleReleaseYearMaxChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
    handleRangeChange(selectValue(event), "max", releaseYearMinFilter, setReleaseYearMaxFilter, setReleaseYearMinFilter);

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
    setSongDetailFilters({});
  };

  const activeFilterCount =
    activeTagFilters.length +
    excludedTagFilters.length +
    (ratingFilters.length > 0 ? 1 : 0) +
    (energyMinFilter !== null || energyMaxFilter !== null ? 1 : 0) +
    (bpmMinFilter !== null || bpmMaxFilter !== null ? 1 : 0) +
    (normalizedCamelotKeyFilters.length > 0 ? 1 : 0) +
    (lengthMinFilter !== null || lengthMaxFilter !== null ? 1 : 0) +
    (releaseYearMinFilter !== null || releaseYearMaxFilter !== null ? 1 : 0) +
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
    songDetailFilters,
    setSongDetailFilters,
    handleLengthMinChange,
    handleLengthMaxChange,
    handleReleaseYearMinChange,
    handleReleaseYearMaxChange,
    clearAllFilters,
    activeFilterCount,
  };
}
