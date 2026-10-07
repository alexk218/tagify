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

export function renderInlineEditorPresentation(
  control,
  {
    rating = 0,
    energy = 0,
    tagStatus = "none",
    tagGroups = [],
    compact = false,
    displayMode = "combined",
    getRateActionLabel,
    getEnergyActionLabel,
    onRate,
    onEnergy,
    onOpenEnergy,
    onOpenTags,
  },
) {
  control.replaceChildren();
  const selectedMode = ["combined", "stars", "energy", "tags", "disabled"].includes(
    displayMode,
  )
    ? displayMode
    : "combined";

  if (selectedMode === "disabled") {
    control.style.display = "none";
    return;
  }
  control.style.display = selectedMode === "combined" ? "grid" : "inline-flex";

  if (selectedMode === "stars") {
    control.style.alignItems = "center";
    control.style.width = "auto";
    control.appendChild(
      createRatingControl({ rating, compact, getRateActionLabel, onRate }),
    );
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
    return;
  }

  if (selectedMode === "tags") {
    control.style.alignItems = "center";
    control.style.width = "auto";
    control.appendChild(
      createTagStatusIndicator({
        status: tagStatus,
        groups: tagGroups,
        compact,
        detailed: true,
        showEmpty: true,
        onOpenEditor: onOpenTags,
      }),
    );
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

  control.append(
    leadingSlot,
    createRatingControl({ rating, compact, getRateActionLabel, onRate }),
    trailingSlot,
  );
}
