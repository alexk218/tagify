import type { TrackData } from "@/types/tagData";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists";

export interface UseTagDataOptions {
  onSyncTrack?: (trackUri: string, trackData: TrackData | null) => void;
  onSyncMultipleTracks?: (
    trackUpdates: Record<string, TrackData | null>,
  ) => void;
}

export interface UserTrackAddedEvent {
  eventId: number;
  trackUris?: string[];
}

export interface TrackMetadata {
  name: string;
  artists: string;
  albumName?: string;
  albumUri?: string | null;
  albumImageUrl?: string | null;
}

export interface PlaylistMetadata {
  name: string;
  ownerName: string | null;
  imageUrl: string | null;
  description: string | null;
  trackCount: number | null;
  snapshotId: string | null;
}

export interface ArtistMetadata {
  name: string;
  imageUrl: string | null;
  followerCount: number | null;
  genres: string[];
}

// Re-exported for backwards compatibility with existing imports.
export type { SmartPlaylistCriteria };
