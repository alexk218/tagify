import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagCategory } from "@/types/tagData";
import { useFilterState } from "@/features/filter-state/hooks/useFilterState";
import {
  buildTaxonomyFromCategoryTree,
  createLegacyTagIdentityId,
} from "@/utils/tagTaxonomy";

const LEGACY_FILTER_STORAGE_KEY = "tagify:filterState";
const TRACK_FILTER_STORAGE_KEY = "tagify:filterState:tracks";
const PLAYLIST_FILTER_STORAGE_KEY = "tagify:filterState:playlists";
const ARTIST_FILTER_STORAGE_KEY = "tagify:filterState:artists";
const HOUSE_TAG_ID = createLegacyTagIdentityId("genre", "electronic", "house");
const CHILL_TAG_ID = createLegacyTagIdentityId("mood", "energy", "chill");
const PEAK_TAG_ID = createLegacyTagIdentityId("mood", "energy", "peak");

function createStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));

  vi.mocked(localStorage.getItem).mockImplementation((key: string) => {
    return store.has(key) ? store.get(key)! : null;
  });

  vi.mocked(localStorage.setItem).mockImplementation((key: string, value: string) => {
    store.set(key, value);
  });

  vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
    store.delete(key);
  });

  vi.mocked(localStorage.clear).mockImplementation(() => {
    store.clear();
  });

  return store;
}

describe("useFilterState", () => {
  beforeEach(() => {
    createStorageMock();
  });

  it("hydrates legacy active/excluded filters from localStorage", async () => {
    createStorageMock({
      [LEGACY_FILTER_STORAGE_KEY]: JSON.stringify({
        activeTagFilters: ["genre:electronic:house", "mood:energy:peak"],
        excludedTagFilters: ["mood:energy:chill"],
        isOrFilterMode: false,
      }),
    });

    const { result } = renderHook(() => useFilterState());

    await waitFor(() => {
      expect(result.current.includeTagClauses).toEqual([
        {
          tagIds: [HOUSE_TAG_ID, PEAK_TAG_ID],
          excludedTagIds: [],
          operator: "AND",
        },
        {
          tagIds: [],
          excludedTagIds: [CHILL_TAG_ID],
          operator: "OR",
        },
      ]);
      expect(result.current.clauseConnectors).toEqual(["AND"]);
      expect(result.current.activeTagFilters).toEqual([HOUSE_TAG_ID, PEAK_TAG_ID]);
      expect(result.current.excludedTagFilters).toEqual([CHILL_TAG_ID]);
    });
  });

  it("builds multiple OR clauses with the selected group", () => {
    const { result } = renderHook(() => useFilterState());

    act(() => {
      result.current.toggleTagIncludeOff(HOUSE_TAG_ID);
    });
    act(() => {
      result.current.addIncludeClause();
    });
    act(() => {
      result.current.toggleTagIncludeOff(PEAK_TAG_ID);
    });
    act(() => {
      result.current.toggleTagIncludeOff(CHILL_TAG_ID);
    });

    expect(result.current.includeTagClauses).toEqual([
      {
        tagIds: [HOUSE_TAG_ID],
        excludedTagIds: [],
        operator: "OR",
      },
      {
        tagIds: [PEAK_TAG_ID, CHILL_TAG_ID],
        excludedTagIds: [],
        operator: "OR",
      },
    ]);
    expect(result.current.clauseConnectors).toEqual(["AND"]);
    expect(result.current.activeTagFilters).toEqual([
      HOUSE_TAG_ID,
      PEAK_TAG_ID,
      CHILL_TAG_ID,
    ]);
  });

  it("cycles a tag through Match -> Must not have -> Off in the selected group", () => {
    const { result } = renderHook(() => useFilterState());

    act(() => {
      result.current.toggleTagInSelectedClauseLane(HOUSE_TAG_ID);
    });
    expect(result.current.includeTagClauses).toEqual([
      {
        tagIds: [HOUSE_TAG_ID],
        excludedTagIds: [],
        operator: "OR",
      },
    ]);
    expect(result.current.excludedTagFilters).toEqual([]);

    act(() => {
      result.current.setSelectedClauseLane("exclude");
    });
    act(() => {
      result.current.toggleTagInSelectedClauseLane(HOUSE_TAG_ID);
    });
    expect(result.current.includeTagClauses).toEqual([
      {
        tagIds: [],
        excludedTagIds: [HOUSE_TAG_ID],
        operator: "OR",
      },
    ]);
    act(() => {
      result.current.toggleTagInSelectedClauseLane(HOUSE_TAG_ID);
    });
    expect(result.current.includeTagClauses).toEqual([]);
    expect(result.current.excludedTagFilters).toEqual([]);
  });

  it("moves NOT tags back into the selected Match lane", () => {
    const { result } = renderHook(() => useFilterState());

    act(() => {
      result.current.setSelectedClauseLane("exclude");
    });
    act(() => {
      result.current.toggleTagInSelectedClauseLane(HOUSE_TAG_ID);
    });
    expect(result.current.excludedTagFilters).toEqual([HOUSE_TAG_ID]);

    act(() => {
      result.current.setSelectedClauseLane("include");
    });
    act(() => {
      result.current.toggleTagInSelectedClauseLane(HOUSE_TAG_ID);
    });

    expect(result.current.includeTagClauses).toEqual([
      {
        tagIds: [HOUSE_TAG_ID],
        excludedTagIds: [],
        operator: "OR",
      },
    ]);
    expect(result.current.excludedTagFilters).toEqual([]);
  });

  it("removes pending empty groups without persisting them", async () => {
    const store = createStorageMock();
    const { result } = renderHook(() => useFilterState());

    act(() => {
      result.current.addIncludeClause();
      result.current.removeIncludeClause(0);
    });

    expect(result.current.includeTagClauses).toEqual([]);
    expect(result.current.selectedClauseIndex).toBeNull();

    await waitFor(() => {
      const saved = store.get(TRACK_FILTER_STORAGE_KEY);
      expect(saved).toBeTruthy();
      expect(JSON.parse(saved!)).toEqual({
        includeTagClauses: [],
        clauseConnectors: [],
      });
    });
  });

  it("does not create duplicate empty groups", () => {
    const { result } = renderHook(() => useFilterState());

    act(() => {
      result.current.toggleTagIncludeOff(HOUSE_TAG_ID);
    });
    act(() => {
      result.current.addIncludeClause();
    });

    expect(result.current.includeTagClauses).toEqual([
      {
        tagIds: [HOUSE_TAG_ID],
        excludedTagIds: [],
        operator: "OR",
      },
      {
        tagIds: [],
        excludedTagIds: [],
        operator: "OR",
      },
    ]);
    expect(result.current.selectedClauseIndex).toBe(1);

    act(() => {
      result.current.addIncludeClause();
    });

    expect(result.current.includeTagClauses).toEqual([
      {
        tagIds: [HOUSE_TAG_ID],
        excludedTagIds: [],
        operator: "OR",
      },
      {
        tagIds: [],
        excludedTagIds: [],
        operator: "OR",
      },
    ]);
    expect(result.current.selectedClauseIndex).toBe(1);
  });

  it("resolves tag display name from taxonomy", () => {
    const categories: TagCategory[] = [
      {
        id: "genre",
        name: "Genre",
        subcategories: [
          {
            id: "electronic",
            name: "Electronic",
            tags: [{ id: "house", name: "House" }],
          },
        ],
      },
    ];
    const taxonomy = buildTaxonomyFromCategoryTree(categories);

    const { result } = renderHook(() => useFilterState());

    expect(result.current.getTagDisplayName(HOUSE_TAG_ID, taxonomy)).toBe("House");
    expect(result.current.getTagDisplayName("missing:tag:id", taxonomy)).toBe("missing:tag:id");
  });

  it("persists grouped filters back to localStorage", async () => {
    const store = createStorageMock();
    const { result } = renderHook(() => useFilterState());

    act(() => {
      result.current.toggleTagIncludeOff(HOUSE_TAG_ID);
    });
    act(() => {
      result.current.addIncludeClause();
    });
    act(() => {
      result.current.toggleTagIncludeOff(PEAK_TAG_ID);
    });
    act(() => {
      result.current.setSelectedClauseLane("exclude");
    });
    act(() => {
      result.current.toggleTagInSelectedClauseLane(CHILL_TAG_ID);
    });

    await waitFor(() => {
      const saved = store.get(TRACK_FILTER_STORAGE_KEY);
      expect(saved).toBeTruthy();

      const parsed = JSON.parse(saved!);
      expect(parsed.includeTagClauses).toEqual([
        {
          tagIds: [HOUSE_TAG_ID],
          excludedTagIds: [],
          operator: "OR",
        },
        {
          tagIds: [PEAK_TAG_ID],
          excludedTagIds: [CHILL_TAG_ID],
          operator: "OR",
        },
      ]);
      expect(parsed.clauseConnectors).toEqual(["AND"]);
    });
  });

  it("keeps scoped filter states independent", () => {
    createStorageMock({
      [TRACK_FILTER_STORAGE_KEY]: JSON.stringify({
        includeTagClauses: [
          { tagIds: [HOUSE_TAG_ID], excludedTagIds: [], operator: "OR" },
        ],
        clauseConnectors: [],
      }),
      [PLAYLIST_FILTER_STORAGE_KEY]: JSON.stringify({
        includeTagClauses: [
          { tagIds: [CHILL_TAG_ID], excludedTagIds: [], operator: "OR" },
        ],
        clauseConnectors: [],
      }),
      [ARTIST_FILTER_STORAGE_KEY]: JSON.stringify({
        includeTagClauses: [
          { tagIds: [PEAK_TAG_ID], excludedTagIds: [], operator: "OR" },
        ],
        clauseConnectors: [],
      }),
    });

    const trackState = renderHook(() => useFilterState("tracks"));
    const playlistState = renderHook(() => useFilterState("playlists"));
    const artistState = renderHook(() => useFilterState("artists"));

    expect(trackState.result.current.activeTagFilters).toEqual([HOUSE_TAG_ID]);
    expect(playlistState.result.current.activeTagFilters).toEqual([CHILL_TAG_ID]);
    expect(artistState.result.current.activeTagFilters).toEqual([PEAK_TAG_ID]);

    act(() => {
      playlistState.result.current.clearTagFilters();
    });

    expect(trackState.result.current.activeTagFilters).toEqual([HOUSE_TAG_ID]);
    expect(playlistState.result.current.activeTagFilters).toEqual([]);
    expect(artistState.result.current.activeTagFilters).toEqual([PEAK_TAG_ID]);
  });

  it("migrates the legacy global filter key into tracks only", async () => {
    const store = createStorageMock({
      [LEGACY_FILTER_STORAGE_KEY]: JSON.stringify({
        includeTagClauses: [
          { tagIds: [HOUSE_TAG_ID], excludedTagIds: [], operator: "OR" },
        ],
        clauseConnectors: [],
      }),
    });

    const trackState = renderHook(() => useFilterState("tracks"));
    const playlistState = renderHook(() => useFilterState("playlists"));

    expect(trackState.result.current.activeTagFilters).toEqual([HOUSE_TAG_ID]);
    expect(playlistState.result.current.activeTagFilters).toEqual([]);

    await waitFor(() => {
      expect(store.get(TRACK_FILTER_STORAGE_KEY)).toBeTruthy();
      expect(store.has(LEGACY_FILTER_STORAGE_KEY)).toBe(false);
    });
  });
});
