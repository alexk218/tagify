import { attachTagPopover } from "./inlineEditor.tagIndicator";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The tags other members shared publicly on a song, most-used first. The
 * listener's own public tags are left out: their own control already shows them.
 */
export function summarizeCommunityTags(entity, ownHandle) {
  const own = typeof ownHandle === "string" ? ownHandle.toLowerCase() : "";
  const others = (entity?.contributors ?? []).filter(
    (contributor) =>
      !contributor.isOwn &&
      !(own && contributor.handle?.toLowerCase() === own) &&
      contributor.tags?.length > 0,
  );
  if (others.length === 0) return null;

  const tags = new Map();
  others.forEach((contributor) => {
    const seen = new Set();
    contributor.tags.forEach(({ label }) => {
      const name = typeof label === "string" ? label.trim() : "";
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const tag = tags.get(key) ?? { label: name, people: 0 };
      tag.people += 1;
      tags.set(key, tag);
    });
  });
  if (tags.size === 0) return null;

  return {
    people: others.length,
    tags: [...tags.values()].sort(
      (a, b) => b.people - a.people || a.label.localeCompare(b.label),
    ),
  };
}

export function describeCommunityTags(summary) {
  const who = summary.people === 1 ? "1 person" : `${summary.people} people`;
  return [{
    categoryName: `Tagged by ${who} on Community`,
    subcategoryName: "",
    tags: summary.tags.map((tag) => ({
      id: tag.label,
      name: tag.people > 1 ? `${tag.label} · ${tag.people}` : tag.label,
      accent: null,
    })),
  }];
}

function createUsersIcon() {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "12");
  icon.setAttribute("height", "12");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M16 3.13a4 4 0 0 1 0 7.75",
  ].forEach((d) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    icon.appendChild(path);
  });
  const head = document.createElementNS(SVG_NS, "circle");
  head.setAttribute("cx", "9");
  head.setAttribute("cy", "7");
  head.setAttribute("r", "4");
  icon.appendChild(head);
  return icon;
}

/** A quiet "people" count beside the listener's own tags; hovering lists their tags. */
export function createCommunityTagsChip(summary) {
  const chip = document.createElement("span");
  chip.className = "tagify-playbar-community-tags";
  chip.style.display = "inline-flex";
  chip.style.alignItems = "center";
  chip.style.gap = "3px";
  chip.style.marginLeft = "8px";
  chip.style.color = "var(--spice-subtext)";
  chip.style.fontSize = "11px";
  chip.style.lineHeight = "1";
  chip.style.fontVariantNumeric = "tabular-nums";
  chip.setAttribute(
    "aria-label",
    `Community tags: ${summary.tags.map((tag) => tag.label).join(", ")}`,
  );
  const count = document.createElement("span");
  count.textContent = String(summary.people);
  chip.append(createUsersIcon(), count);
  attachTagPopover(chip, describeCommunityTags(summary), { footer: "Click to see who tagged it in Tagify" });
  return chip;
}
