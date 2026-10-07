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
  /** Stable Tagify identity, independent of the Spotify playlist binding. */
  id?: string;
  playlistId: string;
  playlistName: string;
  description?: string;
  criteria: SmartPlaylistFilterCriteria;
  isActive: boolean;
  createdAt: number;
  updatedAt?: number;
  lastSyncAt: number;
  smartPlaylistTrackUris: string[];
  pendingTagChoices?: string[];
  source?: SmartPlaylistRecipeSource;
}

export interface SmartPlaylistRecipeSource {
  recipeId: string;
  revision: number;
  authorId?: string;
}

export interface SmartPlaylistRecipeTagReference {
  key: string;
  originId?: string;
  name: string;
  categoryName: string;
  folderPath: string[];
}

export interface SmartPlaylistRecipe {
  id: string;
  name: string;
  description?: string;
  criteria: SmartPlaylistFilterCriteria;
  tagReferences: SmartPlaylistRecipeTagReference[];
  source?: SmartPlaylistRecipeSource;
}

export interface SmartPlaylistRecipeBundle {
  format: "tagify-smart-playlist-recipes";
  version: 1;
  exportedAt: string;
  recipes: SmartPlaylistRecipe[];
}
