export const TAG_DATA_UPDATED_EVENT = "tagify:dataUpdated";

export type TagDataUpdatedEventType =
  | "save"
  | "import"
  | "batchUpdate"
  | "smartPlaylistSync";

// The Tagify page and the background extension are separate bundles, each
// with its own copy of this module, so this tells a bundle's own events apart.
const BUNDLE_SOURCE_ID = typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `bundle-${Math.random().toString(36).slice(2)}`;

/**
 * `recordsAnnounced` marks a save whose records were also sent in record
 * events (trackChanged and similar), so pages can show them without reading
 * the whole library again.
 */
export function dispatchTagDataUpdatedEvent(type: TagDataUpdatedEventType, options: { recordsAnnounced?: boolean } = {}) {
  window.dispatchEvent(
    new CustomEvent(TAG_DATA_UPDATED_EVENT, {
      detail: { type, sourceId: BUNDLE_SOURCE_ID, ...(options.recordsAnnounced ? { recordsAnnounced: true } : {}) },
    }),
  );
}

/**
 * Whether an update event reports library changes this bundle has not shown
 * yet: anything another bundle saved, synced changes, and Smart Playlist
 * updates. This bundle's own saves, imports, and bulk edits are already shown.
 */
export function isUnshownTagDataUpdate(detail: { type?: string; origin?: string; sourceId?: string; recordsAnnounced?: boolean } | null | undefined): boolean {
  if (!detail) return true;
  if (detail.recordsAnnounced) return false;
  if (detail.type === "sync") return detail.origin === "remote";
  if (detail.sourceId !== BUNDLE_SOURCE_ID) return true;
  return detail.type === "smartPlaylistSync";
}
