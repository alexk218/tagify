import { SortOption, SortOrder } from "@/constants/trackList";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";
import { TagAccentId, TrackTag } from "@/types/tagData";
import type {
  TagFilterClause,
  TagFilterOperator,
} from "@/utils/tagFilterGroups";

export interface TrackListTrackData {
  rating: number;
  energy: number;
  bpm: number | null;
  camelotKey?: string | null;
  tagIds: TrackTag[];
  dateCreated?: number;
  dateModified?: number;
  name?: string;
  artists?: string;
}

export interface TrackListTrackInfo {
  name: string;
  artists: string;
}

export interface ResolvedTag {
  displayName: string;
  tagId: string;
  accentId: TagAccentId | null;
}

export interface TagDisplayInfo {
  displayName: string;
  accentId: TagAccentId | null;
}

export type TrackListEntry = [uri: string, trackData: TrackListTrackData];

export interface TrackListFilterInputs {
  includeTagClauses: TagFilterClause[];
  clauseConnectors: TagFilterOperator[];
  ratingFilters: number[];
  energyMinFilter: number | null;
  energyMaxFilter: number | null;
  bpmMinFilter: number | null;
  bpmMaxFilter: number | null;
  normalizedCamelotKeyFilters: string[];
  searchTerm: string;
}

export interface TrackListSortInputs {
  sortBy: SortOption;
  sortOrder: SortOrder;
}

export interface BuildSmartPlaylistCriteriaInputs {
  playlistId: string;
  playlistName: string;
  trackUris: string[];
  includeTagClauses: TagFilterClause[];
  clauseConnectors: TagFilterOperator[];
  ratingFilters: number[];
  energyMinFilter: number | null;
  energyMaxFilter: number | null;
  bpmMinFilter: number | null;
  bpmMaxFilter: number | null;
  normalizedCamelotKeyFilters: string[];
}

export type { SmartPlaylistCriteria };
