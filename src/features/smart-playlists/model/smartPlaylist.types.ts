import type {
  TagFilterClause,
  TagFilterOperator,
} from "@/utils/tagFilterGroups";

export interface SmartPlaylistFilterCriteria {
  includeTagClauses: TagFilterClause[];
  clauseConnectors: TagFilterOperator[];
  ratingFilters: number[];
  energyMinFilter: number | null;
  energyMaxFilter: number | null;
  bpmMinFilter: number | null;
  bpmMaxFilter: number | null;
  camelotKeyFilters?: string[];
  // Legacy range fields kept for backwards compatibility with older saved playlists.
  camelotMinFilter?: string | null;
  camelotMaxFilter?: string | null;
}

export interface SmartPlaylistCriteria {
  playlistId: string;
  playlistName: string;
  criteria: SmartPlaylistFilterCriteria;
  isActive: boolean;
  createdAt: number;
  lastSyncAt: number;
  smartPlaylistTrackUris: string[];
}
