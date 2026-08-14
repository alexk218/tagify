import { SpotifyTrack } from "@/types/SpotifyTypes";

export interface UseSpicetifyHistoryProps {
  isMultiTagging: boolean;
  setIsMultiTagging: (isMultiTagging: boolean) => void;
  setMultiTagTracks: (tracks: SpotifyTrack[]) => void;
  setLockedTrack: (track: SpotifyTrack | null) => void;
  setIsLocked: (isLocked: boolean) => void;
  setLockedMultiTrackUri: (uri: string | null) => void;
  onSelectTrack?: () => void;
  onSelectPlaylist?: (playlistUri: string) => void;
  onSelectArtist?: (artistUri: string) => void;
}
