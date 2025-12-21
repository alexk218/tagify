import { useState, useEffect } from "react";
import { TagCategory } from "@/hooks/data/useTagData";

export function useFilterState() {
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [excludedTagFilters, setExcludedTagFilters] = useState<string[]>([]);

  // Load saved filters on mount
  useEffect(() => {
    try {
      const savedFilters = localStorage.getItem("tagify:filterState");
      if (savedFilters) {
        const filters = JSON.parse(savedFilters);

        // Only set the tag filters if they exist in the saved state
        if (filters.activeTagFilters && Array.isArray(filters.activeTagFilters)) {
          setActiveTagFilters(filters.activeTagFilters);
        }

        if (filters.excludedTagFilters && Array.isArray(filters.excludedTagFilters)) {
          setExcludedTagFilters(filters.excludedTagFilters);
        }
      }
    } catch (error) {
      console.error("Error loading tag filters from localStorage:", error);
    }
  }, []);

  // Save filters when they change
  useEffect(() => {
    try {
      const filterState = {
        activeTagFilters,
        excludedTagFilters,
      };

      localStorage.setItem("tagify:filterState", JSON.stringify(filterState));
    } catch (error) {
      console.error("Error saving filter state:", error);
    }
  }, [activeTagFilters, excludedTagFilters]);

  const createTagId = (categoryId: string, subcategoryId: string, tagId: string): string => {
    return `${categoryId}:${subcategoryId}:${tagId}`;
  };

  const parseTagId = (
    fullTagId: string
  ): { categoryId: string; subcategoryId: string; tagId: string } | null => {
    const parts = fullTagId.split(":");
    if (parts.length !== 3) return null;
    return {
      categoryId: parts[0],
      subcategoryId: parts[1],
      tagId: parts[2],
    };
  };

  const removeTagFilter = (fullTagId: string) => {
    if (activeTagFilters.includes(fullTagId)) {
      setActiveTagFilters((prev) => prev.filter((t) => t !== fullTagId));
    } else if (excludedTagFilters.includes(fullTagId)) {
      setExcludedTagFilters((prev) => prev.filter((t) => t !== fullTagId));
    }
  };

  // toggles between ON/EXCLUDE
  const toggleTagIncludeExclude = (fullTagId: string, isExcluded: boolean) => {
    if (isExcluded) {
      setExcludedTagFilters((prev) => prev.filter((t) => t !== fullTagId));
      setActiveTagFilters((prev) => [...prev, fullTagId]);
    } else {
      setActiveTagFilters((prev) => prev.filter((t) => t !== fullTagId));
      setExcludedTagFilters((prev) => [...prev, fullTagId]);
    }
  };

  // toggles between all states INCLUDE/EXCLUDE/OFF
  const toggleTagIncludeExcludeOff = (fullTagId: string) => {
    if (activeTagFilters.includes(fullTagId)) {
      // Move from INCLUDE to EXCLUDE
      setActiveTagFilters((prev) => prev.filter((t) => t !== fullTagId));
      setExcludedTagFilters((prev) => [...prev, fullTagId]);
    } else if (excludedTagFilters.includes(fullTagId)) {
      // Move from EXCLUDE to OFF
      setExcludedTagFilters((prev) => prev.filter((t) => t !== fullTagId));
    } else {
      // Move from OFF to INCLUDE
      setActiveTagFilters((prev) => [...prev, fullTagId]);
    }
  };

  // toggles between INCLUDE/OFF - no EXCLUDE
  const toggleTagIncludeOff = (fullTagId: string) => {
    if (activeTagFilters.includes(fullTagId)) {
      // Remove from active filters (turn OFF)
      setActiveTagFilters((prev) => prev.filter((t) => t !== fullTagId));
    } else if (excludedTagFilters.includes(fullTagId)) {
      // Move from excluded to active (turn ON)
      setExcludedTagFilters((prev) => prev.filter((t) => t !== fullTagId));
      setActiveTagFilters((prev) => [...prev, fullTagId]);
    } else {
      // Add to active filters (turn ON)
      setActiveTagFilters((prev) => [...prev, fullTagId]);
    }
  };

  const getTagDisplayName = (fullTagId: string, categories: TagCategory[]): string => {
    const parsed = parseTagId(fullTagId);
    if (!parsed) return fullTagId;

    const category = categories.find((c) => c.id === parsed.categoryId);
    const subcategory = category?.subcategories.find((s) => s.id === parsed.subcategoryId);
    const tag = subcategory?.tags.find((t) => t.id === parsed.tagId);

    return tag?.name || fullTagId;
  };

  const clearTagFilters = () => {
    setActiveTagFilters([]);
    setExcludedTagFilters([]);
  };

  return {
    activeTagFilters,
    excludedTagFilters,
    removeTagFilter,
    toggleTagIncludeExclude,
    toggleTagIncludeExcludeOff,
    toggleTagIncludeOff,
    clearTagFilters,
    createTagId,
    parseTagId,
    getTagDisplayName,
  };
}
