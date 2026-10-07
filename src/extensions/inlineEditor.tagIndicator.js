import { getTagAccentTokens } from "../features/tag-data/utils/tagAccent";

const CLOSE_GRACE_MS = 120;
let activePopover = null;
let closeTimer = null;

export function buildTagDetails(trackTags, customAccentsById = {}) {
  const groups = [];
  const groupLookup = new Map();

  (Array.isArray(trackTags) ? trackTags : []).forEach((tag) => {
    const categoryName = tag.categoryName || "Other";
    const subcategoryName = tag.subcategoryName || "Tags";
    const groupKey = `${categoryName}\u0000${subcategoryName}`;
    let group = groupLookup.get(groupKey);
    if (!group) {
      group = { categoryName, subcategoryName, tags: [] };
      groupLookup.set(groupKey, group);
      groups.push(group);
    }
    group.tags.push({
      id: tag.tagId || tag.id || tag.name || tag.tag,
      name: tag.name || tag.tag || tag.tagId || "Unknown tag",
      accent: getTagAccentTokens(tag.accentId, customAccentsById),
    });
  });

  return groups;
}

function flattenTags(groups) {
  return groups.flatMap((group) => group.tags);
}

function closePopover() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  activePopover?.remove();
  activePopover = null;
}

function scheduleClose() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(closePopover, CLOSE_GRACE_MS);
}

function positionPopover(popover, anchor) {
  const bounds = anchor.getBoundingClientRect();
  const popoverBounds = popover.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(margin, bounds.left),
    Math.max(margin, window.innerWidth - popoverBounds.width - margin),
  );
  const fitsBelow = bounds.bottom + 6 + popoverBounds.height <= window.innerHeight - margin;
  popover.style.left = `${left}px`;
  popover.style.top = fitsBelow ? `${bounds.bottom + 6}px` : "auto";
  popover.style.bottom = fitsBelow
    ? "auto"
    : `${Math.max(margin, window.innerHeight - bounds.top + 6)}px`;
}

function showPopover(anchor, groups) {
  closePopover();
  const tags = flattenTags(groups);
  const popover = document.createElement("div");
  popover.className = "tagify-tag-popover";
  popover.setAttribute("role", "tooltip");
  popover.style.position = "fixed";
  popover.style.zIndex = "10001";
  popover.style.width = "min(300px, calc(100vw - 16px))";
  popover.style.maxHeight = "min(360px, calc(100vh - 16px))";
  popover.style.overflowY = "auto";
  popover.style.padding = "10px";
  popover.style.border = "1px solid var(--spice-button, #555)";
  popover.style.borderRadius = "8px";
  popover.style.background = "var(--spice-sidebar, #282828)";
  popover.style.color = "var(--spice-text, #fff)";
  popover.style.boxShadow = "0 8px 24px rgba(0,0,0,.45)";
  popover.style.pointerEvents = "auto";

  if (tags.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No tags assigned. Click to add tags.";
    empty.style.color = "var(--spice-subtext)";
    empty.style.fontSize = "12px";
    popover.appendChild(empty);
  } else {
    groups.forEach((group, index) => {
      const heading = document.createElement("div");
      heading.textContent = `${group.categoryName} · ${group.subcategoryName}`;
      heading.style.margin = index === 0 ? "0 0 6px" : "10px 0 6px";
      heading.style.color = "var(--spice-subtext)";
      heading.style.fontSize = "11px";
      heading.style.fontWeight = "700";
      popover.appendChild(heading);

      const tagRow = document.createElement("div");
      tagRow.style.display = "flex";
      tagRow.style.flexWrap = "wrap";
      tagRow.style.gap = "5px";
      group.tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "tagify-tag-popover-chip";
        chip.textContent = tag.name;
        chip.style.padding = "3px 7px";
        chip.style.border = `1px solid ${tag.accent?.border || "rgba(255,255,255,.18)"}`;
        chip.style.borderRadius = "999px";
        chip.style.background = tag.accent?.tint || "rgba(255,255,255,.07)";
        chip.style.color = tag.accent?.text || "var(--spice-text, #fff)";
        chip.style.fontSize = "11px";
        tagRow.appendChild(chip);
      });
      popover.appendChild(tagRow);
    });
  }

  popover.addEventListener("mouseenter", () => {
    if (closeTimer) clearTimeout(closeTimer);
  });
  popover.addEventListener("mouseleave", scheduleClose);
  document.body.appendChild(popover);
  positionPopover(popover, anchor);
  activePopover = popover;
}

export function createTagStatusIndicator({
  status = "none",
  groups = [],
  compact = false,
  detailed = false,
  showEmpty = false,
  onOpenEditor,
}) {
  const tags = flattenTags(groups);
  if (tags.length === 0 && !showEmpty) return null;

  const indicator = document.createElement("button");
  indicator.type = "button";
  indicator.className = "tagify-tag-status-indicator";
  indicator.dataset.tagifyStatus = status;
  if (tags.length === 0) {
    indicator.textContent = "Add tags";
  } else if (detailed && !compact) {
    indicator.textContent = `${tags[0].name}${tags.length > 1 ? ` +${tags.length - 1}` : ""}`;
  } else if (detailed) {
    indicator.textContent = `${tags.length} tag${tags.length === 1 ? "" : "s"}`;
  } else {
    indicator.textContent = "●";
  }
  indicator.setAttribute(
    "aria-label",
    tags.length > 0
      ? `Edit applied tags: ${tags.map((tag) => tag.name).join(", ")}`
      : "Add tags",
  );
  indicator.style.display = "inline-flex";
  indicator.style.alignItems = "center";
  indicator.style.maxWidth = detailed ? (compact ? "62px" : "112px") : "14px";
  indicator.style.overflow = "hidden";
  indicator.style.textOverflow = "ellipsis";
  indicator.style.whiteSpace = "nowrap";
  indicator.style.padding = detailed ? "3px 7px" : "0";
  indicator.style.border = detailed ? "1px solid rgba(255,255,255,.16)" : "0";
  indicator.style.borderRadius = "999px";
  indicator.style.background = detailed ? "rgba(255,255,255,.07)" : "transparent";
  indicator.style.color =
    tags.length === 0
      ? "var(--spice-subtext)"
      : status === "complete"
        ? "#1DB954"
        : "#FFA500";
  indicator.style.fontSize = compact ? "10px" : "11px";
  indicator.style.lineHeight = "1";
  indicator.style.cursor = "pointer";

  const reveal = () => showPopover(indicator, groups);
  indicator.addEventListener("mouseenter", reveal);
  indicator.addEventListener("mouseleave", scheduleClose);
  indicator.addEventListener("focus", reveal);
  indicator.addEventListener("blur", scheduleClose);
  indicator.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePopover();
    }
  });
  indicator.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closePopover();
    onOpenEditor?.(indicator);
  });

  return indicator;
}
