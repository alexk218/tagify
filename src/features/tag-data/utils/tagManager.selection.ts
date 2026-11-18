export type TagManagerSelectionKind = "tags" | "folders";

export interface TagManagerSelection {
  kind: TagManagerSelectionKind;
  ids: string[];
  /** The item a Shift+Click range starts from. */
  anchorId: string | null;
}

export interface SelectionClickModifiers {
  /** Ctrl+Click (Cmd+Click on Mac): add or remove one item. */
  toggle: boolean;
  /** Shift+Click: select everything between the anchor and this item. */
  range: boolean;
}

export function getSelectionClickModifiers(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): SelectionClickModifiers | null {
  const toggle = event.ctrlKey || event.metaKey;
  const range = event.shiftKey;
  return toggle || range ? { toggle, range } : null;
}

/**
 * Returns the selection after a Ctrl/Cmd+Click or Shift+Click on `itemId`.
 * `orderedIds` is the on-screen order used for ranges.
 */
export function getNextSelection(
  current: TagManagerSelection | null,
  kind: TagManagerSelectionKind,
  orderedIds: string[],
  itemId: string,
  modifiers: SelectionClickModifiers,
): TagManagerSelection | null {
  // A selection of the other kind (tags vs folders) is replaced.
  const base: TagManagerSelection = current?.kind === kind
    ? current
    : { kind, ids: [], anchorId: null };

  if (
    modifiers.range &&
    base.anchorId &&
    orderedIds.includes(base.anchorId) &&
    orderedIds.includes(itemId)
  ) {
    const anchorIndex = orderedIds.indexOf(base.anchorId);
    const itemIndex = orderedIds.indexOf(itemId);
    const range = orderedIds.slice(
      Math.min(anchorIndex, itemIndex),
      Math.max(anchorIndex, itemIndex) + 1,
    );
    const ids = modifiers.toggle ? Array.from(new Set([...base.ids, ...range])) : range;
    return { kind, ids, anchorId: base.anchorId };
  }

  // Shift+Click with no usable anchor (for example, it was hidden by collapsing
  // its parent) starts a new range here instead of deselecting this item.
  if (modifiers.range && !modifiers.toggle) {
    const ids = base.ids.includes(itemId) ? base.ids : [...base.ids, itemId];
    return { kind, ids, anchorId: itemId };
  }

  if (base.ids.includes(itemId)) {
    const ids = base.ids.filter((id) => id !== itemId);
    return ids.length > 0 ? { kind, ids, anchorId: itemId } : null;
  }

  return { kind, ids: [...base.ids, itemId], anchorId: itemId };
}

/** Sorts selected ids into on-screen order; ids missing from `orderedIds` keep their order at the end. */
export function orderSelectedIds(selectedIds: string[], orderedIds: string[]): string[] {
  const selected = new Set(selectedIds);
  const ordered = orderedIds.filter((id) => selected.has(id));
  const listed = new Set(ordered);
  return [...ordered, ...selectedIds.filter((id) => !listed.has(id))];
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /mac/i.test(navigator.platform || navigator.userAgent || "");
}
