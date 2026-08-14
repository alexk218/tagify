import { renderStarRatingControl } from "./inlineEditor.ratingControl";
import { createTagStatusIndicator } from "./inlineEditor.tagIndicator";

export function renderInlineEditorPresentation(
  control,
  {
    rating = 0,
    energy = 0,
    tagStatus = "none",
    tagListTooltip = "",
    compact = false,
    getRateActionLabel,
    onRate,
  },
) {
  control.replaceChildren();
  control.style.display = "grid";
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

  const trailingSlot = document.createElement("span");
  trailingSlot.className = "tagify-inline-trailing";
  trailingSlot.style.display = "inline-flex";
  trailingSlot.style.alignItems = "center";
  trailingSlot.style.justifyContent = "flex-start";
  trailingSlot.style.minWidth = "0";

  const tagIndicator = createTagStatusIndicator(tagStatus, tagListTooltip);
  if (tagIndicator) {
    leadingSlot.appendChild(tagIndicator);
  }

  let energyLabel = null;
  if (energy > 0) {
    energyLabel = document.createElement("span");
    energyLabel.className = "tagify-energy-rating-label";
    energyLabel.textContent = `E ${energy}`;
    energyLabel.style.color = "var(--spice-subtext)";
    energyLabel.style.fontSize = compact ? "10px" : "11px";
    energyLabel.style.lineHeight = "1";
    energyLabel.style.cursor = "pointer";
  }

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

  if (energyLabel) {
    trailingSlot.appendChild(energyLabel);
  }

  control.append(leadingSlot, ratingControl, trailingSlot);
}
