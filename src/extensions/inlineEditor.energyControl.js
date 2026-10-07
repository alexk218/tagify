const ENERGY_MIN = 1;
const ENERGY_MAX = 10;

function clampEnergy(value) {
  return Math.max(ENERGY_MIN, Math.min(ENERGY_MAX, Math.round(value)));
}

function getEnergyFromPointer(control, event) {
  const bounds =
    control.querySelector(".tagify-energy-segments")?.getBoundingClientRect() ||
    control.getBoundingClientRect();
  if (bounds.width <= 0) return ENERGY_MIN;
  const ratio = Math.max(0, Math.min(0.999, (event.clientX - bounds.left) / bounds.width));
  return clampEnergy(Math.floor(ratio * ENERGY_MAX) + 1);
}

function updateEnergyPreview(control, energy, savedEnergy) {
  const normalizedEnergy = Number(energy) || 0;
  control.querySelectorAll(".tagify-energy-segment").forEach((segment, index) => {
    const isFilled = index < normalizedEnergy;
    segment.style.background = isFilled
      ? "var(--spice-button, #1ed760)"
      : "var(--spice-tab-active, rgba(255,255,255,.14))";
    segment.style.opacity = isFilled ? "1" : "0.7";
  });

  const label = control.querySelector(".tagify-energy-value");
  if (label) label.textContent = normalizedEnergy > 0 ? `E${normalizedEnergy}` : "E—";

  if (energy === savedEnergy) {
    control.setAttribute(
      "aria-valuetext",
      savedEnergy > 0 ? `Energy ${savedEnergy} out of 10` : "Energy not set",
    );
  } else {
    control.setAttribute("aria-valuetext", `Preview energy ${normalizedEnergy} out of 10`);
  }
}

export function renderEnergyControl(
  control,
  { energy = 0, compact = false, getActionLabel, onEnergy },
) {
  const savedEnergy = Number(energy) || 0;
  let dragging = false;
  let pointerEnergy = savedEnergy;

  control.replaceChildren();
  control.className = "tagify-energy-control";
  control.tabIndex = 0;
  control.setAttribute("role", "slider");
  control.setAttribute("aria-label", "Energy");
  control.setAttribute("aria-valuemin", String(ENERGY_MIN));
  control.setAttribute("aria-valuemax", String(ENERGY_MAX));
  control.setAttribute("aria-valuenow", String(savedEnergy));
  control.style.display = "inline-flex";
  control.style.alignItems = "center";
  control.style.gap = compact ? "3px" : "5px";
  control.style.cursor = "ew-resize";
  control.style.padding = "3px 4px";
  control.style.borderRadius = "5px";
  control.style.outlineOffset = "2px";

  const segments = document.createElement("span");
  segments.className = "tagify-energy-segments";
  segments.setAttribute("aria-hidden", "true");
  segments.style.display = "grid";
  segments.style.gridTemplateColumns = "repeat(10, 1fr)";
  segments.style.gap = "1px";
  segments.style.width = compact ? "48px" : "72px";
  segments.style.height = compact ? "8px" : "10px";

  for (let index = 0; index < ENERGY_MAX; index += 1) {
    const segment = document.createElement("span");
    segment.className = "tagify-energy-segment";
    segment.style.borderRadius = "2px";
    segments.appendChild(segment);
  }

  const valueLabel = document.createElement("span");
  valueLabel.className = "tagify-energy-value";
  valueLabel.style.minWidth = compact ? "19px" : "22px";
  valueLabel.style.color = "var(--spice-subtext)";
  valueLabel.style.fontSize = compact ? "10px" : "11px";
  valueLabel.style.fontWeight = "600";
  valueLabel.style.lineHeight = "1";
  control.append(segments, valueLabel);

  const updateActionLabel = (nextEnergy) => {
    const defaultLabel =
      nextEnergy === savedEnergy && savedEnergy > 0
        ? `Clear energy ${savedEnergy}`
        : `Set energy to ${nextEnergy}`;
    control.title = getActionLabel?.(nextEnergy, defaultLabel) || defaultLabel;
  };
  const previewPointer = (event) => {
    pointerEnergy = getEnergyFromPointer(control, event);
    updateActionLabel(pointerEnergy);
    updateEnergyPreview(control, pointerEnergy, savedEnergy);
  };
  const commit = (nextEnergy) => {
    const value = nextEnergy === savedEnergy ? 0 : nextEnergy;
    onEnergy(value);
  };

  control.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    control.focus();
    control.setPointerCapture?.(event.pointerId);
    previewPointer(event);
  });
  control.addEventListener("pointermove", (event) => {
    if (dragging || event.pointerType !== "touch") previewPointer(event);
  });
  control.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = false;
    control.releasePointerCapture?.(event.pointerId);
    commit(pointerEnergy);
  });
  control.addEventListener("pointercancel", () => {
    dragging = false;
    updateEnergyPreview(control, savedEnergy, savedEnergy);
  });
  control.addEventListener("pointerleave", () => {
    if (!dragging) updateEnergyPreview(control, savedEnergy, savedEnergy);
  });
  control.addEventListener("click", (event) => event.stopPropagation());
  control.addEventListener("keydown", (event) => {
    let nextEnergy = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextEnergy = savedEnergy > 0 ? clampEnergy(savedEnergy + 1) : ENERGY_MIN;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextEnergy = savedEnergy > ENERGY_MIN ? savedEnergy - 1 : ENERGY_MIN;
    } else if (event.key === "Home") {
      nextEnergy = ENERGY_MIN;
    } else if (event.key === "End") {
      nextEnergy = ENERGY_MAX;
    } else if (event.key === "Backspace" || event.key === "Delete") {
      nextEnergy = 0;
    }

    if (nextEnergy === null) return;
    event.preventDefault();
    event.stopPropagation();
    onEnergy(nextEnergy);
  });

  updateEnergyPreview(control, savedEnergy, savedEnergy);
  updateActionLabel(savedEnergy || ENERGY_MIN);
}
