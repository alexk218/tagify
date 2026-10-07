import {
  DEFAULT_TAG_SELECTOR_SORT_MODE,
  isTagSelectorSortMode,
  sortTagSelectorCategories,
} from "../features/tag-data/utils/tagSelector.sorting";
import { renderStarRatingControl } from "./inlineEditor.ratingControl";

const TAG_SELECTOR_SORT_MODE_KEY = "tagify:tagSelectorSortMode";
const VIEWPORT_MARGIN = 8;
const POINTER_GAP = 4;
const MAX_MENU_HEIGHT = 540;
const MAX_VIEWPORT_HEIGHT_RATIO = 0.7;

export function updateEnergyRatingRowSelection(row, selectedEnergy) {
  row.querySelectorAll("button[data-tagify-energy]").forEach((button) => {
    const isSelected = Number(button.dataset.tagifyEnergy) === selectedEnergy;
    button.setAttribute("aria-pressed", String(isSelected));
    button.style.background = isSelected
      ? "var(--spice-button, #1ed760)"
      : "var(--spice-tab-active, rgba(255,255,255,.08))";
    button.style.color = isSelected
      ? "var(--spice-main, #000)"
      : "var(--spice-text, #fff)";
    button.style.fontWeight = isSelected ? "700" : "400";
    const energy = Number(button.dataset.tagifyEnergy);
    const actionLabel = isSelected
      ? `Clear energy ${energy}`
      : `Set energy to ${energy}`;
    button.title = actionLabel;
    button.setAttribute("aria-label", actionLabel);
  });
}

export function createStarRatingRow({
  currentRating = 0,
  getActionLabel,
  onSelect,
}) {
  const row = document.createElement("div");
  let selectedRating = Number(currentRating) || 0;
  row.className = "tagify-star-rating-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Star rating");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.justifyContent = "center";
  row.style.margin = "0 2px 8px";

  const render = () => {
    renderStarRatingControl(row, {
      rating: selectedRating,
      getActionLabel,
      onRate: async (rating) => {
        const previousRating = selectedRating;
        try {
          if ((await onSelect(rating, previousRating)) === false) return false;
          selectedRating = rating;
          render();
        } catch {
          // The caller reports save errors; keep the last persisted selection.
          return false;
        }
      },
    });
    row.querySelectorAll(".tagify-rating-star").forEach((star) => {
      star.style.fontSize = "22px";
    });
  };
  render();
  return row;
}

export function getInlineMenuPlacement({
  x,
  y,
  menuWidth,
  preferredHeight,
  viewportWidth,
  viewportHeight,
  margin = VIEWPORT_MARGIN,
  gap = POINTER_GAP,
}) {
  const maximumLeft = Math.max(margin, viewportWidth - menuWidth - margin);
  const left = Math.min(Math.max(margin, x), maximumLeft);
  const spaceAbove = Math.max(0, y - gap - margin);
  const spaceBelow = Math.max(0, viewportHeight - y - gap - margin);
  const placement =
    spaceBelow >= preferredHeight || spaceBelow >= spaceAbove
      ? "below"
      : "above";
  const availableHeight = placement === "below" ? spaceBelow : spaceAbove;
  const maxHeight = Math.min(preferredHeight, availableHeight);

  if (placement === "below") {
    return {
      placement,
      left,
      top: Math.max(margin, y + gap),
      maxHeight,
    };
  }

  return {
    placement,
    left,
    bottom: Math.max(margin, viewportHeight - y + gap),
    maxHeight,
  };
}

export function positionInlineMenu(menu, x, y, viewport = window) {
  const bounds = menu.getBoundingClientRect();
  const preferredHeight = Math.min(
    MAX_MENU_HEIGHT,
    viewport.innerHeight * MAX_VIEWPORT_HEIGHT_RATIO,
  );
  const position = getInlineMenuPlacement({
    x,
    y,
    menuWidth: bounds.width,
    preferredHeight,
    viewportWidth: viewport.innerWidth,
    viewportHeight: viewport.innerHeight,
  });

  menu.style.left = `${position.left}px`;
  menu.style.top =
    position.placement === "below" ? `${position.top}px` : "auto";
  menu.style.bottom =
    position.placement === "above" ? `${position.bottom}px` : "auto";
  menu.style.maxHeight = `${position.maxHeight}px`;
  menu.dataset.tagifyPlacement = position.placement;
}

export function createEnergyRatingRow({ currentEnergy = 0, onSelect }) {
  const row = document.createElement("div");
  let selectedEnergy = Number(currentEnergy) || 0;
  row.className = "tagify-energy-rating-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Energy rating");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "repeat(10, minmax(0, 1fr))";
  row.style.gap = "2px";
  row.style.margin = "0 2px 8px";

  for (let energy = 1; energy <= 10; energy += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(energy);
    button.dataset.tagifyEnergy = String(energy);
    button.style.minWidth = "0";
    button.style.padding = "6px 0";
    button.style.border = "0";
    button.style.borderRadius = "4px";
    button.style.cursor = "pointer";
    button.style.fontSize = "11px";
    button.addEventListener("click", async () => {
      const nextEnergy = selectedEnergy === energy ? 0 : energy;
      try {
        await onSelect(nextEnergy);
        selectedEnergy = nextEnergy;
        updateEnergyRatingRowSelection(row, selectedEnergy);
      } catch {
        // The caller reports save errors; keep the last persisted selection.
      }
    });
    row.appendChild(button);
  }

  updateEnergyRatingRowSelection(row, selectedEnergy);

  return row;
}

export function getInitialInlineMenuFocusTarget(menu, initialSection) {
  if (initialSection === "tags") {
    return (
      menu.querySelector(
        'button[data-tagify-tag-id][aria-pressed="true"], button[data-tagify-tag-id][aria-pressed="mixed"]',
      ) || menu.querySelector("details summary")
    );
  }

  if (initialSection === "energy") {
    return menu.querySelector("button[data-tagify-energy]");
  }

  return null;
}

export function getSortedMenuTagCategories(categories, storage = localStorage) {
  let storedSortMode = DEFAULT_TAG_SELECTOR_SORT_MODE;

  try {
    const candidate = storage.getItem(TAG_SELECTOR_SORT_MODE_KEY);
    if (candidate && isTagSelectorSortMode(candidate)) {
      storedSortMode = candidate;
    }
  } catch (error) {
    console.warn("Tagify: Unable to read the TagSelector sort mode", error);
  }

  return sortTagSelectorCategories(categories, storedSortMode);
}
