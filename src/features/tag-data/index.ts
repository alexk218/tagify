export { useTagData } from "./hooks/useTagData";
export * from "./components";
export {
  buildTagAccentCssVars,
  getTagAccentOptions,
} from "./utils/tagAccent";
export {
  normalizeFilterState,
  normalizeSmartPlaylistCriteriaList,
} from "./utils/tagData.schema";
export type {
  ArtistMetadata,
  SmartPlaylistCriteria,
  PlaylistMetadata,
  UseTagDataOptions,
  UserTrackAddedEvent,
} from "./model/useTagData.types";
