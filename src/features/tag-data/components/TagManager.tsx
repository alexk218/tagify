import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Download, GripVertical, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react";
import styles from "./TagManager.module.css";
import { Portal } from "@/components/ui";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";
import {
  Tag,
  TagCategory,
  TagSubcategory,
  TagAccentId,
  TagTaxonomy,
  TaxonomyFolder,
  ArtistData,
  PlaylistData,
  TrackData,
} from "@/types/tagData";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
import { countTagFilterFormulaReferences } from "@/utils/tagFilterGroups";
import { buildCategoryTree, collectTagIdsForParent, createEntityId } from "@/utils/tagTaxonomy";
import {
  cloneTaxonomy,
  getRelativeInsertIndex,
  getSortableReorderTargetIndex,
  moveCategory,
  moveCategoryIntoParent,
  moveSubcategory,
  moveTag,
  type RelativeDropPlacement,
  type TaxonomyMoveReason,
  type TaxonomyMoveResult,
} from "@/features/tag-data/utils/tagManager.taxonomy";
import {
  buildCustomTagAccentId,
  buildTagAccentCssVars,
  getTagAccentOptions,
  getTagAccentTokens,
  isCustomTagAccentId,
  TAG_ACCENT_PRESET_OPTIONS,
  truncateName,
  type TagAccentOption,
} from "@/features/tag-data/utils/tagAccent";
import {
  parseColorLibrary,
  normalizeColorLibrary,
  serializeColorLibrary,
  uniqueImportedName,
  getOrderedCustomColors,
  getOrderedColorThemes,
  type ColorLibrarySortMode,
} from "@/features/tag-data/utils/tagColorThemes";
import {
  importCommunityTagPackage,
  type CommunityTagImportPackage,
} from "@/features/tag-data/utils/communityTagImport";

type DragState =
  | {
      type: "category";
      categoryId: string;
      label: string;
    }
  | {
      type: "subcategory";
      categoryId: string;
      subcategoryId: string;
      label: string;
    }
  | {
      type: "tag";
      categoryId: string;
      subcategoryId: string;
      tagId: string;
      label: string;
    };

type NativeTaxonomyDragState =
  | {
      type: "category";
      categoryId: string;
    }
  | {
      type: "subcategory";
      categoryId: string;
      parentId: string;
      subcategoryId: string;
    }
  | {
      type: "tag";
      categoryId: string;
      parentId: string;
      tagId: string;
    };

type CategoryDragData = {
  type: "category";
  categoryId: string;
  label: string;
};

type SubcategoryDragData = {
  type: "subcategory";
  categoryId: string;
  parentId: string;
  subcategoryId: string;
  label: string;
};

type TagDragData = {
  type: "tag";
  categoryId: string;
  subcategoryId: string;
  tagId: string;
  label: string;
};

type TagEndDragData = {
  type: "tag-end";
  subcategoryId: string;
};

type SupportedDndData =
  | CategoryDragData
  | SubcategoryDragData
  | TagDragData
  | TagEndDragData;

interface SortableCategoryCardProps {
  category: TagCategory;
  isExpanded: boolean;
  isSelected: boolean;
  isDragDisabled: boolean;
  isDropActive: boolean;
  tagCount: number;
  onToggleExpanded: (categoryId: string) => void;
  onSelectCategory: (categoryId: string) => void;
  onRenameCategory: (categoryId: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onNativeDragStart: (event: React.DragEvent, categoryId: string) => void;
  onNativeDragOver: (event: React.DragEvent) => void;
  onNativeDrop: (event: React.DragEvent, categoryId: string) => void;
  onNativeDragEnd: () => void;
  children: React.ReactNode;
}

interface SortableSubcategoryRowProps {
  categoryId: string;
  parentId: string;
  subcategoryId: string;
  name: string;
  tagCount: number;
  childFolderCount: number;
  isExpanded: boolean;
  isSelected: boolean;
  isDragDisabled: boolean;
  isTagDropActive: boolean;
  onToggleExpanded: (subcategoryId: string) => void;
  onSelectSubcategory: (categoryId: string, subcategoryId: string) => void;
  onRenameSubcategory: (categoryId: string, subcategoryId: string) => void;
  onDeleteSubcategory: (categoryId: string, subcategoryId: string) => void;
  onNativeDragStart: (
    event: React.DragEvent,
    categoryId: string,
    parentId: string,
    subcategoryId: string,
  ) => void;
  onNativeDragOver: (event: React.DragEvent) => void;
  onNativeDrop: (
    event: React.DragEvent,
    categoryId: string,
    parentId: string,
    subcategoryId: string,
  ) => void;
  onNativeDragEnd: () => void;
}

interface SortableTagRowProps {
  categoryId: string;
  subcategoryId: string;
  tag: Tag;
  isDragDisabled: boolean;
  isDropActive: boolean;
  isAccentPickerOpen: boolean;
  customAccentsById: TagTaxonomy["customAccentsById"];
  accentGroups: TagAccentGroup[];
  onRenameTag: (subcategoryId: string, tagId: string) => void;
  onDeleteTag: (subcategoryId: string, tagId: string) => void;
  onToggleAccentPicker: (tagId: string) => void;
  onSetTagAccent: (tagId: string, accentId: TagAccentId | null) => void;
  onNativeDragStart: (
    event: React.DragEvent,
    categoryId: string,
    parentId: string,
    tagId: string,
  ) => void;
  onNativeDragOver: (event: React.DragEvent) => void;
  onNativeDrop: (
    event: React.DragEvent,
    categoryId: string,
    parentId: string,
    tagId: string,
  ) => void;
  onNativeDragEnd: () => void;
}

interface TagAccentGroup {
  label: string;
  options: TagAccentOption[];
}

interface TagEndDropZoneProps {
  subcategoryId: string;
  isVisible: boolean;
  isDropActive: boolean;
  onNativeDragOver: (event: React.DragEvent) => void;
  onNativeDrop: (event: React.DragEvent, parentId: string) => void;
}

interface TagManagerProps {
  taxonomy: TagTaxonomy;
  tracks: Record<string, TrackData>;
  playlists: Record<string, PlaylistData>;
  artists: Record<string, ArtistData>;
  activeTagFilters: string[];
  excludedTagFilters: string[];
  smartPlaylists: SmartPlaylistCriteria[];
  initialExpandedCategoryIds?: string[];
  onExpandedCategoryIdsChange?: (categoryIds: string[]) => void;
  initialSelectedSubcategoryId?: string | null;
  onSelectedSubcategoryIdChange?: (subcategoryId: string | null) => void;
  onClose: () => void;
  onReplaceTaxonomy: (newTaxonomy: TagTaxonomy, removedTagIds: string[]) => void;
}

const MAX_NAME_LENGTH = 30;
// Community backups can't store these characters in names.
const UNSUPPORTED_NAME_CHARACTERS = /[<>]/;
const UNSUPPORTED_NAME_MESSAGE = "Names can't include < or >.";
const HOVER_EXPAND_DELAY_MS = 400;
const UNGROUPED_COLOR_FILTER = "__ungrouped__";
const SHOW_DEFAULT_PALETTE_STORAGE_KEY = "tagify:showDefaultColorPalette";
// Preserve the existing storage key so current users keep their selected mode.
const COLOR_LIBRARY_SORT_STORAGE_KEY = "tagify:colorThemeSortMode";
const DOWNLOAD_URL_REVOKE_DELAY_MS = 0;
const COLOR_LIBRARY_SORT_DESCRIPTIONS: Record<ColorLibrarySortMode, string> = {
  custom: "in custom order",
  alphabetical: "alphabetically",
  created: "by creation date",
  updated: "by last update",
};

type TagManagerView = "tags" | "community" | "colors";

interface CommunityCatalogTag {
  key: string;
  name: string;
  songCount: number;
  contributorCount?: number;
  assignmentCount?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
}

interface CommunityCatalogResponse {
  tags?: CommunityCatalogTag[];
}

type CommunityCatalogSortMode =
  | "popular"
  | "contributors"
  | "alphabetical"
  | "recent";
type CommunityCatalogSortDirection = "descending" | "ascending";

const COMMUNITY_TAGS_FETCH_TIMEOUT_MS = 10000;
const COMMUNITY_TAGS_API_BASE = "https://community.tagify.fm";
const COMMUNITY_TAGS_CATALOG_ENDPOINT = `${COMMUNITY_TAGS_API_BASE}/api/v1/tags`;

const buildCategoryDndId = (categoryId: string) => `category:${categoryId}`;
const buildSubcategoryDndId = (subcategoryId: string) => `subcategory:${subcategoryId}`;
const buildTagDndId = (tagId: string) => `tag:${tagId}`;
const buildTagEndDndId = (subcategoryId: string) => `tag-end:${subcategoryId}`;

function downloadColors(taxonomy: TagTaxonomy, themeId?: string): void {
  const theme = themeId ? taxonomy.colorThemesById[themeId] : null;
  const blob = new Blob([JSON.stringify(serializeColorLibrary(taxonomy, themeId), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = theme ? `tagify-theme-${theme.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json` : "tagify-colors.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function loadCommunityCatalogTags(): Promise<CommunityCatalogTag[]> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", COMMUNITY_TAGS_CATALOG_ENDPOINT, true);
    request.responseType = "json";
    request.timeout = COMMUNITY_TAGS_FETCH_TIMEOUT_MS;
    request.setRequestHeader("Accept", "application/json");

    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Community tags request failed with ${request.status}.`));
        return;
      }

      const response =
        typeof request.response === "object" && request.response !== null
          ? (request.response as CommunityCatalogResponse)
          : (JSON.parse(String(request.responseText || "{}")) as CommunityCatalogResponse);
      resolve(Array.isArray(response.tags) ? response.tags : []);
    };
    request.onerror = () => reject(new Error("Community tags request failed."));
    request.ontimeout = () => reject(new Error("Community tags request timed out."));
    request.send();
  });
}

function formatCommunityTagStats(tag: CommunityCatalogTag): string {
  const contributorCount = tag.contributorCount ?? 0;
  const userLabel = contributorCount === 1 ? "user" : "users";
  const trackLabel = tag.songCount === 1 ? "track" : "tracks";

  return `${tag.songCount} public ${trackLabel} · ${contributorCount} ${userLabel}`;
}

function buildCommunityTagSearchUrl(tag: CommunityCatalogTag): string {
  return `${COMMUNITY_TAGS_API_BASE}/search?tag=${encodeURIComponent(`label:${encodeURIComponent(tag.name)}`)}`;
}

function openCommunityTagSearch(tag: CommunityCatalogTag): void {
  window.open(buildCommunityTagSearchUrl(tag), "_blank", "noopener,noreferrer");
}

function countTrackReferences(
  tracks: Record<string, TrackData>,
  tagIds: string[],
): number {
  const targetIds = new Set(tagIds);
  let count = 0;

  Object.values(tracks).forEach((track) => {
    track.tagIds.forEach((tagId) => {
      if (targetIds.has(tagId)) {
        count += 1;
      }
    });
  });

  return count;
}

function countEntityReferences(
  entities: Record<string, { tagIds: string[] }>,
  tagIds: string[],
): number {
  const targetIds = new Set(tagIds);
  let count = 0;

  Object.values(entities).forEach((entity) => {
    entity.tagIds.forEach((tagId) => {
      if (targetIds.has(tagId)) {
        count += 1;
      }
    });
  });

  return count;
}

function countSavedFilterReferences(
  activeTagFilters: string[],
  excludedTagFilters: string[],
  tagIds: string[],
): number {
  const targetIds = new Set(tagIds);

  return (
    activeTagFilters.filter((tagId) => targetIds.has(tagId)).length +
    excludedTagFilters.filter((tagId) => targetIds.has(tagId)).length
  );
}

function countSmartPlaylistReferences(
  smartPlaylists: SmartPlaylistCriteria[],
  tagIds: string[],
): number {
  let count = 0;

  smartPlaylists.forEach((playlist) => {
    count += countTagFilterFormulaReferences(
      {
        clauses: playlist.criteria.includeTagClauses,
        connectors: playlist.criteria.clauseConnectors,
      },
      tagIds,
    );
  });

  return count;
}

function formatDeletionReferenceSummary(
  trackReferenceCount: number,
  playlistReferenceCount: number,
  artistReferenceCount: number,
  filterReferenceCount: number,
  smartPlaylistReferenceCount: number,
): string {
  return (
    `${trackReferenceCount} track tag assignments, ` +
    `${playlistReferenceCount} playlist tag assignments, ` +
    `${artistReferenceCount} artist tag assignments, ` +
    `${filterReferenceCount} saved filter references, and ` +
    `${smartPlaylistReferenceCount} smart playlist criteria references`
  );
}

function readDndData(value: unknown): SupportedDndData | null {
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") {
    return null;
  }

  const candidate = value as SupportedDndData;
  if (candidate.type === "category" && "categoryId" in candidate) {
    return candidate;
  }

  if (
    candidate.type === "subcategory" &&
    "categoryId" in candidate &&
    "parentId" in candidate &&
    "subcategoryId" in candidate
  ) {
    return candidate;
  }

  if (
    candidate.type === "tag" &&
    "categoryId" in candidate &&
    "subcategoryId" in candidate &&
    "tagId" in candidate
  ) {
    return candidate;
  }

  if (candidate.type === "tag-end" && "subcategoryId" in candidate) {
    return candidate;
  }

  return null;
}

function isPointerWithinElement(
  pointerCoordinates: { x: number; y: number } | null,
  element: HTMLElement | null,
): boolean {
  if (!pointerCoordinates || !element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    pointerCoordinates.x >= rect.left &&
    pointerCoordinates.x <= rect.right &&
    pointerCoordinates.y >= rect.top &&
    pointerCoordinates.y <= rect.bottom
  );
}

function getDropPlacement(
  pointerCoordinates: { x: number; y: number } | null,
  rect: { top: number; height: number } | undefined,
): RelativeDropPlacement {
  if (
    !pointerCoordinates ||
    typeof pointerCoordinates.y !== "number" ||
    Number.isNaN(pointerCoordinates.y) ||
    !rect ||
    rect.height <= 0
  ) {
    return "before";
  }

  const relativeY = pointerCoordinates.y - rect.top;
  if (relativeY < rect.height * 0.3) {
    return "before";
  }
  if (relativeY > rect.height * 0.7) {
    return "after";
  }
  return "inside";
}

function promptForName(
  label: string,
  currentValue = "",
): string | null {
  const nextName = window.prompt(label, currentValue);

  if (!nextName || !nextName.trim()) {
    return null;
  }

  return nextName.trim();
}

function getCategoryTagCount(category: TagCategory): number {
  return (category.tags?.length || 0) + category.subcategories.reduce(
    (count, subcategory) => count + getSubcategoryTagCount(subcategory),
    0,
  );
}

function getSubcategoryTagCount(subcategory: TagSubcategory): number {
  return subcategory.tags.length + (subcategory.subcategories || []).reduce(
    (count, child) => count + getSubcategoryTagCount(child),
    0,
  );
}

function filterCategoryTree(
  categories: TagCategory[],
  searchQuery: string,
): TagCategory[] {
  const normalizedQuery = normalizeName(searchQuery);
  if (!normalizedQuery) {
    return categories;
  }

  return categories.flatMap((category) => {
    const categoryMatches = normalizeName(category.name).includes(normalizedQuery);
    if (categoryMatches) {
      return [category];
    }

    const matchingTags = (category.tags || []).filter((tag) =>
      normalizeName(tag.name).includes(normalizedQuery),
    );
    const matchingSubcategories = category.subcategories.flatMap((subcategory) => {
      if (normalizeName(subcategory.name).includes(normalizedQuery)) {
        return [subcategory];
      }

      const matchingChildTags = subcategory.tags.filter((tag) =>
        normalizeName(tag.name).includes(normalizedQuery),
      );
      const matchingChildren = (subcategory.subcategories || []).filter((child) =>
        normalizeName(child.name).includes(normalizedQuery)
        || child.tags.some((tag) => normalizeName(tag.name).includes(normalizedQuery)),
      );
      if (!matchingChildTags.length && !matchingChildren.length) return [];
      return [{ ...subcategory, tags: matchingChildTags, subcategories: matchingChildren }];
    });

    if (matchingTags.length === 0 && matchingSubcategories.length === 0) {
      return [];
    }

    return [
      {
        ...category,
        tags: matchingTags,
        subcategories: matchingSubcategories,
      },
    ];
  });
}

function buildSubcategoryMoveErrorMessage(reason: TaxonomyMoveReason): string {
  switch (reason) {
    case "duplicate-subcategory-name":
      return "That folder already contains an item with the same name.";
    case "invalid-descendant":
      return "A folder cannot be moved inside itself or one of its nested folders.";
    case "missing-source":
    case "missing-target":
      return "That subcategory move could not be completed because the destination is no longer available.";
    case "same-position":
      return "";
    default:
      return "That subcategory move could not be completed.";
  }
}

function buildTagMoveErrorMessage(reason: TaxonomyMoveReason): string {
  switch (reason) {
    case "duplicate-tag-name":
      return "That subcategory already contains a tag with the same name.";
    case "missing-source":
    case "missing-target":
      return "That tag move could not be completed because the destination is no longer available.";
    case "same-position":
      return "";
    default:
      return "That tag move could not be completed.";
  }
}

function SortableCategoryCard({
  category,
  isExpanded,
  isSelected,
  isDragDisabled,
  isDropActive,
  tagCount,
  onToggleExpanded,
  onSelectCategory,
  onRenameCategory,
  onDeleteCategory,
  onNativeDragStart,
  onNativeDragOver,
  onNativeDrop,
  onNativeDragEnd,
  children,
}: SortableCategoryCardProps) {
  const sortable = useSortable({
    id: buildCategoryDndId(category.id),
    disabled: isDragDisabled,
    data: {
      type: "category",
      categoryId: category.id,
      label: category.name,
    } as CategoryDragData,
  });

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      draggable={!isDragDisabled}
      onDragStart={(event) => onNativeDragStart(event, category.id)}
      onDragOver={onNativeDragOver}
      onDrop={(event) => onNativeDrop(event, category.id)}
      onDragEnd={onNativeDragEnd}
      className={`${styles.categoryCard} ${
        isSelected ? styles.categoryCardSelected : ""
      } ${sortable.isDragging ? styles.sortableDragging : ""} ${
        isDropActive ? styles.dropTargetActive : ""
      }`}
    >
      <div className={styles.categoryCardHeader}>
        <button
          type="button"
          className={styles.expandButton}
          aria-label={isExpanded ? `Collapse ${category.name}` : `Expand ${category.name}`}
          onClick={() => onToggleExpanded(category.id)}
        >
          {isExpanded ? "▾" : "▸"}
        </button>

        <button
          ref={sortable.setActivatorNodeRef}
          type="button"
          className={styles.dragHandleButton}
          aria-label={`Drag category ${category.name}`}
          disabled={isDragDisabled}
          draggable={!isDragDisabled}
          onDragStart={(event) => onNativeDragStart(event, category.id)}
          onDragEnd={onNativeDragEnd}
          {...(isDragDisabled ? {} : sortable.attributes)}
          {...(isDragDisabled ? {} : sortable.listeners)}
          onClick={(event) => event.stopPropagation()}
        >
          ⋮⋮
        </button>

        <button
          type="button"
          className={styles.categorySummaryButton}
          aria-label={`Select category ${category.name}`}
          onClick={() => onSelectCategory(category.id)}
        >
          <span className={styles.rowTitle}>{category.name}</span>
          <span className={styles.rowMeta}>
            {category.subcategories.length} subcategories • {tagCount} tags
          </span>
        </button>

        <div className={styles.rowActions}>
          <button
            type="button"
            className={`${styles.secondaryButtonSmall} ${styles.rowActionIconButton}`}
            aria-label={`Rename category ${category.name}`}
            title={`Rename ${category.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onRenameCategory(category.id);
            }}
          >
            <Pencil size={17} strokeWidth={2.25} />
          </button>
          <button
            type="button"
            className={`${styles.dangerButtonSmall} ${styles.rowActionIconButton}`}
            aria-label={`Delete category ${category.name}`}
            title={`Delete ${category.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onDeleteCategory(category.id);
            }}
          >
            <Trash2 size={17} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      {isExpanded ? <div className={styles.subcategoryList}>{children}</div> : null}
    </div>
  );
}

function SortableSubcategoryRow({
  categoryId,
  parentId,
  subcategoryId,
  name,
  tagCount,
  childFolderCount,
  isExpanded,
  isSelected,
  isDragDisabled,
  isTagDropActive,
  onToggleExpanded,
  onSelectSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
  onNativeDragStart,
  onNativeDragOver,
  onNativeDrop,
  onNativeDragEnd,
}: SortableSubcategoryRowProps) {
  const sortable = useSortable({
    id: buildSubcategoryDndId(subcategoryId),
    disabled: isDragDisabled,
    data: {
      type: "subcategory",
      categoryId,
      parentId,
      subcategoryId,
      label: name,
    } as SubcategoryDragData,
  });

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      draggable={!isDragDisabled}
      onDragStart={(event) =>
        onNativeDragStart(event, categoryId, parentId, subcategoryId)
      }
      onDragOver={onNativeDragOver}
      onDrop={(event) =>
        onNativeDrop(event, categoryId, parentId, subcategoryId)
      }
      onDragEnd={onNativeDragEnd}
      className={`${styles.subcategoryRow} ${
        isSelected ? styles.subcategoryRowSelected : ""
      } ${sortable.isDragging ? styles.sortableDragging : ""} ${
        isTagDropActive ? styles.dropTargetActive : ""
      }`}
    >
      <button
        type="button"
        className={styles.expandButton}
        aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
        disabled={childFolderCount === 0}
        onClick={(event) => {
          event.stopPropagation();
          onToggleExpanded(subcategoryId);
        }}
      >
        {childFolderCount > 0 ? (isExpanded ? "▾" : "▸") : ""}
      </button>

        <button
          ref={sortable.setActivatorNodeRef}
          type="button"
          className={styles.dragHandleButton}
          aria-label={`Drag subcategory ${name}`}
        disabled={isDragDisabled}
        draggable={!isDragDisabled}
        onDragStart={(event) =>
          onNativeDragStart(event, categoryId, parentId, subcategoryId)
        }
        onDragEnd={onNativeDragEnd}
        {...(isDragDisabled ? {} : sortable.attributes)}
        {...(isDragDisabled ? {} : sortable.listeners)}
        onClick={(event) => event.stopPropagation()}
      >
        ⋮⋮
      </button>

      <button
        type="button"
        className={styles.subcategorySummaryButton}
        aria-label={`Select subcategory ${name}`}
        onClick={() => onSelectSubcategory(categoryId, subcategoryId)}
      >
        <span className={styles.rowTitle}>{name}</span>
        <span className={styles.rowMeta}>{tagCount} tags</span>
      </button>

      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${styles.secondaryButtonSmall} ${styles.rowActionIconButton}`}
          aria-label={`Rename subcategory ${name}`}
          title={`Rename ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRenameSubcategory(categoryId, subcategoryId);
          }}
        >
          <Pencil size={17} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          className={`${styles.dangerButtonSmall} ${styles.rowActionIconButton}`}
          aria-label={`Delete subcategory ${name}`}
          title={`Delete ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onDeleteSubcategory(categoryId, subcategoryId);
          }}
        >
          <Trash2 size={17} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

function SortableTagRow({
  categoryId,
  subcategoryId,
  tag,
  isDragDisabled,
  isDropActive,
  isAccentPickerOpen,
  customAccentsById,
  accentGroups,
  onRenameTag,
  onDeleteTag,
  onToggleAccentPicker,
  onSetTagAccent,
  onNativeDragStart,
  onNativeDragOver,
  onNativeDrop,
  onNativeDragEnd,
}: SortableTagRowProps) {
  const sortable = useSortable({
    id: buildTagDndId(tag.id),
    disabled: isDragDisabled,
    data: {
      type: "tag",
      categoryId,
      subcategoryId,
      tagId: tag.id,
      label: tag.name,
    } as TagDragData,
  });

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const draggableProps = isDragDisabled
    ? { "aria-disabled": true }
    : { ...sortable.attributes, ...sortable.listeners };
  const stopActionEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };
  const accentId = tag.accentId ?? null;
  const mergedStyle = accentId
    ? { ...style, ...buildTagAccentCssVars(accentId, customAccentsById) }
    : style;

  return (
    <div
      ref={sortable.setNodeRef}
      style={mergedStyle}
      className={`${styles.tagChip} ${accentId ? styles.tagChipAccented : ""} ${
        sortable.isDragging ? styles.sortableDragging : ""
      } ${
        isDragDisabled ? styles.tagChipDragDisabled : ""
      } ${
        isDropActive ? styles.dropTargetActive : ""
      }`}
      draggable={!isDragDisabled}
      onDragStart={(event) =>
        onNativeDragStart(event, categoryId, subcategoryId, tag.id)
      }
      onDragOver={onNativeDragOver}
      onDrop={(event) =>
        onNativeDrop(event, categoryId, subcategoryId, tag.id)
      }
      onDragEnd={onNativeDragEnd}
      data-accented={accentId ? "true" : "false"}
      data-accent-picker-open={isAccentPickerOpen ? "true" : "false"}
      data-tag-accent-menu-root="true"
      {...draggableProps}
    >
      <span className={styles.tagChipGrip} aria-hidden="true">
        <GripVertical size={14} />
      </span>
      <span className={styles.tagChipLabel} title={tag.name}>
        {tag.name}
      </span>
      <div className={styles.tagChipActions}>
        <button
          type="button"
          className={`${styles.tagChipActionButton} ${styles.tagChipAccentButton}`}
          aria-label={
            accentId
              ? `Change accent for tag ${tag.name}`
              : `Add accent to tag ${tag.name}`
          }
          title={accentId ? "Change accent" : "Add accent"}
          onPointerDown={stopActionEvent}
          onClick={(event) => {
            stopActionEvent(event);
            onToggleAccentPicker(tag.id);
          }}
        >
          <span
            className={`${styles.tagChipAccentPreview} ${
              accentId ? styles.tagChipAccentPreviewFilled : styles.tagChipAccentPreviewEmpty
            }`}
            style={buildTagAccentCssVars(accentId, customAccentsById)}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className={styles.tagChipActionButton}
          aria-label={`Rename tag ${tag.name}`}
          onPointerDown={stopActionEvent}
          onClick={(event) => {
            stopActionEvent(event);
            onRenameTag(subcategoryId, tag.id);
          }}
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className={`${styles.tagChipActionButton} ${styles.tagChipDeleteButton}`}
          aria-label={`Delete tag ${tag.name}`}
          onPointerDown={stopActionEvent}
          onClick={(event) => {
            stopActionEvent(event);
            onDeleteTag(subcategoryId, tag.id);
          }}
        >
          <Trash2 size={12} />
        </button>
        {isAccentPickerOpen ? (
          <div
            className={styles.tagAccentMenu}
            onPointerDown={stopActionEvent}
            onClick={stopActionEvent}
          >
            {accentGroups.map((group) => (
              <div key={group.label} className={styles.tagAccentGroup} role="group" aria-label={`${group.label} colors`}>
                <div className={styles.tagAccentGroupLabel}>{group.label}</div>
                <div className={styles.tagAccentSwatches}>
                  {group.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.tagAccentSwatch} ${
                        accentId === option.value ? styles.tagAccentSwatchActive : ""
                      }`}
                      aria-label={`Set ${option.label} accent on tag ${tag.name}`}
                      title={option.label}
                      style={buildTagAccentCssVars(option.value, customAccentsById)}
                      onClick={(event) => {
                        stopActionEvent(event);
                        onSetTagAccent(tag.id, option.value);
                      }}
                    >
                      <span className={styles.tagAccentSwatchDot} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              className={styles.tagAccentClearButton}
              onClick={(event) => {
                stopActionEvent(event);
                onSetTagAccent(tag.id, null);
              }}
            >
              Clear accent
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TagEndDropZone({
  subcategoryId,
  isVisible,
  isDropActive,
  onNativeDragOver,
  onNativeDrop,
}: TagEndDropZoneProps) {
  const droppable = useDroppable({
    id: buildTagEndDndId(subcategoryId),
    data: {
      type: "tag-end",
      subcategoryId,
    } as TagEndDragData,
  });

  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={droppable.setNodeRef}
      className={`${styles.tagEndDropZone} ${
        droppable.isOver || isDropActive ? styles.dropTargetActive : ""
      }`}
      onDragOver={onNativeDragOver}
      onDrop={(event) => onNativeDrop(event, subcategoryId)}
    >
      Drop here to place at the end
    </div>
  );
}

function CommunityDestinationFolder({
  categoryId,
  subcategory,
  selectedSubcategoryId,
  onSelectSubcategory,
}: {
  categoryId: string;
  subcategory: TagSubcategory;
  selectedSubcategoryId: string | null;
  onSelectSubcategory: (categoryId: string, subcategoryId: string) => void;
}) {
  const isSelected = selectedSubcategoryId === subcategory.id;

  return (
    <div className={styles.communityDestinationCategory}>
      <button
        type="button"
        className={`${styles.communityDestinationButton} ${styles.communityDestinationSubfolderButton} ${isSelected ? styles.communityDestinationButtonActive : ""}`}
        onClick={() => onSelectSubcategory(categoryId, subcategory.id)}
        aria-pressed={isSelected}
      >
        <span>{subcategory.name}</span>
        <small>{getSubcategoryTagCount(subcategory)} tags</small>
      </button>
      {subcategory.subcategories && subcategory.subcategories.length > 0 ? (
        <div className={styles.communityDestinationSubfolders}>
          {subcategory.subcategories.map((child) => (
            <CommunityDestinationFolder
              key={child.id}
              categoryId={categoryId}
              subcategory={child}
              selectedSubcategoryId={selectedSubcategoryId}
              onSelectSubcategory={onSelectSubcategory}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TagManager: React.FC<TagManagerProps> = ({
  taxonomy,
  tracks,
  playlists,
  artists,
  activeTagFilters,
  excludedTagFilters,
  smartPlaylists,
  initialExpandedCategoryIds,
  onExpandedCategoryIdsChange,
  initialSelectedSubcategoryId,
  onSelectedSubcategoryIdChange,
  onClose,
  onReplaceTaxonomy,
}) => {
  const [localTaxonomy, setLocalTaxonomy] = useState<TagTaxonomy>(() =>
    cloneTaxonomy({ ...taxonomy, ...normalizeColorLibrary(taxonomy) }),
  );
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [notification, setNotification] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string | null>(
    () => initialSelectedSubcategoryId ?? null,
  );
  const [categoryOnlySelectionId, setCategoryOnlySelectionId] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(
    () => initialExpandedCategoryIds ?? [],
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [newTagName, setNewTagName] = useState<string>("");
  const [renameTarget, setRenameTarget] = useState<
    | { kind: "category"; id: string; name: string }
    | { kind: "folder"; id: string; parentId: string; name: string }
    | { kind: "tag"; id: string; parentId: string; name: string }
    | null
  >(null);
  const [renameValue, setRenameValue] = useState("");
  const [communitySearchQuery, setCommunitySearchQuery] = useState<string>("");
  const [communitySortMode, setCommunitySortMode] =
    useState<CommunityCatalogSortMode>("contributors");
  const [communitySortDirection, setCommunitySortDirection] =
    useState<CommunityCatalogSortDirection>("descending");
  const [communityMinTrackCount, setCommunityMinTrackCount] = useState(1);
  const [communityTags, setCommunityTags] = useState<CommunityCatalogTag[]>([]);
  const [isLoadingCommunityTags, setIsLoadingCommunityTags] = useState(false);
  const [communityTagsError, setCommunityTagsError] = useState<string | null>(null);
  const [importingCommunityTagKey, setImportingCommunityTagKey] = useState<string | null>(null);
  const [newCustomAccentName, setNewCustomAccentName] = useState<string>("");
  const [newCustomAccentColor, setNewCustomAccentColor] =
    useState<string>("#7c9cff");
  const [newCustomAccentThemeId, setNewCustomAccentThemeId] = useState("");
  const [activeView, setActiveView] = useState<TagManagerView>("tags");
  const [isAddingCustomAccent, setIsAddingCustomAccent] = useState(false);
  const [editingCustomAccentId, setEditingCustomAccentId] = useState<`custom:${string}` | null>(null);
  const [editingCustomAccentName, setEditingCustomAccentName] = useState("");
  const [editingCustomAccentColor, setEditingCustomAccentColor] = useState("#7c9cff");
  const [editingCustomAccentThemeId, setEditingCustomAccentThemeId] = useState("");
  const [selectedColorThemeId, setSelectedColorThemeId] = useState<string | null>(null);
  const [colorLibrarySortMode, setColorLibrarySortMode] = useLocalStorage<ColorLibrarySortMode>(
    COLOR_LIBRARY_SORT_STORAGE_KEY,
    "alphabetical",
  );
  const [draggedColorId, setDraggedColorId] = useState<`custom:${string}` | null>(null);
  const [draggedThemeId, setDraggedThemeId] = useState<string | null>(null);
  const [showDefaultPalette, setShowDefaultPalette] = useLocalStorage(
    SHOW_DEFAULT_PALETTE_STORAGE_KEY,
    true,
  );
  const [pendingDeleteColorThemeId, setPendingDeleteColorThemeId] = useState<string | null>(null);
  const colorImportRef = useRef<HTMLInputElement | null>(null);
  const [openAccentPickerTagId, setOpenAccentPickerTagId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [nativeTaxonomyDragState, setNativeTaxonomyDragState] =
    useState<NativeTaxonomyDragState | null>(null);
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null);
  const [hoveredSubcategoryId, setHoveredSubcategoryId] = useState<string | null>(null);

  const hoverExpandTimerRef = useRef<number | null>(null);
  const hoverExpandCategoryIdRef = useRef<string | null>(null);
  const communityTagsRequestRef = useRef<Promise<CommunityCatalogTag[]> | null>(null);
  const treePaneRef = useRef<HTMLDivElement | null>(null);
  const dragPlacementRef = useRef<RelativeDropPlacement>("before");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const localCategories = useMemo(
    () => buildCategoryTree(localTaxonomy),
    [localTaxonomy],
  );

  const filteredCategories = useMemo(
    () => filterCategoryTree(localCategories, searchQuery),
    [localCategories, searchQuery],
  );

  const expandableTaxonomyIds = useMemo(() => {
    const ids: string[] = [];
    const appendFolderIds = (subcategories: TagSubcategory[]) => {
      subcategories.forEach((subcategory) => {
        ids.push(subcategory.id);
        appendFolderIds(subcategory.subcategories || []);
      });
    };

    localCategories.forEach((category) => {
      ids.push(category.id);
      appendFolderIds(category.subcategories);
    });

    return ids;
  }, [localCategories]);

  const selectedCategory = selectedCategoryId
    ? localTaxonomy.categoriesById[selectedCategoryId]
    : null;
  const selectedSubcategory = selectedSubcategoryId
    ? localTaxonomy.subcategoriesById[selectedSubcategoryId]
    : null;

  const selectedFolderPath = useMemo(() => {
    const folders: TaxonomyFolder[] = [];
    const seen = new Set<string>();
    let folder = selectedSubcategory;
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      folders.unshift(folder);
      folder = localTaxonomy.subcategoriesById[folder.parentId || ""];
    }
    return folders;
  }, [localTaxonomy.subcategoriesById, selectedSubcategory]);
  const pathRootId = selectedFolderPath[0]?.parentId;
  const selectedRootId = pathRootId && localTaxonomy.categoriesById[pathRootId]
    ? pathRootId
    : selectedSubcategory?.categoryId;
  const selectedCategoryForInspector = selectedSubcategory
    ? localTaxonomy.categoriesById[selectedRootId || ""]
    : selectedCategory;
  const selectedTagParentId = selectedSubcategory?.id ?? selectedCategory?.id ?? null;
  const selectedTagParentName = selectedSubcategory?.name ?? selectedCategory?.name ?? null;
  const selectedTagParentIsCategory = Boolean(selectedTagParentId && localTaxonomy.categoriesById[selectedTagParentId]);

  const selectedTags = useMemo(() => {
    if (!selectedTagParentId) {
      return [];
    }

    const tagIds = (localTaxonomy.childrenByParentId?.[selectedTagParentId] || [])
      .filter((childId) => Boolean(localTaxonomy.tagsById[childId]));
    const fallbackTagIds = selectedSubcategory?.tagIds || [];
    return (tagIds.length ? tagIds : fallbackTagIds)
      .map((tagId) => localTaxonomy.tagsById[tagId])
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        accentId: tag.accentId ?? null,
      }));
  }, [localTaxonomy.childrenByParentId, localTaxonomy.tagsById, selectedSubcategory?.tagIds, selectedTagParentId]);
  const accentOptions = useMemo(
    () => getTagAccentOptions(localTaxonomy.customAccentsById),
    [localTaxonomy.customAccentsById],
  );
  const colorThemes = useMemo(
    () => getOrderedColorThemes(localTaxonomy, colorLibrarySortMode),
    [colorLibrarySortMode, localTaxonomy],
  );
  const accentGroups = useMemo<TagAccentGroup[]>(() => {
    const defaultOptions = showDefaultPalette
      ? accentOptions.filter((option) => !option.isCustom)
      : [];
    const customOptionsById = new Map(
      accentOptions.filter((option) => option.isCustom).map((option) => [option.value, option]),
    );
    const assignedCustomIds = new Set<string>();
    const collectionGroups = colorThemes.flatMap((theme) => {
      const options = getOrderedCustomColors(localTaxonomy, theme.colorIds, colorLibrarySortMode)
        .map((color) => customOptionsById.get(color.id))
        .filter((option): option is TagAccentOption => Boolean(option));
      options.forEach((option) => assignedCustomIds.add(option.value));
      return options.length > 0 ? [{ label: theme.name, options }] : [];
    });
    const ungroupedOptions = getOrderedCustomColors(localTaxonomy, localTaxonomy.ungroupedColorIds, colorLibrarySortMode)
      .map((color) => customOptionsById.get(color.id))
      .filter((option): option is TagAccentOption => option !== undefined && !assignedCustomIds.has(option.value));

    return [
      ...(defaultOptions.length > 0 ? [{ label: "Default", options: defaultOptions }] : []),
      ...collectionGroups,
      ...(ungroupedOptions.length > 0 ? [{ label: "Ungrouped", options: ungroupedOptions }] : []),
    ];
  }, [accentOptions, colorLibrarySortMode, colorThemes, localTaxonomy, showDefaultPalette]);
  const selectedColorTheme = selectedColorThemeId && selectedColorThemeId !== UNGROUPED_COLOR_FILTER
    ? localTaxonomy.colorThemesById?.[selectedColorThemeId]
    : null;
  const pendingDeleteColorTheme = pendingDeleteColorThemeId
    ? localTaxonomy.colorThemesById[pendingDeleteColorThemeId]
    : null;
  const allCustomAccents = useMemo(
    () => {
      const customOrder = [
        ...getOrderedColorThemes(localTaxonomy, "custom").flatMap((theme) => theme.colorIds),
        ...localTaxonomy.ungroupedColorIds,
      ];
      const listed = new Set(customOrder);
      Object.keys(localTaxonomy.customAccentsById).forEach((id) => {
        if (!listed.has(id as `custom:${string}`)) customOrder.push(id as `custom:${string}`);
      });
      return getOrderedCustomColors(localTaxonomy, customOrder, colorLibrarySortMode);
    },
    [colorLibrarySortMode, localTaxonomy],
  );
  const customAccents = useMemo(() => {
    if (selectedColorTheme) {
      return getOrderedCustomColors(localTaxonomy, selectedColorTheme.colorIds, colorLibrarySortMode);
    }
    if (selectedColorThemeId === UNGROUPED_COLOR_FILTER) {
      return getOrderedCustomColors(localTaxonomy, localTaxonomy.ungroupedColorIds, colorLibrarySortMode);
    }
    return allCustomAccents;
  }, [allCustomAccents, colorLibrarySortMode, localTaxonomy, selectedColorTheme, selectedColorThemeId]);

  const visibleCommunityTags = useMemo(() => {
    const normalizedQuery = normalizeName(communitySearchQuery);
    const tags = communityTags.filter((tag) => {
      return (
        normalizeName(tag.name).includes(normalizedQuery) &&
        tag.songCount >= communityMinTrackCount
      );
    });

    return [...tags].sort((left, right) => {
      const nameComparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      let comparison: number;
      if (communitySortMode === "alphabetical") {
        comparison = nameComparison;
      } else if (communitySortMode === "contributors") {
        comparison =
          (right.contributorCount ?? 0) - (left.contributorCount ?? 0) ||
          right.songCount - left.songCount ||
          nameComparison;
      } else if (communitySortMode === "recent") {
        comparison =
          Date.parse(right.lastSeenAt ?? "") - Date.parse(left.lastSeenAt ?? "") ||
          nameComparison;
      } else {
        comparison =
          right.songCount - left.songCount ||
          nameComparison;
      }
      return communitySortDirection === "ascending" ? comparison * -1 : comparison;
    });
  }, [
    communityMinTrackCount,
    communitySearchQuery,
    communitySortDirection,
    communitySortMode,
    communityTags,
  ]);

  const communityDestinationPath = selectedCategoryForInspector
    ? `${selectedCategoryForInspector.name}${selectedSubcategory ? ` / ${selectedSubcategory.name}` : ""}`
    : "No category selected";

  const canMoveColorToTheme = (colorId: `custom:${string}`, targetThemeId: string) => {
    const sourceColor = localTaxonomy.customAccentsById[colorId];
    if (!sourceColor || !localTaxonomy.colorThemesById[targetThemeId]) return false;
    return sourceColor.themeId !== targetThemeId || colorLibrarySortMode === "custom";
  };

  const moveColorToTheme = (colorId: `custom:${string}`, targetThemeId: string, beforeColorId?: `custom:${string}`) => {
    if (!canMoveColorToTheme(colorId, targetThemeId)) return;
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    const sourceThemeId = nextTaxonomy.customAccentsById[colorId].themeId;
    nextTaxonomy.ungroupedColorIds = nextTaxonomy.ungroupedColorIds.filter((id) => id !== colorId);
    Object.values(nextTaxonomy.colorThemesById).forEach((theme) => {
      theme.colorIds = theme.colorIds.filter((id) => id !== colorId);
    });
    const targetIds = nextTaxonomy.colorThemesById[targetThemeId].colorIds;
    const targetIndex = beforeColorId ? targetIds.indexOf(beforeColorId) : -1;
    targetIds.splice(targetIndex < 0 ? targetIds.length : targetIndex, 0, colorId);
    nextTaxonomy.customAccentsById[colorId].themeId = targetThemeId;
    if (sourceThemeId !== targetThemeId) nextTaxonomy.customAccentsById[colorId].updatedAt = Date.now();
    nextTaxonomy.colorThemesById[targetThemeId].updatedAt = Date.now();
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const reorderColorThemes = (sourceThemeId: string, targetThemeId: string) => {
    if (sourceThemeId === targetThemeId || colorLibrarySortMode !== "custom") return;
    const order = getOrderedColorThemes(localTaxonomy, "custom").map((theme) => theme.id);
    const sourceIndex = order.indexOf(sourceThemeId);
    const targetIndex = order.indexOf(targetThemeId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    order.splice(sourceIndex, 1);
    order.splice(targetIndex, 0, sourceThemeId);
    commitTaxonomyUpdate({ ...cloneTaxonomy(localTaxonomy), colorThemeOrder: order });
  };

  const getDuplicateColorMessage = (
    color: string,
    excludedAccentId?: `custom:${string}`,
  ): string | null => {
    const normalizedColor = color.toLowerCase();
    const displayColor = color.toUpperCase();
    const customConflict = allCustomAccents.find(
      (accent) => accent.id !== excludedAccentId && accent.color.toLowerCase() === normalizedColor,
    );

    if (customConflict) {
      const collectionName = customConflict.themeId
        ? localTaxonomy.colorThemesById[customConflict.themeId]?.name
        : null;
      const location = collectionName
        ? `the "${collectionName}" collection`
        : "Ungrouped";
      return `${displayColor} is already used by "${customConflict.name}" in ${location}. Use "${customConflict.name}" instead or choose a different color value.`;
    }

    const presetConflict = TAG_ACCENT_PRESET_OPTIONS.find(
      (option) => getTagAccentTokens(option.value)?.dot.toLowerCase() === normalizedColor,
    );
    if (presetConflict) {
      return `${displayColor} is already the built-in "${presetConflict.label}" color. Use ${presetConflict.label} instead or choose a different color value.`;
    }

    return null;
  };

  const interactionLocked = searchQuery.trim().length > 0;
  const areAllCategoriesExpanded =
    expandableTaxonomyIds.length > 0 &&
    expandableTaxonomyIds.every((nodeId) =>
      expandedCategories.includes(nodeId),
    );

  const clearHoverExpandTimer = useCallback(() => {
    if (hoverExpandTimerRef.current !== null) {
      window.clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }

    hoverExpandCategoryIdRef.current = null;
  }, []);

  const showModalNotification = useCallback((message: string, isError = false) => {
    setNotification({ message, isError });
    window.setTimeout(() => {
      setNotification((currentNotification) =>
        currentNotification?.message === message ? null : currentNotification,
      );
    }, 4000);
  }, []);

  const commitTaxonomyUpdate = useCallback((nextTaxonomy: TagTaxonomy) => {
    setLocalTaxonomy(nextTaxonomy);
    setHasChanges(true);
    setOpenAccentPickerTagId(null);
  }, []);

  const applyMoveResult = useCallback(
    (result: TaxonomyMoveResult, errorMessage: string) => {
      if (result.status === "applied") {
        commitTaxonomyUpdate(result.taxonomy);
        return true;
      }

      if (result.status === "blocked" && errorMessage) {
        showModalNotification(errorMessage, true);
      }

      return false;
    },
    [commitTaxonomyUpdate, showModalNotification],
  );

  const getMoveReason = (result: TaxonomyMoveResult): TaxonomyMoveReason =>
    result.status === "applied" ? "same-position" : result.reason;

  useEffect(() => {
    setLocalTaxonomy(cloneTaxonomy({ ...taxonomy, ...normalizeColorLibrary(taxonomy) }));
    setHasChanges(false);
  }, [taxonomy]);

  useEffect(() => {
    clearHoverExpandTimer();

    return () => {
      clearHoverExpandTimer();
    };
  }, [clearHoverExpandTimer]);

  useEffect(() => {
    onExpandedCategoryIdsChange?.(expandedCategories);
  }, [expandedCategories, onExpandedCategoryIdsChange]);

  useEffect(() => {
    onSelectedSubcategoryIdChange?.(selectedSubcategoryId);
  }, [onSelectedSubcategoryIdChange, selectedSubcategoryId]);

  useEffect(() => {
    if (
      selectedCategoryId &&
      categoryOnlySelectionId === selectedCategoryId &&
      localTaxonomy.categoriesById[selectedCategoryId]
    ) {
      if (selectedSubcategoryId !== null) {
        setSelectedSubcategoryId(null);
      }
      return;
    }

    if (selectedSubcategoryId && localTaxonomy.subcategoriesById[selectedSubcategoryId]) {
      const nextCategoryId =
        localTaxonomy.subcategoriesById[selectedSubcategoryId].categoryId;
      if (!nextCategoryId) {
        return;
      }

      setSelectedCategoryId(nextCategoryId);
      setCategoryOnlySelectionId(null);
      if (initialExpandedCategoryIds === undefined) {
        setExpandedCategories((currentExpanded) =>
          currentExpanded.includes(nextCategoryId)
            ? currentExpanded
            : [...currentExpanded, nextCategoryId],
        );
      }
      return;
    }

    if (
      selectedCategoryId &&
      categoryOnlySelectionId !== selectedCategoryId &&
      localTaxonomy.categoriesById[selectedCategoryId] &&
      localTaxonomy.categoriesById[selectedCategoryId].subcategoryIds.length > 0
    ) {
      setSelectedSubcategoryId(
        localTaxonomy.categoriesById[selectedCategoryId].subcategoryIds[0],
      );
      return;
    }

    const firstCategoryId = localTaxonomy.categoryOrder[0] ?? null;
    const firstSubcategoryId = firstCategoryId
      ? localTaxonomy.categoriesById[firstCategoryId]?.subcategoryIds[0] ?? null
      : null;

    setSelectedCategoryId(firstCategoryId);
    setSelectedSubcategoryId(firstSubcategoryId);
    setCategoryOnlySelectionId(null);
    if (initialExpandedCategoryIds === undefined) {
      setExpandedCategories(firstCategoryId ? [firstCategoryId] : []);
    }
  }, [
    initialExpandedCategoryIds,
    categoryOnlySelectionId,
    localTaxonomy,
    selectedCategoryId,
    selectedSubcategoryId,
  ]);

  useEffect(() => {
    if (activeView !== "community" || communityTags.length > 0) {
      return;
    }

    setIsLoadingCommunityTags(true);
    setCommunityTagsError(null);

    const tagsRequest = communityTagsRequestRef.current ?? loadCommunityCatalogTags();
    communityTagsRequestRef.current = tagsRequest;

    tagsRequest
      .then((tags) => {
        setCommunityTags(tags);
      })
      .catch((error) => {
        console.error("Failed to load community tags", error);
        setCommunityTagsError("Community tags could not be loaded. Check your Spotify console for the request error.");
        communityTagsRequestRef.current = null;
      })
      .finally(() => {
        setIsLoadingCommunityTags(false);
      });
  }, [activeView, communityTags.length]);

  const isCategoryNameUnique = useCallback(
    (name: string, excludeCategoryId?: string) => {
      const normalizedName = normalizeName(name);
      return !localTaxonomy.categoryOrder
        .filter((categoryId) => categoryId !== excludeCategoryId)
        .some(
          (categoryId) =>
            normalizeName(localTaxonomy.categoriesById[categoryId]?.name || "") ===
            normalizedName,
        );
    },
    [localTaxonomy],
  );

  const isSubcategoryNameUnique = useCallback(
    (categoryId: string, name: string, excludeSubcategoryId?: string) => {
      const normalizedName = normalizeName(name);
      const childIds = localTaxonomy.childrenByParentId?.[categoryId] || localTaxonomy.categoriesById[categoryId]?.subcategoryIds || [];

      return !childIds
        .filter((childId) => childId !== excludeSubcategoryId)
        .some(
          (childId) =>
            normalizeName(localTaxonomy.subcategoriesById[childId]?.name || localTaxonomy.tagsById[childId]?.name || "") ===
            normalizedName,
        );
    },
    [localTaxonomy],
  );

  const isTagNameUnique = useCallback(
    (parentId: string, name: string, excludeTagId?: string) => {
      const normalizedName = normalizeName(name);
      const childIds = localTaxonomy.childrenByParentId?.[parentId]
        || localTaxonomy.subcategoriesById[parentId]?.tagIds
        || [];

      return !childIds
        .filter((tagId) => tagId !== excludeTagId)
        .some(
          (tagId) =>
            normalizeName(localTaxonomy.tagsById[tagId]?.name || "") === normalizedName,
        );
    },
    [localTaxonomy],
  );

  const selectCategory = useCallback((categoryId: string) => {
    const category = localTaxonomy.categoriesById[categoryId];
    if (!category) {
      return;
    }

    setSelectedCategoryId(categoryId);
    setCategoryOnlySelectionId(categoryId);
    setExpandedCategories((currentExpanded) =>
      currentExpanded.includes(categoryId)
        ? currentExpanded
        : [...currentExpanded, categoryId],
    );

    setSelectedSubcategoryId(null);
  }, [localTaxonomy]);

  const selectSubcategory = useCallback(
    (categoryId: string, subcategoryId: string) => {
      setSelectedCategoryId(categoryId);
      setSelectedSubcategoryId(subcategoryId);
      setCategoryOnlySelectionId(null);
      setExpandedCategories((currentExpanded) =>
        currentExpanded.includes(categoryId)
          ? currentExpanded
          : [...currentExpanded, categoryId],
      );
    },
    [],
  );

  const toggleTaxonomyNodeExpanded = useCallback((nodeId: string) => {
    setExpandedCategories((currentExpanded) =>
      currentExpanded.includes(nodeId)
        ? currentExpanded.filter((id) => id !== nodeId)
        : [...currentExpanded, nodeId],
    );
  }, []);

  const handleAddCategory = () => {
    const name = promptForName("Enter new category name:");

    if (!name) {
      return;
    }

    if (name.length > MAX_NAME_LENGTH) {
      showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
      return;
    }

    if (UNSUPPORTED_NAME_CHARACTERS.test(name)) {
      showModalNotification(UNSUPPORTED_NAME_MESSAGE, true);
      return;
    }

    if (!isCategoryNameUnique(name)) {
      showModalNotification(`Category "${name}" already exists.`, true);
      return;
    }

    const categoryId = createEntityId("cat");
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.categoryOrder.push(categoryId);
    nextTaxonomy.categoriesById[categoryId] = {
      id: categoryId,
      name,
      subcategoryIds: [],
      childIds: [],
    };
    nextTaxonomy.childrenByParentId ||= {};
    nextTaxonomy.childrenByParentId[categoryId] = [];

    commitTaxonomyUpdate(nextTaxonomy);
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId(null);
    setExpandedCategories((currentExpanded) => [...currentExpanded, categoryId]);
  };

  const handleAddSubcategory = (parentId: string, categoryId = parentId) => {
    const parentCategory = localTaxonomy.categoriesById[parentId];
    const parentFolder = localTaxonomy.subcategoriesById[parentId];
    if (!parentCategory && !parentFolder) {
      return;
    }

    const name = promptForName("Enter new folder name:");
    if (!name) {
      return;
    }

    if (name.length > MAX_NAME_LENGTH) {
      showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
      return;
    }

    if (UNSUPPORTED_NAME_CHARACTERS.test(name)) {
      showModalNotification(UNSUPPORTED_NAME_MESSAGE, true);
      return;
    }

    if (!isSubcategoryNameUnique(parentId, name)) {
      showModalNotification(`Folder "${name}" already exists here.`, true);
      return;
    }

    const subcategoryId = createEntityId("sub");
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.childrenByParentId ||= {};
    if (nextTaxonomy.categoriesById[parentId]) {
      nextTaxonomy.categoriesById[parentId].subcategoryIds.push(subcategoryId);
      nextTaxonomy.categoriesById[parentId].childIds = [...(nextTaxonomy.categoriesById[parentId].childIds || []), subcategoryId];
    }
    if (nextTaxonomy.subcategoriesById[parentId]) {
      nextTaxonomy.subcategoriesById[parentId].childIds = [...(nextTaxonomy.subcategoriesById[parentId].childIds || []), subcategoryId];
    }
    nextTaxonomy.childrenByParentId[parentId] = [...(nextTaxonomy.childrenByParentId[parentId] || []), subcategoryId];
    nextTaxonomy.subcategoriesById[subcategoryId] = {
      id: subcategoryId,
      name,
      parentId,
      categoryId,
      tagIds: [],
      childIds: [],
    };
    nextTaxonomy.foldersById ||= {};
    nextTaxonomy.foldersById[subcategoryId] = nextTaxonomy.subcategoriesById[subcategoryId];
    nextTaxonomy.childrenByParentId[subcategoryId] = [];

    commitTaxonomyUpdate(nextTaxonomy);
    setExpandedCategories((currentExpanded) =>
      [categoryId, parentId].reduce(
        (nextExpanded, nodeId) =>
          nextExpanded.includes(nodeId) ? nextExpanded : [...nextExpanded, nodeId],
        currentExpanded,
      ),
    );
    selectSubcategory(categoryId, subcategoryId);
  };

  const handleAddTag = () => {
    if (!selectedTagParentId || !selectedCategoryForInspector) {
      showModalNotification("Select a category or folder before adding a tag.", true);
      return;
    }

    const name = newTagName.trim();
    if (!name) {
      return;
    }

    if (name.length > MAX_NAME_LENGTH) {
      showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
      return;
    }

    if (UNSUPPORTED_NAME_CHARACTERS.test(name)) {
      showModalNotification(UNSUPPORTED_NAME_MESSAGE, true);
      return;
    }

    if (!isTagNameUnique(selectedTagParentId, name)) {
      showModalNotification(`Tag "${name}" already exists in this folder.`, true);
      return;
    }

    const tagId = createEntityId("tag");
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.childrenByParentId ||= {};
    nextTaxonomy.childrenByParentId[selectedTagParentId] = [...(nextTaxonomy.childrenByParentId[selectedTagParentId] || []), tagId];
    if (nextTaxonomy.subcategoriesById[selectedTagParentId]) {
      nextTaxonomy.subcategoriesById[selectedTagParentId].tagIds.push(tagId);
      nextTaxonomy.subcategoriesById[selectedTagParentId].childIds = [...(nextTaxonomy.subcategoriesById[selectedTagParentId].childIds || []), tagId];
    }
    if (nextTaxonomy.categoriesById[selectedTagParentId]) {
      nextTaxonomy.categoriesById[selectedTagParentId].childIds = [...(nextTaxonomy.categoriesById[selectedTagParentId].childIds || []), tagId];
    }
    nextTaxonomy.tagsById[tagId] = {
      id: tagId,
      name,
      parentId: selectedTagParentId,
      subcategoryId: selectedTagParentId,
      accentId: null,
    };

    commitTaxonomyUpdate(nextTaxonomy);
    setNewTagName("");
  };

  const handleImportCommunityTag = async (tag: CommunityCatalogTag) => {
    const targetCategoryId = selectedCategoryForInspector?.id ?? localTaxonomy.categoryOrder[0];
    if (!targetCategoryId) {
      showModalNotification("Create a category before importing community tags.", true);
      return;
    }

    const targetParentId = selectedSubcategory?.id ?? targetCategoryId;
    const targetChildIds = localTaxonomy.childrenByParentId?.[targetParentId] ?? [];
    const hasLocalDuplicate = targetChildIds.some(
      (tagId) => normalizeName(localTaxonomy.tagsById[tagId]?.name ?? "") === normalizeName(tag.name),
    );
    if (
      hasLocalDuplicate &&
      !window.confirm(`"${tag.name}" already exists in the selected destination. Use the existing tag instead of importing another copy?`)
    ) {
      showModalNotification(`Import cancelled. "${tag.name}" was not added.`);
      return;
    }

    setImportingCommunityTagKey(tag.key);
    try {
      const importPackage: CommunityTagImportPackage = {
        version: 1,
        kind: "tagify-community-tag",
        source: "tagify-community",
        publicTagKey: tag.key,
        name: tag.name,
        normalizedName: tag.key,
        suggestedPaths: [],
        usage: {
          songCount: tag.songCount,
          contributorCount: tag.contributorCount,
          assignmentCount: tag.assignmentCount,
          firstSeenAt: tag.firstSeenAt,
          lastSeenAt: tag.lastSeenAt,
        },
        publicUrl: `${COMMUNITY_TAGS_API_BASE}/tags`,
      };
      const result = importCommunityTagPackage(localTaxonomy, importPackage, {
        targetCategoryId,
        targetSubcategoryId: selectedSubcategory?.id ?? null,
        duplicateMode: "use-existing",
      });

      if (result.status === "blocked") {
        showModalNotification("That community tag could not be imported.", true);
        return;
      }

      commitTaxonomyUpdate(result.taxonomy);
      setSelectedCategoryId(result.categoryId);
      if (localTaxonomy.categoriesById[result.subcategoryId]) {
        setCategoryOnlySelectionId(result.categoryId);
        setSelectedSubcategoryId(null);
      } else {
        setCategoryOnlySelectionId(null);
        setSelectedSubcategoryId(result.subcategoryId);
      }
      setExpandedCategories((currentExpanded) =>
        currentExpanded.includes(result.categoryId)
          ? currentExpanded
          : [...currentExpanded, result.categoryId],
      );
      showModalNotification(
        result.status === "existing"
          ? `"${tag.name}" already exists in the selected destination.`
          : `Imported "${tag.name}" from the community catalog.`,
      );
    } catch {
      showModalNotification("That community tag could not be imported.", true);
    } finally {
      setImportingCommunityTagKey(null);
    }
  };

  const handleRenameCategory = (categoryId: string) => {
    const category = localTaxonomy.categoriesById[categoryId];
    if (!category) return;
    setRenameValue(category.name);
    setRenameTarget({ kind: "category", id: categoryId, name: category.name });
  };

  const handleRenameSubcategory = (categoryId: string, subcategoryId: string) => {
    const subcategory = localTaxonomy.subcategoriesById[subcategoryId];
    if (!subcategory) return;
    setRenameValue(subcategory.name);
    setRenameTarget({ kind: "folder", id: subcategoryId, parentId: subcategory.parentId || categoryId, name: subcategory.name });
  };

  const handleRenameTag = (subcategoryId: string, tagId: string) => {
    const tag = localTaxonomy.tagsById[tagId];
    if (!tag) return;
    setRenameValue(tag.name);
    setRenameTarget({ kind: "tag", id: tagId, parentId: subcategoryId, name: tag.name });
  };

  const confirmRename = () => {
    if (!renameTarget) return;
    const nextName = renameValue.trim();
    if (!nextName) return;
    if (nextName === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    if (nextName.length > MAX_NAME_LENGTH) {
      showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
      return;
    }

    if (UNSUPPORTED_NAME_CHARACTERS.test(nextName)) {
      showModalNotification(UNSUPPORTED_NAME_MESSAGE, true);
      return;
    }
    const isUnique = renameTarget.kind === "category"
      ? isCategoryNameUnique(nextName, renameTarget.id)
      : renameTarget.kind === "folder"
        ? isSubcategoryNameUnique(renameTarget.parentId, nextName, renameTarget.id)
        : isTagNameUnique(renameTarget.parentId, nextName, renameTarget.id);
    if (!isUnique) {
      showModalNotification(`That ${renameTarget.kind} name is already in use here.`, true);
      return;
    }
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    if (renameTarget.kind === "category") nextTaxonomy.categoriesById[renameTarget.id].name = nextName;
    else if (renameTarget.kind === "folder") nextTaxonomy.subcategoriesById[renameTarget.id].name = nextName;
    else nextTaxonomy.tagsById[renameTarget.id].name = nextName;
    commitTaxonomyUpdate(nextTaxonomy);
    setRenameTarget(null);
  };

  const handleRemoveCategory = (categoryId: string) => {
    const category = localTaxonomy.categoriesById[categoryId];
    if (!category) {
      return;
    }

    const affectedTagIds = collectTagIdsForParent(localTaxonomy, categoryId);
    const trackReferenceCount = countTrackReferences(tracks, affectedTagIds);
    const playlistReferenceCount = countEntityReferences(playlists, affectedTagIds);
    const artistReferenceCount = countEntityReferences(artists, affectedTagIds);
    const filterReferenceCount = countSavedFilterReferences(
      activeTagFilters,
      excludedTagFilters,
      affectedTagIds,
    );
    const smartPlaylistReferenceCount = countSmartPlaylistReferences(
      smartPlaylists,
      affectedTagIds,
    );
    const confirmed = window.confirm(
      `Delete category "${category.name}"?\n\n` +
        `This removes ${category.subcategoryIds.length} folders, ${affectedTagIds.length} tags, and ${formatDeletionReferenceSummary(trackReferenceCount, playlistReferenceCount, artistReferenceCount, filterReferenceCount, smartPlaylistReferenceCount)}.`,
    );

    if (!confirmed) {
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.categoryOrder = nextTaxonomy.categoryOrder.filter(
      (existingCategoryId) => existingCategoryId !== categoryId,
    );

    const deleteChildren = (parentId: string) => {
      (nextTaxonomy.childrenByParentId?.[parentId] || []).forEach((childId) => {
        if (nextTaxonomy.tagsById[childId]) {
          delete nextTaxonomy.tagsById[childId];
          return;
        }
        deleteChildren(childId);
        delete nextTaxonomy.subcategoriesById[childId];
        delete nextTaxonomy.foldersById?.[childId];
      });
      delete nextTaxonomy.childrenByParentId?.[parentId];
    };
    deleteChildren(categoryId);

    delete nextTaxonomy.categoriesById[categoryId];
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const handleRemoveSubcategory = (categoryId: string, subcategoryId: string) => {
    const subcategory = localTaxonomy.subcategoriesById[subcategoryId];
    if (!subcategory) {
      return;
    }

    const affectedTagIds = collectTagIdsForParent(localTaxonomy, subcategoryId);
    const trackReferenceCount = countTrackReferences(tracks, affectedTagIds);
    const playlistReferenceCount = countEntityReferences(playlists, affectedTagIds);
    const artistReferenceCount = countEntityReferences(artists, affectedTagIds);
    const filterReferenceCount = countSavedFilterReferences(
      activeTagFilters,
      excludedTagFilters,
      affectedTagIds,
    );
    const smartPlaylistReferenceCount = countSmartPlaylistReferences(
      smartPlaylists,
      affectedTagIds,
    );
    const confirmed = window.confirm(
      `Delete folder "${subcategory.name}"?\n\n` +
        `This removes ${affectedTagIds.length} tags and ${formatDeletionReferenceSummary(trackReferenceCount, playlistReferenceCount, artistReferenceCount, filterReferenceCount, smartPlaylistReferenceCount)}.`,
    );

    if (!confirmed) {
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.categoriesById[categoryId].subcategoryIds =
      nextTaxonomy.categoriesById[categoryId].subcategoryIds.filter(
        (candidateId) => candidateId !== subcategoryId,
      );
    nextTaxonomy.categoriesById[categoryId].childIds =
      (nextTaxonomy.categoriesById[categoryId].childIds || []).filter((candidateId) => candidateId !== subcategoryId);
    nextTaxonomy.childrenByParentId![categoryId] =
      (nextTaxonomy.childrenByParentId![categoryId] || []).filter((candidateId) => candidateId !== subcategoryId);

    const deleteChildren = (parentId: string) => {
      (nextTaxonomy.childrenByParentId?.[parentId] || []).forEach((childId) => {
        if (nextTaxonomy.tagsById[childId]) {
          delete nextTaxonomy.tagsById[childId];
          return;
        }
        deleteChildren(childId);
        delete nextTaxonomy.subcategoriesById[childId];
        delete nextTaxonomy.foldersById?.[childId];
      });
      delete nextTaxonomy.childrenByParentId?.[parentId];
    };
    deleteChildren(subcategoryId);

    delete nextTaxonomy.subcategoriesById[subcategoryId];
    delete nextTaxonomy.foldersById?.[subcategoryId];
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const handleRemoveTag = (subcategoryId: string, tagId: string) => {
    const tag = localTaxonomy.tagsById[tagId];
    if (!tag) {
      return;
    }

    const trackReferenceCount = countTrackReferences(tracks, [tagId]);
    const playlistReferenceCount = countEntityReferences(playlists, [tagId]);
    const artistReferenceCount = countEntityReferences(artists, [tagId]);
    const filterReferenceCount = countSavedFilterReferences(
      activeTagFilters,
      excludedTagFilters,
      [tagId],
    );
    const smartPlaylistReferenceCount = countSmartPlaylistReferences(
      smartPlaylists,
      [tagId],
    );
    const confirmed = window.confirm(
      `Delete tag "${tag.name}"?\n\nThis removes ${formatDeletionReferenceSummary(trackReferenceCount, playlistReferenceCount, artistReferenceCount, filterReferenceCount, smartPlaylistReferenceCount)}.`,
    );

    if (!confirmed) {
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    if (nextTaxonomy.subcategoriesById[subcategoryId]) {
      nextTaxonomy.subcategoriesById[subcategoryId].tagIds =
        nextTaxonomy.subcategoriesById[subcategoryId].tagIds.filter(
          (candidateId) => candidateId !== tagId,
        );
      nextTaxonomy.subcategoriesById[subcategoryId].childIds =
        (nextTaxonomy.subcategoriesById[subcategoryId].childIds || []).filter((candidateId) => candidateId !== tagId);
    }
    if (nextTaxonomy.categoriesById[subcategoryId]) {
      nextTaxonomy.categoriesById[subcategoryId].childIds =
        (nextTaxonomy.categoriesById[subcategoryId].childIds || []).filter((candidateId) => candidateId !== tagId);
    }
    nextTaxonomy.childrenByParentId![subcategoryId] =
      (nextTaxonomy.childrenByParentId![subcategoryId] || []).filter((candidateId) => candidateId !== tagId);
    delete nextTaxonomy.tagsById[tagId];
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const handleToggleAccentPicker = (tagId: string) => {
    setOpenAccentPickerTagId((currentTagId) =>
      currentTagId === tagId ? null : tagId,
    );
  };

  const handleSetTagAccent = (tagId: string, accentId: TagAccentId | null) => {
    const tag = localTaxonomy.tagsById[tagId];
    if (!tag) {
      return;
    }

    const nextAccentId = accentId ?? null;
    if ((tag.accentId ?? null) === nextAccentId) {
      setOpenAccentPickerTagId(null);
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.tagsById[tagId].accentId = nextAccentId;
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const renderSubcategoryTree = (
    categoryId: string,
    subcategory: TagSubcategory,
    parentId: string,
  ): React.ReactNode => {
    const childFolders = subcategory.subcategories || [];
    const isExpanded = interactionLocked || expandedCategories.includes(subcategory.id);

    return (
    <React.Fragment key={subcategory.id}>
      <SortableSubcategoryRow
        categoryId={categoryId}
        parentId={parentId}
        subcategoryId={subcategory.id}
        name={subcategory.name}
        tagCount={getSubcategoryTagCount(subcategory)}
        childFolderCount={childFolders.length}
        isExpanded={isExpanded}
        isSelected={selectedSubcategoryId === subcategory.id}
        isDragDisabled={interactionLocked}
        isTagDropActive={hoveredSubcategoryId === subcategory.id}
        onToggleExpanded={toggleTaxonomyNodeExpanded}
        onSelectSubcategory={selectSubcategory}
        onRenameSubcategory={handleRenameSubcategory}
        onDeleteSubcategory={handleRemoveSubcategory}
        onNativeDragStart={handleNativeSubcategoryDragStart}
        onNativeDragOver={handleNativeTaxonomyDragOver}
        onNativeDrop={handleNativeSubcategoryDrop}
        onNativeDragEnd={clearNativeTaxonomyDrag}
      />
      {isExpanded && childFolders.length > 0 ? (
        <div className={styles.subcategoryList}>
          <SortableContext
            items={childFolders.map((child) =>
              buildSubcategoryDndId(child.id),
            )}
            strategy={verticalListSortingStrategy}
          >
            {childFolders.map((child) =>
              renderSubcategoryTree(categoryId, child, subcategory.id),
            )}
          </SortableContext>
        </div>
      ) : null}
      <button
        type="button"
        className={styles.inlineAddSubcategoryButton}
        onClick={() => handleAddSubcategory(subcategory.id, categoryId)}
      >
        <span className={styles.inlineAddLabel}>+ Add Subfolder</span>
      </button>
    </React.Fragment>
    );
  };

  const handleAddCustomAccent = () => {
    const normalizedName = truncateName(newCustomAccentName.trim(), 32);
    if (!normalizedName) {
      showModalNotification("Give the saved color a name first.", true);
      return;
    }
    if (UNSUPPORTED_NAME_CHARACTERS.test(normalizedName)) {
      showModalNotification(UNSUPPORTED_NAME_MESSAGE, true);
      return;
    }

    if (
      allCustomAccents.some(
        (accent) => normalizeName(accent.name) === normalizeName(normalizedName),
      ) || TAG_ACCENT_PRESET_OPTIONS.some(
        (option) => normalizeName(option.label) === normalizeName(normalizedName),
      )
    ) {
      showModalNotification(`A color named "${normalizedName}" already exists.`, true);
      return;
    }

    const duplicateColorMessage = getDuplicateColorMessage(newCustomAccentColor);
    if (duplicateColorMessage) {
      showModalNotification(duplicateColorMessage, true);
      return;
    }

    const accentId = buildCustomTagAccentId();
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    const now = Date.now();
    nextTaxonomy.customAccentsById[accentId] = {
      id: accentId,
      name: normalizedName,
      color: newCustomAccentColor.toLowerCase(),
      themeId: newCustomAccentThemeId || null,
      createdAt: now,
      updatedAt: now,
    };
    if (newCustomAccentThemeId) {
      nextTaxonomy.colorThemesById[newCustomAccentThemeId].colorIds.push(accentId);
      nextTaxonomy.colorThemesById[newCustomAccentThemeId].updatedAt = Date.now();
    }
    else nextTaxonomy.ungroupedColorIds.push(accentId);
    commitTaxonomyUpdate(nextTaxonomy);
    setNewCustomAccentName("");
    setNewCustomAccentThemeId("");
    setIsAddingCustomAccent(false);
  };

  const handleBeginEditCustomAccent = (accentId: `custom:${string}`) => {
    const accent = localTaxonomy.customAccentsById[accentId];
    if (!accent) return;
    setIsAddingCustomAccent(false);
    setEditingCustomAccentId(accentId);
    setEditingCustomAccentName(accent.name);
    setEditingCustomAccentColor(accent.color);
    setEditingCustomAccentThemeId(accent.themeId ?? "");
  };

  const handleSaveCustomAccent = () => {
    if (!editingCustomAccentId) return;
    const normalizedName = truncateName(editingCustomAccentName.trim(), 32);
    if (!normalizedName) {
      showModalNotification("Give the saved color a name first.", true);
      return;
    }
    if (UNSUPPORTED_NAME_CHARACTERS.test(normalizedName)) {
      showModalNotification(UNSUPPORTED_NAME_MESSAGE, true);
      return;
    }

    if (
      allCustomAccents.some(
        (candidate) =>
          candidate.id !== editingCustomAccentId &&
          normalizeName(candidate.name) === normalizeName(normalizedName),
      ) || TAG_ACCENT_PRESET_OPTIONS.some(
        (option) => normalizeName(option.label) === normalizeName(normalizedName),
      )
    ) {
      showModalNotification(`A color named "${normalizedName}" already exists.`, true);
      return;
    }

    const duplicateColorMessage = getDuplicateColorMessage(editingCustomAccentColor, editingCustomAccentId);
    if (duplicateColorMessage) {
      showModalNotification(duplicateColorMessage, true);
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    const previousThemeId = localTaxonomy.customAccentsById[editingCustomAccentId]?.themeId ?? null;
    const nextThemeId = editingCustomAccentThemeId || null;
    const previousIndex = previousThemeId
      ? localTaxonomy.colorThemesById[previousThemeId]?.colorIds.indexOf(editingCustomAccentId) ?? -1
      : localTaxonomy.ungroupedColorIds.indexOf(editingCustomAccentId);
    nextTaxonomy.ungroupedColorIds = nextTaxonomy.ungroupedColorIds.filter((id) => id !== editingCustomAccentId);
    Object.values(nextTaxonomy.colorThemesById).forEach((theme) => {
      theme.colorIds = theme.colorIds.filter((id) => id !== editingCustomAccentId);
      if (theme.id === localTaxonomy.customAccentsById[editingCustomAccentId]?.themeId) theme.updatedAt = Date.now();
    });
    if (editingCustomAccentThemeId) {
      const targetIds = nextTaxonomy.colorThemesById[editingCustomAccentThemeId]?.colorIds;
      if (targetIds) {
        const insertionIndex = previousThemeId === nextThemeId && previousIndex >= 0
          ? Math.min(previousIndex, targetIds.length)
          : targetIds.length;
        targetIds.splice(insertionIndex, 0, editingCustomAccentId);
      }
      if (nextTaxonomy.colorThemesById[editingCustomAccentThemeId]) nextTaxonomy.colorThemesById[editingCustomAccentThemeId].updatedAt = Date.now();
    } else {
      const insertionIndex = previousThemeId === nextThemeId && previousIndex >= 0
        ? Math.min(previousIndex, nextTaxonomy.ungroupedColorIds.length)
        : nextTaxonomy.ungroupedColorIds.length;
      nextTaxonomy.ungroupedColorIds.splice(insertionIndex, 0, editingCustomAccentId);
    }
    nextTaxonomy.customAccentsById[editingCustomAccentId] = {
      ...nextTaxonomy.customAccentsById[editingCustomAccentId],
      name: normalizedName,
      color: editingCustomAccentColor.toLowerCase(),
      themeId: editingCustomAccentThemeId || null,
      updatedAt: Date.now(),
    };
    commitTaxonomyUpdate(nextTaxonomy);
    setEditingCustomAccentId(null);
  };

  const handleDeleteCustomAccent = (accentId: `custom:${string}`) => {
    const accent = localTaxonomy.customAccentsById[accentId];
    if (!accent) {
      return;
    }

    const usageCount = Object.values(localTaxonomy.tagsById).filter(
      (tag) => tag.accentId === accentId,
    ).length;
    const confirmed = window.confirm(
      usageCount > 0
        ? `Delete saved color "${accent.name}"?\n\nThis will clear the color from ${usageCount} tag${usageCount === 1 ? "" : "s"}.`
        : `Delete saved color "${accent.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    delete nextTaxonomy.customAccentsById[accentId];
    nextTaxonomy.ungroupedColorIds = nextTaxonomy.ungroupedColorIds.filter((id) => id !== accentId);
    Object.values(nextTaxonomy.colorThemesById).forEach((theme) => { theme.colorIds = theme.colorIds.filter((id) => id !== accentId); });
    Object.values(nextTaxonomy.tagsById).forEach((tag) => {
      if (tag.accentId === accentId) {
        tag.accentId = null;
      }
    });
    commitTaxonomyUpdate(nextTaxonomy);
    if (editingCustomAccentId === accentId) setEditingCustomAccentId(null);
  };

  const handleAddColorTheme = () => {
    const name = promptForName("Name the new collection", "");
    if (!name) return;
    if (UNSUPPORTED_NAME_CHARACTERS.test(name)) {
      showModalNotification(UNSUPPORTED_NAME_MESSAGE, true);
      return;
    }
    if (normalizeName(name) === "default") {
      showModalNotification('"Default" is reserved for Tagify’s built-in palette.', true);
      return;
    }
    if (colorThemes.some((theme) => normalizeName(theme.name) === normalizeName(name))) {
      showModalNotification(`A collection named "${name}" already exists.`, true);
      return;
    }
    const id = `theme:${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    const now = Date.now();
    nextTaxonomy.colorThemesById[id] = { id, name: truncateName(name, 32), colorIds: [], createdAt: now, updatedAt: now };
    nextTaxonomy.colorThemeOrder = [...(nextTaxonomy.colorThemeOrder ?? []), id];
    commitTaxonomyUpdate(nextTaxonomy);
    setSelectedColorThemeId(id);
  };

  const handleDeleteColorTheme = (themeId: string) => {
    const theme = localTaxonomy.colorThemesById[themeId];
    if (!theme) return;
    setPendingDeleteColorThemeId(themeId);
  };

  const handleConfirmDeleteColorTheme = (themeId: string, deleteColors: boolean) => {
    const theme = localTaxonomy.colorThemesById[themeId];
    if (!theme) {
      setPendingDeleteColorThemeId(null);
      return;
    }
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    const colorIds = new Set(theme.colorIds);

    if (deleteColors) {
      colorIds.forEach((colorId) => {
        delete nextTaxonomy.customAccentsById[colorId];
      });
      nextTaxonomy.ungroupedColorIds = nextTaxonomy.ungroupedColorIds.filter((colorId) => !colorIds.has(colorId));
      Object.values(nextTaxonomy.colorThemesById).forEach((candidate) => {
        candidate.colorIds = candidate.colorIds.filter((colorId) => !colorIds.has(colorId));
      });
      Object.values(nextTaxonomy.tagsById).forEach((tag) => {
        if (isCustomTagAccentId(tag.accentId) && colorIds.has(tag.accentId)) tag.accentId = null;
      });
      if (editingCustomAccentId && colorIds.has(editingCustomAccentId)) setEditingCustomAccentId(null);
    } else {
      nextTaxonomy.ungroupedColorIds.push(...theme.colorIds.filter((colorId) => !nextTaxonomy.ungroupedColorIds.includes(colorId)));
      theme.colorIds.forEach((colorId) => {
        if (nextTaxonomy.customAccentsById[colorId]) {
          nextTaxonomy.customAccentsById[colorId].themeId = null;
        }
      });
    }

    delete nextTaxonomy.colorThemesById[themeId];
    nextTaxonomy.colorThemeOrder = (nextTaxonomy.colorThemeOrder ?? []).filter((id) => id !== themeId);
    commitTaxonomyUpdate(nextTaxonomy);
    setSelectedColorThemeId(null);
    setPendingDeleteColorThemeId(null);
  };

  const handleRenameColorTheme = (themeId: string) => {
    const theme = localTaxonomy.colorThemesById[themeId];
    if (!theme) return;
    const name = promptForName("Rename collection", theme.name);
    if (!name || normalizeName(name) === normalizeName(theme.name)) return;
    if (UNSUPPORTED_NAME_CHARACTERS.test(name)) {
      showModalNotification(UNSUPPORTED_NAME_MESSAGE, true);
      return;
    }
    if (normalizeName(name) === "default") {
      showModalNotification('"Default" is reserved for Tagify’s built-in palette.', true);
      return;
    }
    if (colorThemes.some((candidate) => candidate.id !== themeId && normalizeName(candidate.name) === normalizeName(name))) {
      showModalNotification(`A collection named "${name}" already exists.`, true);
      return;
    }
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.colorThemesById[themeId].name = truncateName(name, 32);
    nextTaxonomy.colorThemesById[themeId].updatedAt = Date.now();
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const handleImportColors = async (file: File) => {
    try {
      const parsed = parseColorLibrary(JSON.parse(await file.text()));
      if (!parsed) throw new Error("invalid");
      const nextTaxonomy = cloneTaxonomy(localTaxonomy);
      const usedNames = new Set(Object.values(nextTaxonomy.customAccentsById).map((color) => normalizeName(color.name)));
      const usedThemeNames = new Set(["default", ...Object.values(nextTaxonomy.colorThemesById).map((theme) => normalizeName(theme.name))]);
      const addColor = (color: { name: string; color: string }, themeId: string | null) => {
        const id = buildCustomTagAccentId();
        const now = Date.now();
        nextTaxonomy.customAccentsById[id] = { id, name: uniqueImportedName(color.name, usedNames), color: color.color.toLowerCase(), themeId, createdAt: now, updatedAt: now };
        if (themeId) nextTaxonomy.colorThemesById[themeId].colorIds.push(id); else nextTaxonomy.ungroupedColorIds.push(id);
      };
      parsed.themes.forEach((theme) => {
        const id = `theme:${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const now = Date.now();
        nextTaxonomy.colorThemesById[id] = { id, name: uniqueImportedName(theme.name, usedThemeNames), colorIds: [], createdAt: now, updatedAt: now };
        nextTaxonomy.colorThemeOrder = [...(nextTaxonomy.colorThemeOrder ?? []), id];
        theme.colors.forEach((color) => addColor(color, id));
      });
      parsed.ungrouped.forEach((color) => addColor(color, null));
      commitTaxonomyUpdate(nextTaxonomy);
      showModalNotification("Colors imported.");
    } catch {
      showModalNotification("That file is not a valid Tagify colors export. Nothing was imported.", true);
    }
  };

  const handleSaveChanges = () => {
    const removedTagIds = Object.keys(taxonomy.tagsById).filter(
      (tagId) => !(tagId in localTaxonomy.tagsById),
    );
    onReplaceTaxonomy(localTaxonomy, removedTagIds);
    setHasChanges(false);
    onClose();
  };

  const handleCancel = () => {
    if (hasChanges) {
      const confirmDiscard = window.confirm(
        "You have unsaved changes. Are you sure you want to discard them?",
      );

      if (!confirmDiscard) {
        return;
      }
    }

    onClose();
  };

  const getTaxonomyParentChildIds = useCallback(
    (parentId: string) => [
      ...(localTaxonomy.childrenByParentId?.[parentId] ??
        localTaxonomy.subcategoriesById[parentId]?.childIds ??
        localTaxonomy.categoriesById[parentId]?.childIds ??
        localTaxonomy.categoriesById[parentId]?.subcategoryIds ??
        []),
    ],
    [localTaxonomy],
  );

  const handleNativeCategoryDragStart = useCallback(
    (event: React.DragEvent, categoryId: string) => {
      if (interactionLocked) {
        event.preventDefault();
        return;
      }

      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", buildCategoryDndId(categoryId));
      setNativeTaxonomyDragState({ type: "category", categoryId });
      setOpenAccentPickerTagId(null);
    },
    [interactionLocked],
  );

  const handleNativeSubcategoryDragStart = useCallback(
    (
      event: React.DragEvent,
      categoryId: string,
      parentId: string,
      subcategoryId: string,
    ) => {
      if (interactionLocked) {
        event.preventDefault();
        return;
      }

      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", buildSubcategoryDndId(subcategoryId));
      setNativeTaxonomyDragState({
        type: "subcategory",
        categoryId,
        parentId,
        subcategoryId,
      });
      setOpenAccentPickerTagId(null);
    },
    [interactionLocked],
  );

  const handleNativeTagDragStart = useCallback(
    (
      event: React.DragEvent,
      categoryId: string,
      parentId: string,
      tagId: string,
    ) => {
      if (interactionLocked) {
        event.preventDefault();
        return;
      }

      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", buildTagDndId(tagId));
      setNativeTaxonomyDragState({
        type: "tag",
        categoryId,
        parentId,
        tagId,
      });
      setOpenAccentPickerTagId(null);
    },
    [interactionLocked],
  );

  const handleNativeTaxonomyDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!nativeTaxonomyDragState || interactionLocked) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
    },
    [interactionLocked, nativeTaxonomyDragState],
  );

  const clearNativeTaxonomyDrag = useCallback(() => {
    setNativeTaxonomyDragState(null);
  }, []);

  const handleNativeCategoryDrop = useCallback(
    (event: React.DragEvent, targetCategoryId: string) => {
      if (!nativeTaxonomyDragState || interactionLocked) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (nativeTaxonomyDragState.type === "category") {
        const placement = getDropPlacement(
          { x: event.clientX, y: event.clientY },
          event.currentTarget.getBoundingClientRect(),
        );
        const result =
          placement === "inside"
            ? moveCategoryIntoParent(
                localTaxonomy,
                nativeTaxonomyDragState.categoryId,
                targetCategoryId,
                getTaxonomyParentChildIds(targetCategoryId).length,
              )
            : moveCategory(
                localTaxonomy,
                localTaxonomy.categoryOrder.indexOf(nativeTaxonomyDragState.categoryId),
                getRelativeInsertIndex(
                  localTaxonomy.categoryOrder,
                  targetCategoryId,
                  placement,
                ) ?? localTaxonomy.categoryOrder.length,
              );
        const didMove = applyMoveResult(
          result,
          buildSubcategoryMoveErrorMessage(getMoveReason(result)),
        );
        if (didMove) {
          if (placement === "inside") {
            selectSubcategory(targetCategoryId, nativeTaxonomyDragState.categoryId);
          } else {
            selectCategory(nativeTaxonomyDragState.categoryId);
          }
        }
        clearNativeTaxonomyDrag();
        return;
      }

      if (nativeTaxonomyDragState.type === "tag") {
        const targetIndex = getTaxonomyParentChildIds(targetCategoryId).length;
        const result = moveTag(
          localTaxonomy,
          nativeTaxonomyDragState.tagId,
          targetCategoryId,
          targetIndex,
        );
        const didMove = applyMoveResult(
          result,
          buildTagMoveErrorMessage(getMoveReason(result)),
        );
        if (didMove) {
          selectCategory(targetCategoryId);
        }
        clearNativeTaxonomyDrag();
        return;
      }

      const targetIndex = getTaxonomyParentChildIds(targetCategoryId).length;
      const result = moveSubcategory(
        localTaxonomy,
        nativeTaxonomyDragState.subcategoryId,
        targetCategoryId,
        targetIndex,
      );
      const didMove = applyMoveResult(
        result,
        buildSubcategoryMoveErrorMessage(getMoveReason(result)),
      );
      if (didMove) {
        selectSubcategory(targetCategoryId, nativeTaxonomyDragState.subcategoryId);
      }
      clearNativeTaxonomyDrag();
    },
    [
      applyMoveResult,
      clearNativeTaxonomyDrag,
      getTaxonomyParentChildIds,
      interactionLocked,
      localTaxonomy,
      nativeTaxonomyDragState,
      selectCategory,
      selectSubcategory,
    ],
  );

  const handleNativeSubcategoryDrop = useCallback(
    (
      event: React.DragEvent,
      categoryId: string,
      parentId: string,
      subcategoryId: string,
    ) => {
      if (!nativeTaxonomyDragState || interactionLocked) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (nativeTaxonomyDragState.type === "tag") {
        const targetIndex = getTaxonomyParentChildIds(subcategoryId).length;
        const result = moveTag(
          localTaxonomy,
          nativeTaxonomyDragState.tagId,
          subcategoryId,
          targetIndex,
        );
        const didMove = applyMoveResult(
          result,
          buildTagMoveErrorMessage(getMoveReason(result)),
        );
        if (didMove) {
          selectSubcategory(categoryId, subcategoryId);
        }
        clearNativeTaxonomyDrag();
        return;
      }

      if (nativeTaxonomyDragState.type !== "subcategory") {
        clearNativeTaxonomyDrag();
        return;
      }

      const placement = getDropPlacement(
        { x: event.clientX, y: event.clientY },
        event.currentTarget.getBoundingClientRect(),
      );
      const shouldNestInsideTarget =
        placement === "inside" &&
        nativeTaxonomyDragState.subcategoryId !== subcategoryId;
      const targetParentId = shouldNestInsideTarget ? subcategoryId : parentId;
      const targetChildIds = getTaxonomyParentChildIds(targetParentId);
      const targetIndex = shouldNestInsideTarget
        ? targetChildIds.length
        : nativeTaxonomyDragState.parentId === parentId
          ? getSortableReorderTargetIndex(
              targetChildIds,
              nativeTaxonomyDragState.subcategoryId,
              subcategoryId,
            )
          : getRelativeInsertIndex(targetChildIds, subcategoryId, dragPlacementRef.current);
      const result = moveSubcategory(
        localTaxonomy,
        nativeTaxonomyDragState.subcategoryId,
        targetParentId,
        targetIndex === null || targetIndex < 0 ? 0 : targetIndex,
      );
      const didMove = applyMoveResult(
        result,
        buildSubcategoryMoveErrorMessage(getMoveReason(result)),
      );
      if (didMove) {
        selectSubcategory(categoryId, nativeTaxonomyDragState.subcategoryId);
      }
      clearNativeTaxonomyDrag();
    },
    [
      applyMoveResult,
      clearNativeTaxonomyDrag,
      getTaxonomyParentChildIds,
      interactionLocked,
      localTaxonomy,
      nativeTaxonomyDragState,
      selectCategory,
      selectSubcategory,
    ],
  );

  const handleNativeTagDrop = useCallback(
    (
      event: React.DragEvent,
      categoryId: string,
      parentId: string,
      targetTagId: string,
    ) => {
      if (
        !nativeTaxonomyDragState ||
        nativeTaxonomyDragState.type !== "tag" ||
        interactionLocked
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const placement = getDropPlacement(
        { x: event.clientX, y: event.clientY },
        event.currentTarget.getBoundingClientRect(),
      );
      const targetChildIds = getTaxonomyParentChildIds(parentId);
      const targetIndex = getRelativeInsertIndex(
        targetChildIds,
        targetTagId,
        placement === "inside" ? "after" : placement,
      );
      const result = moveTag(
        localTaxonomy,
        nativeTaxonomyDragState.tagId,
        parentId,
        targetIndex === null || targetIndex < 0 ? targetChildIds.length : targetIndex,
      );
      const didMove = applyMoveResult(
        result,
        buildTagMoveErrorMessage(getMoveReason(result)),
      );
      if (didMove) {
        if (localTaxonomy.categoriesById[parentId]) {
          selectCategory(parentId);
        } else {
          selectSubcategory(categoryId, parentId);
        }
      }
      clearNativeTaxonomyDrag();
    },
    [
      applyMoveResult,
      clearNativeTaxonomyDrag,
      getTaxonomyParentChildIds,
      interactionLocked,
      localTaxonomy,
      nativeTaxonomyDragState,
      selectCategory,
      selectSubcategory,
    ],
  );

  const handleNativeTagEndDrop = useCallback(
    (event: React.DragEvent, parentId: string) => {
      if (
        !nativeTaxonomyDragState ||
        nativeTaxonomyDragState.type !== "tag" ||
        interactionLocked
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const targetIndex = getTaxonomyParentChildIds(parentId).length;
      const result = moveTag(
        localTaxonomy,
        nativeTaxonomyDragState.tagId,
        parentId,
        targetIndex,
      );
      const didMove = applyMoveResult(
        result,
        buildTagMoveErrorMessage(getMoveReason(result)),
      );
      if (didMove) {
        if (localTaxonomy.categoriesById[parentId]) {
          selectCategory(parentId);
        } else {
          const targetCategoryId =
            localTaxonomy.subcategoriesById[parentId]?.categoryId;
          if (targetCategoryId) {
            selectSubcategory(targetCategoryId, parentId);
          }
        }
      }
      clearNativeTaxonomyDrag();
    },
    [
      applyMoveResult,
      clearNativeTaxonomyDrag,
      getTaxonomyParentChildIds,
      interactionLocked,
      localTaxonomy,
      nativeTaxonomyDragState,
      selectCategory,
      selectSubcategory,
    ],
  );

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      if (!dragState) {
        return closestCenter(args);
      }

      const allowedTypes: SupportedDndData["type"][] =
        dragState.type === "category"
          ? ["category"]
          : dragState.type === "subcategory"
            ? ["category", "subcategory"]
            : isPointerWithinElement(args.pointerCoordinates, treePaneRef.current)
              ? ["category", "subcategory"]
              : ["tag", "tag-end"];

      const filteredArgs = {
        ...args,
        droppableContainers: args.droppableContainers.filter((container) => {
          const data = readDndData(container.data.current);
          return data ? allowedTypes.includes(data.type) : false;
        }),
      };

      const pointerCollisions = pointerWithin(filteredArgs);
      const collisions =
        pointerCollisions.length > 0
          ? pointerCollisions
          : closestCenter(filteredArgs);
      const primaryCollision = collisions[0];
      const collisionRect = primaryCollision
        ? filteredArgs.droppableRects.get(primaryCollision.id)
        : undefined;

      dragPlacementRef.current = getDropPlacement(
        args.pointerCoordinates,
        collisionRect,
      );

      return collisions;
    },
    [dragState],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = readDndData(event.active.data.current);
    if (!data || data.type === "tag-end") {
      return;
    }

    dragPlacementRef.current = "before";
    setHoveredCategoryId(null);
    setHoveredSubcategoryId(null);
    setOpenAccentPickerTagId(null);
    setDragState(data);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!dragState) {
      return;
    }

    const overData = readDndData(event.over?.data.current);

    if (dragState.type === "tag") {
      if (overData?.type === "subcategory") {
        setHoveredSubcategoryId(overData.subcategoryId);
        setHoveredCategoryId(overData.categoryId);
      } else if (overData?.type === "category") {
        setHoveredSubcategoryId(null);
        setHoveredCategoryId(overData.categoryId);
      } else {
        setHoveredSubcategoryId(null);
        setHoveredCategoryId(null);
      }
    } else if (dragState.type === "subcategory") {
      setHoveredSubcategoryId(null);
      if (overData?.type === "category") {
        setHoveredCategoryId(overData.categoryId);
      } else if (overData?.type === "subcategory") {
        setHoveredCategoryId(overData.categoryId);
      } else {
        setHoveredCategoryId(null);
      }
    } else {
      setHoveredCategoryId(null);
      setHoveredSubcategoryId(null);
    }

    if (
      overData &&
      overData.type === "category" &&
      (dragState.type === "subcategory" || dragState.type === "tag") &&
      !expandedCategories.includes(overData.categoryId)
    ) {
      if (hoverExpandCategoryIdRef.current === overData.categoryId) {
        return;
      }

      clearHoverExpandTimer();
      hoverExpandCategoryIdRef.current = overData.categoryId;
      hoverExpandTimerRef.current = window.setTimeout(() => {
        setExpandedCategories((currentExpanded) =>
          currentExpanded.includes(overData.categoryId)
            ? currentExpanded
            : [...currentExpanded, overData.categoryId],
        );
      }, HOVER_EXPAND_DELAY_MS);
      return;
    }

    clearHoverExpandTimer();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    clearHoverExpandTimer();
    const activeData = readDndData(event.active.data.current);
    const overData = readDndData(event.over?.data.current);
    setDragState(null);
    setHoveredCategoryId(null);
    setHoveredSubcategoryId(null);
    setOpenAccentPickerTagId(null);

    if (!activeData || !overData) {
      return;
    }

    if (activeData.type === "category" && overData.type === "category") {
      const result =
        dragPlacementRef.current === "inside"
          ? moveCategoryIntoParent(
              localTaxonomy,
              activeData.categoryId,
              overData.categoryId,
              getTaxonomyParentChildIds(overData.categoryId).length,
            )
          : moveCategory(
              localTaxonomy,
              localTaxonomy.categoryOrder.indexOf(activeData.categoryId),
              getRelativeInsertIndex(
                localTaxonomy.categoryOrder,
                overData.categoryId,
                dragPlacementRef.current,
              ) ?? localTaxonomy.categoryOrder.length,
            );

      const didMove = applyMoveResult(
        result,
        buildSubcategoryMoveErrorMessage(getMoveReason(result)),
      );
      if (didMove) {
        if (dragPlacementRef.current === "inside") {
          selectSubcategory(overData.categoryId, activeData.categoryId);
        } else {
          selectCategory(activeData.categoryId);
        }
      }
      return;
    }

    if (activeData.type === "subcategory") {
      const getParentChildIds = (parentId: string) => [
        ...(localTaxonomy.childrenByParentId?.[parentId] ??
          localTaxonomy.subcategoriesById[parentId]?.childIds ??
          localTaxonomy.categoriesById[parentId]?.childIds ??
          localTaxonomy.categoriesById[parentId]?.subcategoryIds ??
          []),
      ];

      if (overData.type === "subcategory") {
        const shouldNestInsideTarget =
          dragPlacementRef.current === "inside" &&
          activeData.subcategoryId !== overData.subcategoryId;
        const targetParentId = shouldNestInsideTarget
          ? overData.subcategoryId
          : overData.parentId;
        const targetChildIds = getParentChildIds(targetParentId);
        const targetIndex = shouldNestInsideTarget
          ? targetChildIds.length
          : activeData.parentId === targetParentId
            ? getSortableReorderTargetIndex(
                targetChildIds,
                activeData.subcategoryId,
                overData.subcategoryId,
              )
            : getRelativeInsertIndex(
                targetChildIds,
                overData.subcategoryId,
                dragPlacementRef.current,
              );
        const normalizedTargetIndex =
          targetIndex === null || targetIndex < 0 ? 0 : targetIndex;

        const result = moveSubcategory(
          localTaxonomy,
          activeData.subcategoryId,
          targetParentId,
          normalizedTargetIndex,
        );

        const didMove = applyMoveResult(
          result,
          buildSubcategoryMoveErrorMessage(getMoveReason(result)),
        );

        if (didMove) {
          selectSubcategory(overData.categoryId, activeData.subcategoryId);
        }
      }

      if (overData.type === "category") {
        const targetIndex =
          getParentChildIds(overData.categoryId).length;

        const result = moveSubcategory(
          localTaxonomy,
          activeData.subcategoryId,
          overData.categoryId,
          targetIndex,
        );

        const didMove = applyMoveResult(
          result,
          buildSubcategoryMoveErrorMessage(getMoveReason(result)),
        );

        if (didMove) {
          selectSubcategory(overData.categoryId, activeData.subcategoryId);
        }
      }

      return;
    }

    if (activeData.type === "tag") {
      if (overData.type === "tag") {
        const targetSubcategoryId = overData.subcategoryId;
        const targetIndex =
          getSortableReorderTargetIndex(
            getTaxonomyParentChildIds(targetSubcategoryId),
            activeData.tagId,
            overData.tagId,
          ) ?? -1;

        const result = moveTag(
          localTaxonomy,
          activeData.tagId,
          targetSubcategoryId,
          targetIndex < 0 ? 0 : targetIndex,
        );

        const didMove = applyMoveResult(
          result,
          buildTagMoveErrorMessage(getMoveReason(result)),
        );

        if (didMove) {
          const targetCategoryId =
            localTaxonomy.subcategoriesById[targetSubcategoryId]?.categoryId;
          if (targetCategoryId) {
            selectSubcategory(targetCategoryId, targetSubcategoryId);
          }
        }
      }

      if (overData.type === "tag-end") {
        const targetSubcategoryId = overData.subcategoryId;
        const targetIndex =
          getTaxonomyParentChildIds(targetSubcategoryId).length;

        const result = moveTag(
          localTaxonomy,
          activeData.tagId,
          targetSubcategoryId,
          targetIndex,
        );

        const didMove = applyMoveResult(
          result,
          buildTagMoveErrorMessage(getMoveReason(result)),
        );

        if (didMove) {
          const targetCategoryId =
            localTaxonomy.subcategoriesById[targetSubcategoryId]?.categoryId;
          if (targetCategoryId) {
            selectSubcategory(targetCategoryId, targetSubcategoryId);
          }
        }
      }

      if (overData.type === "subcategory") {
        const targetSubcategoryId = overData.subcategoryId;
        const targetIndex =
          getTaxonomyParentChildIds(targetSubcategoryId).length;

        const result = moveTag(
          localTaxonomy,
          activeData.tagId,
          targetSubcategoryId,
          targetIndex,
        );

        const didMove = applyMoveResult(
          result,
          buildTagMoveErrorMessage(getMoveReason(result)),
        );

        if (didMove) {
          selectSubcategory(overData.categoryId, targetSubcategoryId);
        }
      }

      if (overData.type === "category") {
        const targetCategoryId = overData.categoryId;
        const targetIndex =
          localTaxonomy.childrenByParentId?.[targetCategoryId]?.length
          ?? localTaxonomy.categoriesById[targetCategoryId]?.childIds?.length
          ?? 0;

        const result = moveTag(
          localTaxonomy,
          activeData.tagId,
          targetCategoryId,
          targetIndex,
        );

        const didMove = applyMoveResult(
          result,
          buildTagMoveErrorMessage(getMoveReason(result)),
        );

        if (didMove) {
          selectCategory(targetCategoryId);
        }
      }
    }
  };

  const handleDragCancel = () => {
    clearHoverExpandTimer();
    setDragState(null);
    setHoveredCategoryId(null);
    setHoveredSubcategoryId(null);
    setOpenAccentPickerTagId(null);
  };

  useEffect(() => {
    if (!openAccentPickerTagId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setOpenAccentPickerTagId(null);
        return;
      }

      if (target.closest('[data-tag-accent-menu-root="true"]')) {
        return;
      }

      setOpenAccentPickerTagId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [openAccentPickerTagId]);

  return (
    <Portal>
      <div className={styles.overlay} onClick={handleCancel}>
        <div className={styles.sheet} onClick={(event) => event.stopPropagation()}>
          {notification ? (
            <div
              className={`${styles.notification} ${
                notification.isError ? styles.notificationError : styles.notificationSuccess
              }`}
            >
              {notification.message}
            </div>
          ) : null}

          <div className={styles.header}>
            <div>
              <h2 className={styles.title}>Tag Manager</h2>
              <p className={styles.subtitle}>
                {activeView === "tags"
                  ? "Reorder categories, move folders, and organize your tags."
                  : activeView === "community"
                    ? "Browse Community tags and add them to your own library."
                    : "Manage the reusable colors available throughout Tagify."}
              </p>
            </div>

            <div className={styles.headerActions}>
              {activeView === "tags" ? (
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search categories, folders, and tags…"
                  className={styles.searchInput}
                />
              ) : null}
            </div>
          </div>

          <div className={styles.viewTabs} role="tablist" aria-label="Tag Manager sections">
            <button type="button" role="tab" aria-selected={activeView === "tags"} className={`${styles.viewTab} ${activeView === "tags" ? styles.viewTabActive : ""}`} onClick={() => setActiveView("tags")}>Tags</button>
            <button type="button" role="tab" aria-selected={activeView === "community"} className={`${styles.viewTab} ${activeView === "community" ? styles.viewTabActive : ""}`} onClick={() => setActiveView("community")}>Community</button>
            <button type="button" role="tab" aria-selected={activeView === "colors"} className={`${styles.viewTab} ${activeView === "colors" ? styles.viewTabActive : ""}`} onClick={() => setActiveView("colors")}>Colors</button>
          </div>

          {activeView === "tags" && interactionLocked ? (
            <div className={styles.infoBanner}>
              Search is active. Dragging is temporarily disabled so filtered rows do not reorder unpredictably. Clear the search to drag.
            </div>
          ) : null}

          {activeView === "tags" ? (
            <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            autoScroll
          >
            <div className={styles.body}>
              <div className={styles.pane}>
                <div className={styles.paneHeader}>
                  <div>
                    <h3 className={styles.paneTitle}>Taxonomy</h3>
                    <p className={styles.paneSubtitle}>Categories and folders</p>
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() =>
                      setExpandedCategories(
                        areAllCategoriesExpanded ? [] : expandableTaxonomyIds,
                      )
                    }
                    disabled={interactionLocked}
                  >
                    {areAllCategoriesExpanded ? "Collapse All" : "Expand All"}
                  </button>
                </div>

                <div ref={treePaneRef} className={styles.treePane}>
                  <SortableContext
                    items={localTaxonomy.categoryOrder.map(buildCategoryDndId)}
                    strategy={verticalListSortingStrategy}
                  >
                    {filteredCategories.length === 0 ? (
                      <div className={styles.emptyStateSmall}>
                        No categories, folders, or tags match this search.
                      </div>
                    ) : (
                      filteredCategories.map((category) => {
                        const isExpanded = interactionLocked
                          ? true
                          : expandedCategories.includes(category.id);
                        const isSelected =
                          selectedCategoryId === category.id ||
                          selectedSubcategory?.categoryId === category.id;

                        return (
                          <SortableCategoryCard
                            key={category.id}
                            category={category}
                            isExpanded={isExpanded}
                            isSelected={isSelected}
                            isDragDisabled={interactionLocked}
                            isDropActive={
                              hoveredCategoryId === category.id &&
                              (dragState?.type === "subcategory" ||
                                dragState?.type === "tag")
                            }
                            tagCount={getCategoryTagCount(category)}
                            onToggleExpanded={toggleTaxonomyNodeExpanded}
                            onSelectCategory={selectCategory}
                            onRenameCategory={handleRenameCategory}
                            onDeleteCategory={handleRemoveCategory}
                            onNativeDragStart={handleNativeCategoryDragStart}
                            onNativeDragOver={handleNativeTaxonomyDragOver}
                            onNativeDrop={handleNativeCategoryDrop}
                            onNativeDragEnd={clearNativeTaxonomyDrag}
                          >
                            <SortableContext
                              items={category.subcategories.map((subcategory) =>
                                buildSubcategoryDndId(subcategory.id),
                              )}
                              strategy={verticalListSortingStrategy}
                            >
                              {category.subcategories.length === 0 ? (
                                <div className={styles.emptyStateSmall}>
                                  No folders yet.
                                </div>
                              ) : (
                                category.subcategories.map((subcategory) =>
                                  renderSubcategoryTree(category.id, subcategory, category.id),
                                )
                              )}
                            </SortableContext>
                            <button
                              type="button"
                              className={styles.inlineAddSubcategoryButton}
                              onClick={() => handleAddSubcategory(category.id)}
                            >
                              <span className={styles.inlineAddLabel}>+ Add Folder</span>
                            </button>
                          </SortableCategoryCard>
                        );
                      })
                    )}
                    <button
                      type="button"
                      className={styles.inlineAddCategoryButton}
                      onClick={handleAddCategory}
                    >
                      <span className={styles.inlineAddLabel}>+ Add Category</span>
                    </button>
                  </SortableContext>
                </div>
              </div>

              <div className={styles.pane}>
                <div className={styles.paneHeader}>
                  {selectedCategoryForInspector && selectedTagParentId ? (
                    <div>
                      <div className={styles.breadcrumb} aria-label="Selected path">
                        {selectedCategoryForInspector.name}
                        {selectedFolderPath.map((folder) => (
                          <React.Fragment key={folder.id}>
                            <span className={styles.breadcrumbSeparator}>/</span>
                            <span>{folder.name}</span>
                          </React.Fragment>
                        ))}
                      </div>
                      <p className={styles.paneSubtitle}>
                        Drag tags here to reorder them, or drop them onto a folder in the tree to move them.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <h3 className={styles.paneTitle}>Tags</h3>
                      <p className={styles.paneSubtitle}>
                        Select a category or folder to manage its tags.
                      </p>
                    </div>
                  )}
                </div>

                {selectedCategoryForInspector && selectedTagParentId ? (
                  <div className={styles.inspectorPane}>
                    <div className={styles.tagToolbar}>
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(event) => setNewTagName(event.target.value)}
                        placeholder={`Add tag to ${selectedTagParentName}…`}
                        className={styles.textInput}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            handleAddTag();
                          }
                        }}
                      />
                      <button type="button" className={styles.primaryButton} onClick={handleAddTag}>
                        Add Tag
                      </button>
                    </div>

                    <div className={styles.tagListPane}>
                      <SortableContext
                        items={selectedTags.map((tag) => buildTagDndId(tag.id))}
                        strategy={rectSortingStrategy}
                      >
                        {selectedTags.length === 0 ? (
                          <div className={styles.emptyState}>
                            {selectedTagParentIsCategory
                              ? "This category does not have any tags yet."
                              : "This folder has no tags directly in it. Select a subfolder to see its tags."}
                          </div>
                        ) : (
                          <div className={styles.tagChipGrid}>
                            {selectedTags.map((tag) => (
                              <SortableTagRow
                                key={tag.id}
                                categoryId={selectedCategoryForInspector.id}
                                subcategoryId={selectedTagParentId}
                                tag={tag}
                                isDragDisabled={interactionLocked}
                                isDropActive={
                                  nativeTaxonomyDragState?.type === "tag" &&
                                  nativeTaxonomyDragState.tagId !== tag.id
                                }
                                isAccentPickerOpen={openAccentPickerTagId === tag.id}
                                customAccentsById={localTaxonomy.customAccentsById}
                                accentGroups={accentGroups}
                                onRenameTag={handleRenameTag}
                                onDeleteTag={handleRemoveTag}
                                onToggleAccentPicker={handleToggleAccentPicker}
                                onSetTagAccent={handleSetTagAccent}
                                onNativeDragStart={handleNativeTagDragStart}
                                onNativeDragOver={handleNativeTaxonomyDragOver}
                                onNativeDrop={handleNativeTagDrop}
                                onNativeDragEnd={clearNativeTaxonomyDrag}
                              />
                            ))}
                            <TagEndDropZone
                              subcategoryId={selectedTagParentId}
                              isVisible={!interactionLocked}
                              isDropActive={nativeTaxonomyDragState?.type === "tag"}
                              onNativeDragOver={handleNativeTaxonomyDragOver}
                              onNativeDrop={handleNativeTagEndDrop}
                            />
                          </div>
                        )}
                      </SortableContext>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    Select a category or folder to start organizing tags.
                  </div>
                )}
              </div>
            </div>

            <DragOverlay>
              {dragState ? (
                <div className={styles.dragOverlayCard}>
                  <span className={styles.dragOverlayType}>{dragState.type}</span>
                  <span className={styles.dragOverlayLabel}>{dragState.label}</span>
                </div>
              ) : null}
            </DragOverlay>
            </DndContext>
          ) : activeView === "community" ? (
            <div className={styles.communityBody}>
              <aside className={styles.communitySidebar} aria-label="Community tag import destination">
                <div className={styles.destinationCard}>
                  <h3 className={styles.paneTitle}>Import Destination</h3>
                  <p className={styles.paneSubtitle}>
                    Imported tags land in the selected category or folder.
                  </p>
                  <div className={styles.breadcrumb} aria-label="Community import destination">
                    {communityDestinationPath}
                  </div>
                </div>

                <div className={styles.communityDestinationTree}>
                  {localCategories.map((category) => {
                    const isSelected =
                      selectedCategoryId === category.id && selectedSubcategoryId === null;

                    return (
                      <div key={category.id} className={styles.communityDestinationCategory}>
                        <button
                          type="button"
                          className={`${styles.communityDestinationButton} ${isSelected ? styles.communityDestinationButtonActive : ""}`}
                          onClick={() => selectCategory(category.id)}
                        >
                          <span>{category.name}</span>
                          <small>{getCategoryTagCount(category)} tags</small>
                        </button>
                        {category.subcategories.length > 0 ? (
                          <div className={styles.communityDestinationSubfolders}>
                            {category.subcategories.map((subcategory) => (
                              <CommunityDestinationFolder
                                key={subcategory.id}
                                categoryId={category.id}
                                subcategory={subcategory}
                                selectedSubcategoryId={selectedSubcategoryId}
                                onSelectSubcategory={selectSubcategory}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </aside>

              <main className={styles.communityInspector}>
                <div className={styles.paneHeader}>
                  <div>
                    <h3 className={styles.paneTitle}>Community Tag Catalog</h3>
                    <p className={styles.paneSubtitle}>
                      Public tags from community-tagged tracks, normalized by tag name.
                    </p>
                  </div>
                </div>

                <div className={styles.communityFilterControls}>
                  <input
                    type="text"
                    value={communitySearchQuery}
                    onChange={(event) => setCommunitySearchQuery(event.target.value)}
                    placeholder="Search community tags..."
                    className={styles.searchInput}
                  />
                  <select
                    className={styles.compactSelect}
                    value={communitySortMode}
                    onChange={(event) =>
                      setCommunitySortMode(event.target.value as CommunityCatalogSortMode)
                    }
                    aria-label="Sort community tags"
                  >
                    <option value="contributors">Most users</option>
                    <option value="popular">Most tracks</option>
                    <option value="alphabetical">Alphabetical</option>
                    <option value="recent">Recent</option>
                  </select>
                  <button
                    type="button"
                    className={styles.communitySortDirectionButton}
                    onClick={() =>
                      setCommunitySortDirection((currentDirection) =>
                        currentDirection === "ascending" ? "descending" : "ascending",
                      )
                    }
                    title={`Sort ${communitySortDirection === "ascending" ? "descending" : "ascending"}`}
                    aria-label={`Sort community tags ${communitySortDirection === "ascending" ? "descending" : "ascending"}`}
                  >
                    {communitySortDirection === "ascending" ? "↑" : "↓"}
                  </button>
                  <select
                    className={styles.compactSelect}
                    value={communityMinTrackCount}
                    onChange={(event) => setCommunityMinTrackCount(Number(event.target.value))}
                    aria-label="Minimum community track count"
                  >
                    {[1, 5, 10, 25, 50].map((count) => (
                      <option key={count} value={count}>
                        {count}+ tracks
                      </option>
                    ))}
                  </select>
                </div>

                {isLoadingCommunityTags ? (
                  <div className={styles.emptyState}>Loading community tags...</div>
                ) : communityTagsError ? (
                  <div className={styles.emptyState}>
                    <p>{communityTagsError}</p>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        communityTagsRequestRef.current = null;
                        setCommunityTagsError(null);
                        setCommunityTags([]);
                        setIsLoadingCommunityTags(true);
                        const tagsRequest = loadCommunityCatalogTags();
                        communityTagsRequestRef.current = tagsRequest;
                        tagsRequest
                          .then((tags) => {
                            setCommunityTags(tags);
                          })
                          .catch((error) => {
                            console.error("Failed to load community tags", error);
                            setCommunityTagsError("Community tags could not be loaded. Check your Spotify console for the request error.");
                            communityTagsRequestRef.current = null;
                          })
                          .finally(() => {
                            setIsLoadingCommunityTags(false);
                          });
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : visibleCommunityTags.length === 0 ? (
                  <div className={styles.emptyState}>No community tags match this search.</div>
                ) : (
                  <div className={styles.communityTagList}>
                    {visibleCommunityTags.map((tag) => (
                      <article
                        key={tag.key}
                        className={styles.communityTagRow}
                        role="link"
                        tabIndex={0}
                        aria-label={`Open Community songs tagged ${tag.name}`}
                        onClick={() => openCommunityTagSearch(tag)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          openCommunityTagSearch(tag);
                        }}
                      >
                        <div className={styles.communityTagCopy}>
                          <strong>{tag.name}</strong>
                          <span>{formatCommunityTagStats(tag)}</span>
                        </div>
                        <button
                          type="button"
                          className={styles.secondaryButtonSmall}
                          disabled={importingCommunityTagKey === tag.key}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleImportCommunityTag(tag);
                          }}
                        >
                          {importingCommunityTagKey === tag.key ? "Importing..." : "Import"}
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </main>
            </div>
          ) : (
            <div className={styles.colorLibraryBody}>
              <aside className={styles.colorCollectionSidebar} aria-label="Color collections">
                <label className={styles.colorThemeSortControl}>
                  <span>Sort colors and collections</span>
                  <select value={colorLibrarySortMode} onChange={(event) => setColorLibrarySortMode(event.target.value as ColorLibrarySortMode)}>
                    <option value="custom">Custom</option>
                    <option value="alphabetical">Alphabetical</option>
                    <option value="created">Last created</option>
                    <option value="updated">Last updated</option>
                  </select>
                </label>
                <button type="button" className={`${styles.colorCollectionButton} ${selectedColorThemeId === null ? styles.colorCollectionButtonActive : ""}`} onClick={() => setSelectedColorThemeId(null)}>
                  <span>All Colors</span><span>{allCustomAccents.length}</span>
                </button>
                <button type="button" className={`${styles.colorCollectionButton} ${selectedColorThemeId === UNGROUPED_COLOR_FILTER ? styles.colorCollectionButtonActive : ""}`} onClick={() => setSelectedColorThemeId(UNGROUPED_COLOR_FILTER)}>
                  <span>Ungrouped</span><span>{allCustomAccents.filter((accent) => !accent.themeId).length}</span>
                </button>
                {colorThemes.map((theme) => (
                  <button key={theme.id} type="button" draggable={colorLibrarySortMode === "custom"} onDragStart={() => setDraggedThemeId(theme.id)} onDragEnd={() => setDraggedThemeId(null)} onDragOver={(event) => { if (draggedThemeId || (draggedColorId && canMoveColorToTheme(draggedColorId, theme.id))) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (draggedColorId) moveColorToTheme(draggedColorId, theme.id); else if (draggedThemeId) reorderColorThemes(draggedThemeId, theme.id); setDraggedColorId(null); setDraggedThemeId(null); }} className={`${styles.colorCollectionButton} ${selectedColorThemeId === theme.id ? styles.colorCollectionButtonActive : ""} ${draggedThemeId === theme.id ? styles.sortableDragging : ""}`} onClick={() => setSelectedColorThemeId(theme.id)}>
                    <span>{theme.name}</span><span>{theme.colorIds.length}</span>
                  </button>
                ))}
                <button type="button" className={styles.addCollectionButton} onClick={handleAddColorTheme}>+ New Collection</button>
              </aside>

              <main className={styles.colorLibraryContent}>
                {selectedColorThemeId === null ? (
                  <section className={styles.defaultPaletteSection} aria-labelledby="default-palette-heading">
                    <div className={styles.colorSectionHeadingRow}>
                      <div>
                        <h3 id="default-palette-heading" className={styles.colorSectionTitle}>Default palette</h3>
                        <p className={styles.colorSectionDescription}>Built-in colors are always available and cannot be edited.</p>
                      </div>
                      <label className={styles.defaultPaletteSwitch}>
                        <span>Show default palette</span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={showDefaultPalette}
                          onChange={(event) => setShowDefaultPalette(event.target.checked)}
                        />
                        <span className={styles.defaultPaletteSwitchTrack} aria-hidden="true" />
                      </label>
                    </div>
                    {showDefaultPalette ? (
                      <div className={styles.defaultPaletteGrid}>
                        {TAG_ACCENT_PRESET_OPTIONS.map((option) => (
                          <div key={option.value} className={styles.defaultColorCard} style={buildTagAccentCssVars(option.value, localTaxonomy.customAccentsById)}>
                            <span className={styles.defaultColorSwatch} aria-hidden="true" />
                            <span>{option.label}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section
                  className={`${styles.customColorSection} ${selectedColorThemeId === null ? "" : styles.customColorSectionStandalone}`}
                  aria-label={selectedColorThemeId === null ? "Custom colors" : undefined}
                  aria-labelledby={selectedColorThemeId === null ? undefined : "custom-colors-heading"}
                >
                  <div className={styles.colorSectionHeadingRow}>
                    <div>
                      {selectedColorThemeId !== null ? (
                        <h3 id="custom-colors-heading" className={styles.colorSectionTitle}>{selectedColorTheme?.name ?? "Ungrouped"}</h3>
                      ) : null}
                      <p className={`${styles.colorSectionDescription} ${selectedColorThemeId === null ? styles.colorSectionDescriptionStandalone : ""}`}>{customAccents.length} custom color{customAccents.length === 1 ? "" : "s"}, sorted {COLOR_LIBRARY_SORT_DESCRIPTIONS[colorLibrarySortMode]}.</p>
                    </div>
                    <div className={styles.colorSectionActions}>
                      {selectedColorTheme ? (
                        <>
                          <button type="button" className={styles.secondaryButtonSmall} onClick={() => handleRenameColorTheme(selectedColorTheme.id)}><Pencil size={13} /> Rename Collection</button>
                          <button type="button" className={styles.savedAccentDeleteButton} onClick={() => handleDeleteColorTheme(selectedColorTheme.id)} aria-label={`Delete collection ${selectedColorTheme.name}`}><Trash2 size={13} /></button>
                        </>
                      ) : null}
                      <button type="button" className={styles.primaryButton} onClick={() => {
                        setEditingCustomAccentId(null);
                        setNewCustomAccentName("");
                        setNewCustomAccentThemeId(selectedColorTheme?.id ?? "");
                        setIsAddingCustomAccent(true);
                      }}>+ Add Color</button>
                      <details className={styles.colorOverflowMenu}>
                        <summary aria-label="More color actions"><MoreHorizontal size={16} /></summary>
                        <div className={styles.colorOverflowMenuPanel}>
                          <button type="button" onClick={() => colorImportRef.current?.click()}><Upload size={13} /> Import Colors</button>
                          <button type="button" onClick={() => downloadColors(localTaxonomy, selectedColorTheme?.id)}><Download size={13} /> {selectedColorTheme ? "Export Collection" : "Export Colors"}</button>
                        </div>
                      </details>
                      <input ref={colorImportRef} type="file" accept="application/json,.json" className={styles.hiddenFileInput} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportColors(file); event.target.value = ""; }} />
                    </div>
                  </div>

                  {pendingDeleteColorTheme ? (
                    <div className={styles.collectionDeleteOverlay} onClick={() => setPendingDeleteColorThemeId(null)}>
                      <div
                        className={styles.collectionDeletePrompt}
                        role="alertdialog"
                        aria-modal="true"
                        aria-label={`Delete ${pendingDeleteColorTheme.name} collection?`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div>
                          <h4>Delete “{pendingDeleteColorTheme.name}”?</h4>
                          <p>This collection contains {pendingDeleteColorTheme.colorIds.length} custom color{pendingDeleteColorTheme.colorIds.length === 1 ? "" : "s"}. Move them to Ungrouped, or delete them and clear those colors from every affected tag.</p>
                        </div>
                        <div className={styles.collectionDeleteActions}>
                          <button type="button" className={styles.secondaryButtonSmall} onClick={() => setPendingDeleteColorThemeId(null)}>Cancel</button>
                          <button type="button" className={styles.secondaryButtonSmall} onClick={() => handleConfirmDeleteColorTheme(pendingDeleteColorTheme.id, false)}>Move Colors to Ungrouped</button>
                          <button type="button" className={styles.dangerButtonSmall} onClick={() => handleConfirmDeleteColorTheme(pendingDeleteColorTheme.id, true)}>Delete Collection and Colors</button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isAddingCustomAccent ? (
                    <div className={styles.colorEditor} aria-label="Add custom color">
                      <div className={styles.colorEditorFields}>
                        <label className={styles.colorEditorField}><span>Name</span><input type="text" value={newCustomAccentName} onChange={(event) => setNewCustomAccentName(event.target.value)} placeholder="Name this color…" className={styles.textInput} /></label>
                        <label className={styles.colorEditorField}><span>Color</span><input type="color" value={newCustomAccentColor} onChange={(event) => setNewCustomAccentColor(event.target.value)} className={styles.colorInput} aria-label="Choose saved color" /></label>
                        <label className={styles.colorEditorField}><span>Collection</span><select className={styles.colorThemeSelect} value={newCustomAccentThemeId} onChange={(event) => setNewCustomAccentThemeId(event.target.value)}><option value="">Ungrouped</option>{colorThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
                      </div>
                      <div className={styles.colorEditorActions}><button type="button" className={styles.secondaryButtonSmall} onClick={() => setIsAddingCustomAccent(false)}>Cancel</button><button type="button" className={styles.primaryButton} onClick={handleAddCustomAccent}>Save Color</button></div>
                    </div>
                  ) : null}

                  {editingCustomAccentId ? (
                    <div className={styles.colorEditor} aria-label={`Edit ${editingCustomAccentName}`}>
                      <div className={styles.colorEditorFields}>
                        <label className={styles.colorEditorField}><span>Name</span><input type="text" value={editingCustomAccentName} onChange={(event) => setEditingCustomAccentName(event.target.value)} className={styles.textInput} /></label>
                        <label className={styles.colorEditorField}><span>Color</span><input type="color" value={editingCustomAccentColor} onChange={(event) => setEditingCustomAccentColor(event.target.value)} className={styles.colorInput} aria-label={`Change color ${editingCustomAccentName}`} /></label>
                        <label className={styles.colorEditorField}><span>Collection</span><select className={styles.colorThemeSelect} value={editingCustomAccentThemeId} onChange={(event) => setEditingCustomAccentThemeId(event.target.value)}><option value="">Ungrouped</option>{colorThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
                      </div>
                      <div className={styles.colorEditorActions}>
                        <button type="button" className={styles.secondaryButtonSmall} onClick={() => setEditingCustomAccentId(null)}>Cancel</button>
                        <button type="button" className={styles.primaryButton} onClick={handleSaveCustomAccent}>Save Color</button>
                      </div>
                    </div>
                  ) : null}

                  {customAccents.length > 0 ? (
                    <div className={styles.customColorList}>
                      {customAccents.map((accent) => (
                        <div key={accent.id} draggable onDragStart={() => setDraggedColorId(accent.id)} onDragEnd={() => setDraggedColorId(null)} onDragOver={(event) => { if (draggedColorId && selectedColorTheme && canMoveColorToTheme(draggedColorId, selectedColorTheme.id)) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (draggedColorId && selectedColorTheme) moveColorToTheme(draggedColorId, selectedColorTheme.id, accent.id); setDraggedColorId(null); }} className={`${styles.customColorRow} ${draggedColorId === accent.id ? styles.sortableDragging : ""}`} style={buildTagAccentCssVars(accent.id, localTaxonomy.customAccentsById)}>
                          <span className={styles.customColorSwatch} aria-hidden="true" />
                          <div className={styles.customColorIdentity}><span className={styles.customColorName}>{accent.name}</span><span className={styles.customColorValue}>{accent.color}</span></div>
                          <span className={styles.customColorCollection}>{accent.themeId ? localTaxonomy.colorThemesById[accent.themeId]?.name ?? "Ungrouped" : "Ungrouped"}</span>
                          <div className={styles.customColorActions}>
                            <button type="button" className={styles.savedAccentRenameButton} onClick={() => handleBeginEditCustomAccent(accent.id)} aria-label={`Edit saved color ${accent.name}`} title="Edit color"><Pencil size={13} /></button>
                            <button type="button" className={styles.savedAccentDeleteButton} onClick={() => handleDeleteCustomAccent(accent.id)} aria-label={`Delete saved color ${accent.name}`} title="Delete color"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : selectedColorTheme ? (
                    <div className={styles.colorLibraryEmpty} onDragOver={(event) => { if (draggedColorId && canMoveColorToTheme(draggedColorId, selectedColorTheme.id)) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (draggedColorId) moveColorToTheme(draggedColorId, selectedColorTheme.id); setDraggedColorId(null); }}>Drop a color here to add it to this collection.</div>
                  ) : (
                    <div className={styles.colorLibraryEmpty}>No custom colors in this view yet.</div>
                  )}
                </section>
              </main>
            </div>
          )}

          <div className={styles.footer}>
            <div className={styles.footerMeta}>
              {hasChanges ? "You have unsaved changes." : "No unsaved changes."}
            </div>
            <div className={styles.footerActions}>
              <button type="button" className={styles.secondaryButton} onClick={handleCancel}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleSaveChanges}
                disabled={!hasChanges}
              >
                Save Changes
              </button>
            </div>
          </div>
          {renameTarget ? (
            <div className={styles.renameOverlay} onClick={() => setRenameTarget(null)}>
              <form
                className={styles.renameDialog}
                role="dialog"
                aria-modal="true"
                aria-label={`Rename ${renameTarget.kind}`}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") setRenameTarget(null);
                }}
                onKeyUp={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  confirmRename();
                }}
              >
                <label htmlFor="tag-manager-rename-input">Rename {renameTarget.kind}</label>
                <input
                  id="tag-manager-rename-input"
                  autoFocus
                  className={styles.textInput}
                  value={renameValue}
                  maxLength={MAX_NAME_LENGTH}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <div className={styles.renameActions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => setRenameTarget(null)}>Cancel</button>
                  <button type="submit" className={styles.primaryButton} disabled={!renameValue.trim()}>Save name</button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </Portal>
  );
};

export default TagManager;
