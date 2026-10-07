export const TAG_DATA_UPDATED_EVENT = "tagify:dataUpdated";

export type TagDataUpdatedEventType =
  | "save"
  | "import"
  | "batchUpdate"
  | "smartPlaylistSync";

export function dispatchTagDataUpdatedEvent(type: TagDataUpdatedEventType) {
  window.dispatchEvent(
    new CustomEvent(TAG_DATA_UPDATED_EVENT, {
      detail: { type },
    }),
  );
}
