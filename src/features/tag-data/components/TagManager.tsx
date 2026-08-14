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
  TagAccentId,
  TagTaxonomy,
  ArtistData,
  PlaylistData,
  TrackData,
} from "@/types/tagData";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
import { countTagFilterFormulaReferences } from "@/utils/tagFilterGroups";
import { buildCategoryTree, createEntityId } from "@/utils/tagTaxonomy";
import {
  cloneTaxonomy,
  getRelativeInsertIndex,
  getSortableReorderTargetIndex,
  moveCategory,
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

type CategoryDragData = {
  type: "category";
  categoryId: string;
  label: string;
};

type SubcategoryDragData = {
  type: "subcategory";
  categoryId: string;
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
  children: React.ReactNode;
}

interface SortableSubcategoryRowProps {
  categoryId: string;
  subcategoryId: string;
  name: string;
  tagCount: number;
  isSelected: boolean;
  isDragDisabled: boolean;
  isTagDropActive: boolean;
  onSelectSubcategory: (categoryId: string, subcategoryId: string) => void;
  onRenameSubcategory: (categoryId: string, subcategoryId: string) => void;
  onDeleteSubcategory: (categoryId: string, subcategoryId: string) => void;
}

interface SortableTagRowProps {
  categoryId: string;
  subcategoryId: string;
  tag: Tag;
  isDragDisabled: boolean;
  isAccentPickerOpen: boolean;
  customAccentsById: TagTaxonomy["customAccentsById"];
  accentGroups: TagAccentGroup[];
  onRenameTag: (subcategoryId: string, tagId: string) => void;
  onDeleteTag: (subcategoryId: string, tagId: string) => void;
  onToggleAccentPicker: (tagId: string) => void;
  onSetTagAccent: (tagId: string, accentId: TagAccentId | null) => void;
}

interface TagAccentGroup {
  label: string;
  options: TagAccentOption[];
}

interface TagEndDropZoneProps {
  subcategoryId: string;
  isVisible: boolean;
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

type TagManagerView = "tags" | "colors";

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
  if (!pointerCoordinates || !rect) {
    return "before";
  }

  return pointerCoordinates.y >= rect.top + rect.height / 2 ? "after" : "before";
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
  return category.subcategories.reduce(
    (count, subcategory) => count + subcategory.tags.length,
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

    const matchingSubcategories = category.subcategories.filter((subcategory) => {
      if (normalizeName(subcategory.name).includes(normalizedQuery)) {
        return true;
      }

      return subcategory.tags.some((tag) =>
        normalizeName(tag.name).includes(normalizedQuery),
      );
    });

    if (matchingSubcategories.length === 0) {
      return [];
    }

    return [
      {
        ...category,
        subcategories: matchingSubcategories,
      },
    ];
  });
}

function buildCategoryMoveErrorMessage(reason: TaxonomyMoveReason): string {
  switch (reason) {
    case "missing-source":
    case "missing-target":
      return "That move could not be completed because the destination is no longer available.";
    case "same-position":
      return "";
    default:
      return "That category move could not be completed.";
  }
}

function buildSubcategoryMoveErrorMessage(reason: TaxonomyMoveReason): string {
  switch (reason) {
    case "duplicate-subcategory-name":
      return "That category already contains a subcategory with the same name.";
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
          type="button"
          className={styles.dragHandleButton}
          aria-label={`Drag category ${category.name}`}
          disabled={isDragDisabled}
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
  subcategoryId,
  name,
  tagCount,
  isSelected,
  isDragDisabled,
  isTagDropActive,
  onSelectSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
}: SortableSubcategoryRowProps) {
  const sortable = useSortable({
    id: buildSubcategoryDndId(subcategoryId),
    disabled: isDragDisabled,
    data: {
      type: "subcategory",
      categoryId,
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
      className={`${styles.subcategoryRow} ${
        isSelected ? styles.subcategoryRowSelected : ""
      } ${sortable.isDragging ? styles.sortableDragging : ""} ${
        isTagDropActive ? styles.dropTargetActive : ""
      }`}
    >
      <button
        type="button"
        className={styles.dragHandleButton}
        aria-label={`Drag subcategory ${name}`}
        disabled={isDragDisabled}
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
  isAccentPickerOpen,
  customAccentsById,
  accentGroups,
  onRenameTag,
  onDeleteTag,
  onToggleAccentPicker,
  onSetTagAccent,
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
      }`}
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

function TagEndDropZone({ subcategoryId, isVisible }: TagEndDropZoneProps) {
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
        droppable.isOver ? styles.dropTargetActive : ""
      }`}
    >
      Drop here to place at the end
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
  const [expandedCategories, setExpandedCategories] = useState<string[]>(
    () => initialExpandedCategoryIds ?? [],
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [newTagName, setNewTagName] = useState<string>("");
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
  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null);
  const [hoveredSubcategoryId, setHoveredSubcategoryId] = useState<string | null>(null);

  const hoverExpandTimerRef = useRef<number | null>(null);
  const hoverExpandCategoryIdRef = useRef<string | null>(null);
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

  const selectedCategory = selectedCategoryId
    ? localTaxonomy.categoriesById[selectedCategoryId]
    : null;
  const selectedSubcategory = selectedSubcategoryId
    ? localTaxonomy.subcategoriesById[selectedSubcategoryId]
    : null;

  const selectedCategoryForInspector =
    selectedSubcategory?.categoryId
      ? localTaxonomy.categoriesById[selectedSubcategory.categoryId]
      : selectedCategory;

  const selectedTags = useMemo(() => {
    if (!selectedSubcategory) {
      return [];
    }

    return selectedSubcategory.tagIds
      .map((tagId) => localTaxonomy.tagsById[tagId])
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        accentId: tag.accentId ?? null,
      }));
  }, [localTaxonomy.tagsById, selectedSubcategory]);
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
    localTaxonomy.categoryOrder.length > 0 &&
    localTaxonomy.categoryOrder.every((categoryId) =>
      expandedCategories.includes(categoryId),
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
    if (selectedSubcategoryId && localTaxonomy.subcategoriesById[selectedSubcategoryId]) {
      const nextCategoryId =
        localTaxonomy.subcategoriesById[selectedSubcategoryId].categoryId;

      setSelectedCategoryId(nextCategoryId);
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
    if (initialExpandedCategoryIds === undefined) {
      setExpandedCategories(firstCategoryId ? [firstCategoryId] : []);
    }
  }, [
    initialExpandedCategoryIds,
    localTaxonomy,
    selectedCategoryId,
    selectedSubcategoryId,
  ]);

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
      const category = localTaxonomy.categoriesById[categoryId];

      return !(category?.subcategoryIds || [])
        .filter((subcategoryId) => subcategoryId !== excludeSubcategoryId)
        .some(
          (subcategoryId) =>
            normalizeName(localTaxonomy.subcategoriesById[subcategoryId]?.name || "") ===
            normalizedName,
        );
    },
    [localTaxonomy],
  );

  const isTagNameUnique = useCallback(
    (subcategoryId: string, name: string, excludeTagId?: string) => {
      const normalizedName = normalizeName(name);
      const subcategory = localTaxonomy.subcategoriesById[subcategoryId];

      return !(subcategory?.tagIds || [])
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
    setExpandedCategories((currentExpanded) =>
      currentExpanded.includes(categoryId)
        ? currentExpanded
        : [...currentExpanded, categoryId],
    );

    if (category.subcategoryIds.length > 0) {
      setSelectedSubcategoryId(category.subcategoryIds[0]);
    } else {
      setSelectedSubcategoryId(null);
    }
  }, [localTaxonomy]);

  const selectSubcategory = useCallback(
    (categoryId: string, subcategoryId: string) => {
      setSelectedCategoryId(categoryId);
      setSelectedSubcategoryId(subcategoryId);
      setExpandedCategories((currentExpanded) =>
        currentExpanded.includes(categoryId)
          ? currentExpanded
          : [...currentExpanded, categoryId],
      );
    },
    [],
  );

  const toggleCategoryExpanded = useCallback((categoryId: string) => {
    setExpandedCategories((currentExpanded) =>
      currentExpanded.includes(categoryId)
        ? currentExpanded.filter((id) => id !== categoryId)
        : [...currentExpanded, categoryId],
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
    };

    commitTaxonomyUpdate(nextTaxonomy);
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId(null);
    setExpandedCategories((currentExpanded) => [...currentExpanded, categoryId]);
  };

  const handleAddSubcategory = (categoryId: string) => {
    const category = localTaxonomy.categoriesById[categoryId];
    if (!category) {
      return;
    }

    const name = promptForName("Enter new subcategory name:");
    if (!name) {
      return;
    }

    if (name.length > MAX_NAME_LENGTH) {
      showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
      return;
    }

    if (!isSubcategoryNameUnique(categoryId, name)) {
      showModalNotification(`Subcategory "${name}" already exists in this category.`, true);
      return;
    }

    const subcategoryId = createEntityId("sub");
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.categoriesById[categoryId].subcategoryIds.push(subcategoryId);
    nextTaxonomy.subcategoriesById[subcategoryId] = {
      id: subcategoryId,
      name,
      categoryId,
      tagIds: [],
    };

    commitTaxonomyUpdate(nextTaxonomy);
    selectSubcategory(categoryId, subcategoryId);
  };

  const handleAddTag = () => {
    if (!selectedSubcategoryId || !selectedCategoryForInspector) {
      showModalNotification("Select a subcategory before adding a tag.", true);
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

    if (!isTagNameUnique(selectedSubcategoryId, name)) {
      showModalNotification(`Tag "${name}" already exists in this subcategory.`, true);
      return;
    }

    const tagId = createEntityId("tag");
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.subcategoriesById[selectedSubcategoryId].tagIds.push(tagId);
    nextTaxonomy.tagsById[tagId] = {
      id: tagId,
      name,
      subcategoryId: selectedSubcategoryId,
      accentId: null,
    };

    commitTaxonomyUpdate(nextTaxonomy);
    setNewTagName("");
  };

  const renameEntity = (
    label: "category" | "subcategory" | "tag",
    currentName: string,
  ) => promptForName(`Rename ${label}:`, currentName);

  const handleRenameCategory = (categoryId: string) => {
    const category = localTaxonomy.categoriesById[categoryId];
    if (!category) {
      return;
    }

    const nextName = renameEntity("category", category.name);
    if (!nextName || nextName === category.name) {
      return;
    }

    if (nextName.length > MAX_NAME_LENGTH) {
      showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
      return;
    }

    if (!isCategoryNameUnique(nextName, categoryId)) {
      showModalNotification(`Category "${nextName}" already exists.`, true);
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.categoriesById[categoryId].name = nextName;
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const handleRenameSubcategory = (categoryId: string, subcategoryId: string) => {
    const subcategory = localTaxonomy.subcategoriesById[subcategoryId];
    if (!subcategory) {
      return;
    }

    const nextName = renameEntity("subcategory", subcategory.name);
    if (!nextName || nextName === subcategory.name) {
      return;
    }

    if (nextName.length > MAX_NAME_LENGTH) {
      showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
      return;
    }

    if (!isSubcategoryNameUnique(categoryId, nextName, subcategoryId)) {
      showModalNotification(`Subcategory "${nextName}" already exists in this category.`, true);
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.subcategoriesById[subcategoryId].name = nextName;
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const handleRenameTag = (subcategoryId: string, tagId: string) => {
    const tag = localTaxonomy.tagsById[tagId];
    if (!tag) {
      return;
    }

    const nextName = renameEntity("tag", tag.name);
    if (!nextName || nextName === tag.name) {
      return;
    }

    if (nextName.length > MAX_NAME_LENGTH) {
      showModalNotification(`Name must be less than ${MAX_NAME_LENGTH} characters.`, true);
      return;
    }

    if (!isTagNameUnique(subcategoryId, nextName, tagId)) {
      showModalNotification(`Tag "${nextName}" already exists in this subcategory.`, true);
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.tagsById[tagId].name = nextName;
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const handleRemoveCategory = (categoryId: string) => {
    const category = localTaxonomy.categoriesById[categoryId];
    if (!category) {
      return;
    }

    const affectedTagIds = category.subcategoryIds.flatMap(
      (subcategoryId) => localTaxonomy.subcategoriesById[subcategoryId]?.tagIds || [],
    );
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
        `This removes ${category.subcategoryIds.length} subcategories, ${affectedTagIds.length} tags, and ${formatDeletionReferenceSummary(trackReferenceCount, playlistReferenceCount, artistReferenceCount, filterReferenceCount, smartPlaylistReferenceCount)}.`,
    );

    if (!confirmed) {
      return;
    }

    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.categoryOrder = nextTaxonomy.categoryOrder.filter(
      (existingCategoryId) => existingCategoryId !== categoryId,
    );

    category.subcategoryIds.forEach((subcategoryId) => {
      const tagIds = nextTaxonomy.subcategoriesById[subcategoryId]?.tagIds || [];
      tagIds.forEach((tagId) => {
        delete nextTaxonomy.tagsById[tagId];
      });
      delete nextTaxonomy.subcategoriesById[subcategoryId];
    });

    delete nextTaxonomy.categoriesById[categoryId];
    commitTaxonomyUpdate(nextTaxonomy);
  };

  const handleRemoveSubcategory = (categoryId: string, subcategoryId: string) => {
    const subcategory = localTaxonomy.subcategoriesById[subcategoryId];
    if (!subcategory) {
      return;
    }

    const affectedTagIds = [...subcategory.tagIds];
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
      `Delete subcategory "${subcategory.name}"?\n\n` +
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

    affectedTagIds.forEach((tagId) => {
      delete nextTaxonomy.tagsById[tagId];
    });

    delete nextTaxonomy.subcategoriesById[subcategoryId];
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
    nextTaxonomy.subcategoriesById[subcategoryId].tagIds =
      nextTaxonomy.subcategoriesById[subcategoryId].tagIds.filter(
        (candidateId) => candidateId !== tagId,
      );
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

  const handleAddCustomAccent = () => {
    const normalizedName = newCustomAccentName.trim();
    if (!normalizedName) {
      showModalNotification("Give the saved color a name first.", true);
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
      name: normalizedName.slice(0, 32),
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
    const normalizedName = editingCustomAccentName.trim().slice(0, 32);
    if (!normalizedName) {
      showModalNotification("Give the saved color a name first.", true);
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
    nextTaxonomy.colorThemesById[id] = { id, name: name.slice(0, 32), colorIds: [], createdAt: now, updatedAt: now };
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
    if (normalizeName(name) === "default") {
      showModalNotification('"Default" is reserved for Tagify’s built-in palette.', true);
      return;
    }
    if (colorThemes.some((candidate) => candidate.id !== themeId && normalizeName(candidate.name) === normalizeName(name))) {
      showModalNotification(`A collection named "${name}" already exists.`, true);
      return;
    }
    const nextTaxonomy = cloneTaxonomy(localTaxonomy);
    nextTaxonomy.colorThemesById[themeId].name = name.slice(0, 32);
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
      const sourceIndex = localTaxonomy.categoryOrder.indexOf(activeData.categoryId);
      const targetIndex =
        getSortableReorderTargetIndex(
          localTaxonomy.categoryOrder,
          activeData.categoryId,
          overData.categoryId,
        ) ?? localTaxonomy.categoryOrder.indexOf(overData.categoryId);
      const result = moveCategory(localTaxonomy, sourceIndex, targetIndex);

      applyMoveResult(result, buildCategoryMoveErrorMessage(getMoveReason(result)));
      return;
    }

    if (activeData.type === "subcategory") {
      if (overData.type === "subcategory") {
        const targetCategoryId = overData.categoryId;
        const targetSubcategoryIds =
          localTaxonomy.categoriesById[targetCategoryId]?.subcategoryIds ?? [];
        const targetIndex =
          activeData.categoryId === targetCategoryId
            ? getSortableReorderTargetIndex(
                targetSubcategoryIds,
                activeData.subcategoryId,
                overData.subcategoryId,
              )
            : getRelativeInsertIndex(
                targetSubcategoryIds,
                overData.subcategoryId,
                dragPlacementRef.current,
              );
        const normalizedTargetIndex =
          targetIndex === null || targetIndex < 0 ? 0 : targetIndex;

        const result = moveSubcategory(
          localTaxonomy,
          activeData.subcategoryId,
          targetCategoryId,
          normalizedTargetIndex,
        );

        const didMove = applyMoveResult(
          result,
          buildSubcategoryMoveErrorMessage(getMoveReason(result)),
        );

        if (didMove) {
          selectSubcategory(targetCategoryId, activeData.subcategoryId);
        }
      }

      if (overData.type === "category") {
        const targetIndex =
          localTaxonomy.categoriesById[overData.categoryId]?.subcategoryIds.length ?? 0;

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
            localTaxonomy.subcategoriesById[targetSubcategoryId]?.tagIds ?? [],
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
          localTaxonomy.subcategoriesById[targetSubcategoryId]?.tagIds.length ?? 0;

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
          localTaxonomy.subcategoriesById[targetSubcategoryId]?.tagIds.length ?? 0;

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
                  ? "Reorder categories, move subcategories, and drag tags across the taxonomy."
                  : "Manage the reusable colors available throughout Tagify."}
              </p>
            </div>

            <div className={styles.headerActions}>
              {activeView === "tags" ? (
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search categories, subcategories, and tags…"
                  className={styles.searchInput}
                />
              ) : null}
            </div>
          </div>

          <div className={styles.viewTabs} role="tablist" aria-label="Tag Manager sections">
            <button type="button" role="tab" aria-selected={activeView === "tags"} className={`${styles.viewTab} ${activeView === "tags" ? styles.viewTabActive : ""}`} onClick={() => setActiveView("tags")}>Tags</button>
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
                    <p className={styles.paneSubtitle}>Categories/subcategories</p>
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() =>
                      setExpandedCategories(
                        areAllCategoriesExpanded ? [] : localTaxonomy.categoryOrder,
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
                        No taxonomy rows match this search.
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
                            onToggleExpanded={toggleCategoryExpanded}
                            onSelectCategory={selectCategory}
                            onRenameCategory={handleRenameCategory}
                            onDeleteCategory={handleRemoveCategory}
                          >
                            <SortableContext
                              items={category.subcategories.map((subcategory) =>
                                buildSubcategoryDndId(subcategory.id),
                              )}
                              strategy={verticalListSortingStrategy}
                            >
                              {category.subcategories.length === 0 ? (
                                <div className={styles.emptyStateSmall}>
                                  No subcategories yet.
                                </div>
                              ) : (
                                category.subcategories.map((subcategory) => (
                                  <SortableSubcategoryRow
                                    key={subcategory.id}
                                    categoryId={category.id}
                                    subcategoryId={subcategory.id}
                                    name={subcategory.name}
                                    tagCount={subcategory.tags.length}
                                    isSelected={selectedSubcategoryId === subcategory.id}
                                    isDragDisabled={interactionLocked}
                                    isTagDropActive={hoveredSubcategoryId === subcategory.id}
                                    onSelectSubcategory={selectSubcategory}
                                    onRenameSubcategory={handleRenameSubcategory}
                                    onDeleteSubcategory={handleRemoveSubcategory}
                                  />
                                ))
                              )}
                            </SortableContext>
                            <button
                              type="button"
                              className={styles.inlineAddSubcategoryButton}
                              onClick={() => handleAddSubcategory(category.id)}
                            >
                              <span className={styles.inlineAddLabel}>+ Add Subcategory</span>
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
                  {selectedCategoryForInspector && selectedSubcategory ? (
                    <div>
                      <div className={styles.breadcrumb} aria-label="Selected path">
                        {selectedCategoryForInspector.name}
                        <span className={styles.breadcrumbSeparator}>/</span>
                        <span>{selectedSubcategory.name}</span>
                      </div>
                      <p className={styles.paneSubtitle}>
                        Drag tags here to reorder them, or drop them onto a subcategory in the tree to move them.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <h3 className={styles.paneTitle}>Tags</h3>
                      <p className={styles.paneSubtitle}>
                        Select a subcategory to manage its tags.
                      </p>
                    </div>
                  )}
                </div>

                {selectedCategoryForInspector && selectedSubcategory ? (
                  <div className={styles.inspectorPane}>
                    <div className={styles.tagToolbar}>
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(event) => setNewTagName(event.target.value)}
                        placeholder={`Add tag to ${selectedSubcategory.name}…`}
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
                            This subcategory does not have any tags yet.
                          </div>
                        ) : (
                          <div className={styles.tagChipGrid}>
                            {selectedTags.map((tag) => (
                              <SortableTagRow
                                key={tag.id}
                                categoryId={selectedCategoryForInspector.id}
                                subcategoryId={selectedSubcategory.id}
                                tag={tag}
                                isDragDisabled={interactionLocked}
                                isAccentPickerOpen={openAccentPickerTagId === tag.id}
                                customAccentsById={localTaxonomy.customAccentsById}
                                accentGroups={accentGroups}
                                onRenameTag={handleRenameTag}
                                onDeleteTag={handleRemoveTag}
                                onToggleAccentPicker={handleToggleAccentPicker}
                                onSetTagAccent={handleSetTagAccent}
                              />
                            ))}
                            <TagEndDropZone
                              subcategoryId={selectedSubcategory.id}
                              isVisible={!interactionLocked}
                            />
                          </div>
                        )}
                      </SortableContext>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    Select a category or subcategory to start organizing tags.
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
        </div>
      </div>
    </Portal>
  );
};

export default TagManager;
