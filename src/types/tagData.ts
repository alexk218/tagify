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
  subcategories?: TagSubcategory[];
}

export interface TagCategory {
  id: string;
  name: string;
  subcategories: TagSubcategory[];
  tags?: Tag[];
}

export interface TaxonomyCategory {
  id: string;
  name: string;
  subcategoryIds: string[];
  childIds?: string[];
}

export interface TaxonomyFolder {
  id: string;
  name: string;
  parentId?: string;
  categoryId?: string;
  tagIds: string[];
  childIds?: string[];
}

export type TaxonomySubcategory = TaxonomyFolder;

export interface TaxonomyTag {
  id: string;
  name: string;
  parentId?: string;
  subcategoryId: string;
  accentId?: TagAccentId | null;
  source?: {
    type: "community";
    publicTagKey: string;
    publicTagName: string;
    publicTagUrl?: string;
    importedAt: string;
  };
}

export interface TagTaxonomy {
  categoryOrder: string[];
  categoriesById: Record<string, TaxonomyCategory>;
  foldersById?: Record<string, TaxonomyFolder>;
  childrenByParentId?: Record<string, string[]>;
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
  albumName?: string;
  albumUri?: string | null;
  albumImageUrl?: string | null;
  backfillAttempts?: number;
  audioFeaturesBackfillRevision?: string;
  albumBackfillAttempts?: number;
}

export interface AlbumTrackTagCoverage {
  tagId: string;
  trackCount: number;
  /** Share of the album's tagged tracks that carry this tag, from 0 to 1. */
  coverage: number;
}

/** What the user's tagged tracks say about one album. Derived, never saved. */
export interface AlbumTrackSummary {
  /** Tracks from the album with a rating, energy, or tag. */
  taggedTrackCount: number;
  ratedTrackCount: number;
  /** Null until at least two tracks are rated. */
  ratingAverage: number | null;
  energyTrackCount: number;
  /** Null until at least two tracks have energy. */
  energyAverage: number | null;
  /**
   * Tags on at least a quarter of the tagged tracks, most common first.
   * Empty until at least two tracks have tags.
   */
  commonTags: AlbumTrackTagCoverage[];
  albumName: string | null;
  artistName: string | null;
  imageUrl: string | null;
  /** Most recent change to any of the album's tagged tracks. */
  lastTaggedAt: number | null;
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
  /** Present on normalized/current data; optional here for legacy callers and backups. */
  smartPlaylists?: import("@/features/smart-playlists/model/smartPlaylist.types").SmartPlaylistCriteria[];
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

export type BatchTrackAlbumDetails = Partial<
  Pick<TrackData, "albumUri" | "albumName" | "albumImageUrl">
>;

export interface BatchTagUpdate {
  trackUri: string;
  toAdd: TrackTag[];
  toRemove: TrackTag[];
  newRating?: number;
  newEnergy?: number;
  /** Album details for tracks that do not have them yet; existing values win. */
  albumDetails?: BatchTrackAlbumDetails;
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
