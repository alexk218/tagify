import "../features/onboarding/preview/installSandbox";
import { renderEnergyControl } from "./inlineEditor.energyControl";
import { renderStarRatingControl } from "./inlineEditor.ratingControl";
import { createTagStatusIndicator } from "./inlineEditor.tagIndicator";

function createEnergyLabel(energy, compact, onOpenEnergy) {
  if (energy <= 0) return null;
  const label = document.createElement("button");
  label.type = "button";
  label.className = "tagify-energy-rating-label";
  label.textContent = `E ${energy}`;
  label.setAttribute("aria-label", `Edit energy ${energy}`);
  label.style.padding = "0";
  label.style.border = "0";
  label.style.background = "transparent";
  label.style.color = "var(--spice-subtext)";
  label.style.fontSize = compact ? "10px" : "11px";
  label.style.lineHeight = "1";
  label.style.cursor = "pointer";
  label.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpenEnergy?.(label);
  });
  return label;
}

function createRatingControl({ rating, compact, getRateActionLabel, onRate }) {
  const ratingControl = document.createElement("span");
  ratingControl.className = "tagify-star-rating-control";
  ratingControl.style.display = "inline-flex";
  ratingControl.style.alignItems = "center";
  ratingControl.addEventListener("click", (event) => event.stopPropagation());
  renderStarRatingControl(ratingControl, {
    rating,
    compact,
    getActionLabel: getRateActionLabel,
    onRate,
  });
  return ratingControl;
}

// The parts of the controls that take keyboard focus, in the order they appear.
const FOCUSABLE_PARTS = [
  ".tagify-energy-control",
  ".tagify-rating-star-button",
  ".tagify-energy-rating-label",
];

/** Which focusable part of the controls has focus, so it can have it again once they're rebuilt. */
function focusedPart(control) {
  const active = control.ownerDocument?.activeElement;
  if (!active || active === control || !control.contains(active)) return null;
  for (const selector of FOCUSABLE_PARTS) {
    const index = Array.from(control.querySelectorAll(selector)).indexOf(active);
    if (index >= 0) return { selector, index };
  }
  return null;
}

/**
 * Draws the inline controls. Saving a rating or energy draws them again, so the part that had
 * keyboard focus gets it back: arrow keys keep adjusting energy and Tab moves on from the same star.
 */
export function renderInlineEditorPresentation(control, options) {
  const part = focusedPart(control);
  renderPresentation(control, options);
  if (!part) return;
  const parts = control.querySelectorAll(part.selector);
  const target = parts[Math.min(part.index, parts.length - 1)];
  target?.focus({ preventScroll: true });
}

function renderPresentation(
  control,
  {
    rating = 0,
    energy = 0,
    tagStatus = "none",
    recordingStatus = "idle",
    tagGroups = [],
    compact = false,
    displayMode = "combined",
    getRateActionLabel,
    getEnergyActionLabel,
    onRate,
    onEnergy,
    onOpenEnergy,
    onOpenTags,
    trailingExtra = null,
  },
) {
  control.replaceChildren();
  const selectedMode = ["combined", "stars", "energy", "tags", "disabled"].includes(
    displayMode,
  )
    ? displayMode
    : "combined";

  // trailingExtra (the song row's To Tag icon) sits right after the stars and
  // energy, and still shows when the rest of the controls are turned off.
  if (selectedMode === "disabled") {
    if (trailingExtra) {
      control.style.display = "inline-flex";
      control.style.width = "auto";
      control.appendChild(trailingExtra);
    } else {
      control.style.display = "none";
    }
    return;
  }
  control.style.display = selectedMode === "combined" ? "grid" : "inline-flex";

  if (selectedMode === "stars") {
    control.style.alignItems = "center";
    control.style.width = "auto";
    control.appendChild(
      createRatingControl({ rating, compact, getRateActionLabel, onRate }),
    );
    if (trailingExtra) control.appendChild(trailingExtra);
    return;
  }

  if (selectedMode === "energy") {
    control.style.alignItems = "center";
    control.style.width = "auto";
    const energyControl = document.createElement("span");
    renderEnergyControl(energyControl, {
      energy,
      compact,
      getActionLabel: getEnergyActionLabel,
      onEnergy,
    });
    control.appendChild(energyControl);
    if (trailingExtra) control.appendChild(trailingExtra);
    return;
  }

  if (selectedMode === "tags") {
    control.style.alignItems = "center";
    control.style.width = "auto";
    control.appendChild(
      createTagStatusIndicator({
        recordingStatus,
        status: tagStatus,
        groups: tagGroups,
        compact,
        detailed: true,
        showEmpty: true,
        onOpenEditor: onOpenTags,
      }),
    );
    if (trailingExtra) control.appendChild(trailingExtra);
    return;
  }

  control.style.gridTemplateColumns = compact
    ? "26px auto 26px"
    : "minmax(0, 1fr) auto minmax(0, 1fr)";
  control.style.alignItems = "center";
  control.style.columnGap = compact ? "1px" : "2px";
  control.style.width = compact ? "auto" : "100%";

  const leadingSlot = document.createElement("span");
  leadingSlot.className = "tagify-inline-leading";
  leadingSlot.style.display = "inline-flex";
  leadingSlot.style.alignItems = "center";
  leadingSlot.style.justifyContent = "flex-end";
  leadingSlot.style.minWidth = "0";
  const tagIndicator = createTagStatusIndicator({
    recordingStatus,
    status: tagStatus,
    groups: tagGroups,
    compact,
    onOpenEditor: onOpenTags,
  });
  if (tagIndicator) leadingSlot.appendChild(tagIndicator);

  const trailingSlot = document.createElement("span");
  trailingSlot.className = "tagify-inline-trailing";
  trailingSlot.style.display = "inline-flex";
  trailingSlot.style.alignItems = "center";
  trailingSlot.style.justifyContent = "flex-start";
  trailingSlot.style.minWidth = "0";
  const energyLabel = createEnergyLabel(energy, compact, onOpenEnergy);
  if (energyLabel) trailingSlot.appendChild(energyLabel);
  if (trailingExtra) trailingSlot.appendChild(trailingExtra);

  control.append(
    leadingSlot,
    createRatingControl({ rating, compact, getRateActionLabel, onRate }),
    trailingSlot,
  );
}
