export type PresetTagAccentId =
  | "blue"
  | "teal"
  | "green"
  | "amber"
  | "rose"
  | "slate";

export type TagAccentId = PresetTagAccentId | `custom:${string}`;

export interface CustomTagAccent {
  id: `custom:${string}`;
  name: string;
  color: string;
  themeId?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface TagColorTheme {
  id: string;
  name: string;
  colorIds: `custom:${string}`[];
  createdAt?: number;
  updatedAt?: number;
}

export interface Tag {
  id: string;
  name: string;
  accentId?: TagAccentId | null;
}

export interface TagSubcategory {
  id: string;
  name: string;
  tags: Tag[];
}

export interface TagCategory {
  id: string;
  name: string;
  subcategories: TagSubcategory[];
}

export interface TaxonomyCategory {
  id: string;
  name: string;
  subcategoryIds: string[];
}

export interface TaxonomySubcategory {
  id: string;
  name: string;
  categoryId: string;
  tagIds: string[];
}

export interface TaxonomyTag {
  id: string;
  name: string;
  subcategoryId: string;
  accentId?: TagAccentId | null;
}

export interface TagTaxonomy {
  categoryOrder: string[];
  categoriesById: Record<string, TaxonomyCategory>;
  subcategoriesById: Record<string, TaxonomySubcategory>;
  tagsById: Record<string, TaxonomyTag>;
  customAccentsById: Record<string, CustomTagAccent>;
  colorThemesById: Record<string, TagColorTheme>;
  colorThemeOrder?: string[];
  ungroupedColorIds: `custom:${string}`[];
}

export type TrackTag = string;
export type PlaylistTag = string;
export type ArtistTag = string;
export type PlaylistTrackApplyMode = "tags" | "all";

export interface TrackData {
  rating: number;
  energy: number;
  bpm: number | null;
  camelotKey?: string | null;
  tagIds: TrackTag[];
  dateCreated?: number;
  dateModified?: number;
  name?: string;
  artists?: string;
  backfillAttempts?: number;
}

export interface PlaylistData {
  rating: number;
  energy: number;
  tagIds: PlaylistTag[];
  dateCreated?: number;
  dateModified?: number;
  name?: string;
  ownerName?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  trackCount?: number | null;
  snapshotId?: string | null;
}

export interface ArtistData {
  rating: number;
  energy: number;
  tagIds: ArtistTag[];
  dateCreated?: number;
  dateModified?: number;
  name?: string;
  imageUrl?: string | null;
  followerCount?: number | null;
  genres?: string[];
}

export interface TagDataStructure {
  schemaVersion: number;
  taxonomy: TagTaxonomy;
  tracks: {
    [trackUri: string]: TrackData;
  };
  playlists: {
    [playlistUri: string]: PlaylistData;
  };
  artists: {
    [artistUri: string]: ArtistData;
  };
}

export interface BatchTagChanges {
  additions: Array<{
    trackUri: string;
    tagId: string;
  }>;
  removals: Array<{
    trackUri: string;
    tagId: string;
  }>;
}

export interface BatchTagUpdate {
  trackUri: string;
  toAdd: TrackTag[];
  toRemove: TrackTag[];
  newRating?: number;
  newEnergy?: number;
}

export interface LegacyTrackTag {
  categoryId: string;
  subcategoryId: string;
  tagId: string;
}

export interface LegacyTrackData
  extends Omit<TrackData, "tagIds"> {
  tags: LegacyTrackTag[];
}

export interface LegacyTagDataStructure {
  categories: TagCategory[];
  tracks: {
    [trackUri: string]: LegacyTrackData;
  };
}
