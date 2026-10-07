export { useTagData } from "./hooks/useTagData";
export * from "./components";
export { cloneTaxonomy } from "./utils/tagManager.taxonomy";
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
  TrackMetadata,
  UseTagDataOptions,
  UserTrackAddedEvent,
} from "./model/useTagData.types";
export { withPlaylistMetadata } from "./utils/tagData.playlistMutations";
export { withArtistMetadata } from "./utils/tagData.artistMutations";
